/**
 * jnf-desktop 主容器（M7 + F 组 + P10）：
 *  - 启动链：invoke agent_status -> 未运行则 start_agent -> 轮询 health/status 直到就绪
 *  - 布局（P10-2 对齐 dsh 主页面）：左栏（品牌行/新会话/插件/工作区分组树/底部状态）+ 主区
 *    （会话头 + 对话 + 输入 + 状态栏）；全局顶栏已取消，诊断信息下沉到侧栏底部。
 *  - 对话：消息流 + 输入框 + 发送/停止；流式期间轮询运行期审批（挂起-裁决）与提问（作答）
 *  - F 组：主题三态、Composer 模型选择、会话重命名/删除/搜索/分组、全局快捷键、
 *    toast、欢迎页、重新生成、About、用量徽标
 *  - P10：工作区在侧栏直接新建/编辑/删除（目录浏览免手打路径）、删除工作区解绑会话
 * 所有业务请求统一走 lib/agent-client 与 lib/console-client、lib/settings-client，
 * 组件内不直接 fetch / invoke。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import ChatHeader from './components/ChatHeader';
import Composer from './components/Composer';
import type { ComposerModelOption, PermissionMode } from './components/Composer';
import { PERMISSION_LABEL } from './components/Composer';
import ConversationView from './components/ConversationView';
import type { QuickAction } from './components/ConversationView';
import NewSessionDialog from './components/NewSessionDialog';
import SettingsDialog from './components/SettingsDialog';
import type { Tab } from './components/SettingsDialog';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import ContextPanel from './components/ContextPanel';
import ToastContainer from './components/ToastContainer';
import WorkspaceDialog from './components/WorkspaceDialog';
import {
  AgentApiError,
  AgentRunCancelledError,
  StreamIdleError,
  apiRequest,
  cancelAgentRun,
  fetchAgentStatus,
  startAgentProcess,
  streamAgentMessage,
  waitForAgentReady,
} from './lib/agent-client';
import { collectSlashItems } from './lib/commands';
import type { SlashItem } from './lib/commands';
import { ConfirmHost, confirmAction } from './lib/confirm';
import {
  answerQuestion,
  compactSession,
  deleteSession,
  fetchPendingApprovals,
  fetchPendingQuestions,
  fetchSessionMessages,
  fetchSessionSettings,
  fetchSessionUsage,
  fetchSessions,
  renameSession,
  resolveApproval,
  toChatMessages,
  updateSessionSettings,
} from './lib/console-client';
import { exportTranscriptMarkdown } from './lib/export';
import { expandMentions } from './lib/mentions';
import { usePluginUiMap } from './lib/plugin-ui';
import {
  deleteWorkspace,
  fetchModelCatalog,
  fetchWorkspaces,
  listPlugins,
  listProfiles,
} from './lib/settings-client';
import {
  applyTheme,
  loadThemeMode,
  nextThemeMode,
  saveThemeMode,
  watchSystemTheme,
} from './lib/theme';
import type { ThemeMode } from './lib/theme';
import { toast } from './lib/toast';
import type {
  AgentStatus,
  AgentProfile,
  ApprovalVerdict,
  BootState,
  ChatMessage,
  ImageDraft,
  ReasoningEffort,
  RuntimeApprovalDto,
  RuntimeQuestionDto,
  SessionSummary,
  SessionUsage,
  ToolCardState,
  WorkspaceItem,
} from './types';

/** 默认会话（与后端 agentId 语义一致）。 */
const DEFAULT_AGENT_ID = 'main';

/** 默认工作区码（后端 WorkspaceEntry.DEFAULT_CODE）。 */
const DEFAULT_WORKSPACE_CODE = 'default';

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 把任意异常转成可展示文案（含 StreamIdleError），不抛出、不崩 UI。 */
function describeError(err: unknown): string {
  if (err instanceof StreamIdleError) {
    return err.message;
  }
  if (err instanceof AgentApiError) {
    return `[${err.code}] ${err.info}`;
  }
  if (err instanceof AgentRunCancelledError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/* ----------------------------- P9-2：沙箱权限（沙箱插件端点） ----------------------------- */

async function fetchPermissionMode(sessionId: string): Promise<PermissionMode> {
  try {
    const data = await apiRequest<{ mode?: string }>(
      `/api/harness/plugins/sandbox/api/mode?sessionId=${encodeURIComponent(sessionId)}`,
    );
    if (
      data?.mode === 'READ_ONLY' ||
      data?.mode === 'WORKSPACE_WRITE' ||
      data?.mode === 'DANGER_FULL_ACCESS'
    ) {
      return data.mode;
    }
  } catch {
    // 插件未启用/端点缺失：回落默认档
  }
  return 'WORKSPACE_WRITE';
}

async function putPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
  await apiRequest('/api/harness/plugins/sandbox/api/mode', 'PUT', { sessionId, mode });
}

export default function App(): ReactElement {
  const [boot, setBoot] = useState<BootState>({ phase: 'init' });
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<Tab>('models');
  const [agentId, setAgentId] = useState<string>(DEFAULT_AGENT_ID);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [approvals, setApprovals] = useState<RuntimeApprovalDto[]>([]);
  const [questions, setQuestions] = useState<RuntimeQuestionDto[]>([]);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemeMode());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [modelOptions, setModelOptions] = useState<ComposerModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [profileDetails, setProfileDetails] = useState<AgentProfile[]>([]);
  const [usage, setUsage] = useState<SessionUsage | null>(null);
  /** P11-10：上下文成分面板（状态栏「上下文」点开）。 */
  const [showContext, setShowContext] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const [modelFocusToken, setModelFocusToken] = useState(0);
  // P9：工作区 / 会话预设 / 思考强度 / 沙箱权限（会话级）
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null);
  const [sessionPresetCode, setSessionPresetCode] = useState<string | null>(null);
  const [sessionThinking, setSessionThinking] = useState<ReasoningEffort | null>(null);
  const [permission, setPermission] = useState<PermissionMode>('WORKSPACE_WRITE');
  const [showNewSession, setShowNewSession] = useState(false);
  /** P10-5：工作区对话框（null = 关闭；'new' = 新建；WorkspaceItem = 编辑）。 */
  const [workspaceTarget, setWorkspaceTarget] = useState<WorkspaceItem | 'new' | null>(null);
  /** P10-1：侧栏「插件」入口的计数徽标。 */
  const [pluginCount, setPluginCount] = useState(0);
  const uiMap = usePluginUiMap();

  const bootStartedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;

  /* ----------------------------- F1 主题 ----------------------------- */

  useEffect(() => {
    applyTheme(themeMode);
    saveThemeMode(themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (themeMode !== 'system') {
      return;
    }
    return watchSystemTheme(() => applyTheme('system'));
  }, [themeMode]);

  const handleToggleTheme = useCallback(() => {
    setThemeMode((prev) => nextThemeMode(prev));
  }, []);

  /* ----------------------------- 启动链 ----------------------------- */

  const runBootChain = useCallback(async () => {
    setBoot({ phase: 'checking' });
    try {
      const status = await fetchAgentStatus();
      if (!status.running) {
        setBoot({ phase: 'starting' });
        await startAgentProcess();
      }
      // 轮询 agent_status 和 /actuator/health 直到就绪（内部会注入 baseUrl + apiKey）
      const ready = await waitForAgentReady();
      setAgentStatus(ready);
      setBoot({ phase: 'ready' });
    } catch (err) {
      setBoot({ phase: 'failed', error: describeError(err) });
    }
  }, []);

  useEffect(() => {
    if (bootStartedRef.current) {
      return;
    }
    bootStartedRef.current = true;
    void runBootChain();
  }, [runBootChain]);

  /* ----------------------------- 侧栏/模型徽标/用量数据 ----------------------------- */

  const refreshSessions = useCallback(async () => {
    try {
      const list = await fetchSessions();
      setSessions(list);
    } catch {
      // 侧栏数据失败不打扰主流程
    }
  }, []);

  const refreshUsage = useCallback(async (id: string) => {
    try {
      setUsage(await fetchSessionUsage(id));
    } catch {
      setUsage(null);
    }
  }, []);

  /**
   * P11-1/P11-9：模型选项来自 `GET /settings/models/catalog` 的扁平清单。
   * value 用 `channelCode::modelCode`，因为同一模型码可能挂在多个渠道下。
   */
  const refreshModel = useCallback(async () => {
    try {
      const catalog = await fetchModelCatalog();
      const options: ComposerModelOption[] = catalog.map((item) => ({
        value: item.ref,
        label: item.modelCode,
        channelCode: item.channelCode,
        channelLabel: item.channelDisplayName || item.channelCode,
        active: item.channelActive,
        isDefault: item.isDefault,
        contextWindow: item.contextWindow,
        maxOutputTokens: item.maxOutputTokens,
        inputModalities: item.inputModalities,
      }));
      setModelOptions(options);
    } catch {
      setModelOptions([]);
    }
  }, []);

  /** P9-7：预设详情（新会话对话框卡片 + 状态栏上下文预算）。 */
  const refreshProfiles = useCallback(async () => {
    try {
      setProfileDetails(await listProfiles());
    } catch {
      setProfileDetails([]);
    }
  }, []);

  /** P9-1：工作区列表（新会话对话框 + composer 工作区选择器数据源）。 */
  const refreshWorkspaces = useCallback(async () => {
    try {
      setWorkspaces(await fetchWorkspaces());
    } catch {
      setWorkspaces([]);
    }
  }, []);

  /** P10-1：插件计数（侧栏入口徽标；插件装卸都在设置里发生，关闭设置时重取）。 */
  const refreshPluginCount = useCallback(async () => {
    try {
      setPluginCount((await listPlugins()).length);
    } catch {
      setPluginCount(0);
    }
  }, []);

  /* ----------------------------- P10-5/P10-6：侧栏工作区增删改 ----------------------------- */  /** 工作区新建/编辑落库后：关对话框 + 刷新工作区与会话（会话分组用到工作区码）。 */
  const handleWorkspaceSaved = useCallback(() => {
    setWorkspaceTarget(null);
    void refreshWorkspaces();
    void refreshSessions();
  }, [refreshWorkspaces, refreshSessions]);

  /** 删除工作区：后端会解绑其下会话（P10-6），成功后刷新并清理选中项。 */
  const handleDeleteWorkspace = useCallback(
    async (workspace: WorkspaceItem): Promise<void> => {
      if (workspace.workspaceCode === DEFAULT_WORKSPACE_CODE) {
        toast('默认工作区不可删除');
        return;
      }
      const confirmed = await confirmAction({
        title: '删除工作区',
        message: `确认删除工作区「${workspace.displayName}」？\n其下会话会回到默认工作区（不会删除会话）。`,
        confirmLabel: '删除',
        danger: true,
      });
      if (!confirmed) {
        return;
      }
      try {
        const result = await deleteWorkspace(workspace.workspaceCode);
        toast(
          result.unboundSessions > 0
            ? `工作区「${workspace.displayName}」已删除，${result.unboundSessions} 个会话回到默认工作区`
            : `工作区「${workspace.displayName}」已删除`,
        );
        setSelectedWorkspace((prev) => (prev === workspace.workspaceCode ? null : prev));
        await refreshWorkspaces();
        await refreshSessions();
      } catch (err) {
        toast(describeError(err));
      }
    },
    [refreshWorkspaces, refreshSessions],
  );

  /** C1：命令面板数据（内置 + 插件 slashCommands；function tools 不进命令面） */

  useEffect(() => {
    if (boot.phase !== 'ready') {
      return;
    }
    void refreshSessions();
    void refreshModel();
    void refreshProfiles();
    void refreshWorkspaces();
    void refreshPluginCount();
    void refreshUsage(agentId);
  }, [boot.phase, refreshSessions, refreshModel, refreshProfiles, refreshWorkspaces, refreshPluginCount, refreshUsage, agentId]);

  // F3：30s 轻量轮询兜底（done 后另有主动刷新）
  useEffect(() => {
    if (boot.phase !== 'ready') {
      return;
    }
    const timer = window.setInterval(() => void refreshSessions(), 30_000);
    return () => window.clearInterval(timer);
  }, [boot.phase, refreshSessions]);

  /* ----------------------------- 运行期审批/提问轮询（挂起-裁决/作答） ----------------------------- */

  useEffect(() => {
    if (boot.phase !== 'ready') {
      return;
    }
    let stopped = false;
    const poll = async (): Promise<void> => {
      try {
        const [pending, pendingQuestions] = await Promise.all([
          fetchPendingApprovals(),
          fetchPendingQuestions(),
        ]);
        if (!stopped) {
          setApprovals(pending);
          setQuestions(pendingQuestions);
        }
      } catch {
        // 轮询失败静默（下一轮重试）
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [boot.phase]);

  const handleResolveApproval = useCallback(
    (approvalId: string, verdict: ApprovalVerdict) => {
      void resolveApproval(approvalId, verdict)
        .catch((err) => toast(describeError(err)))
        .finally(() => {
          void fetchPendingApprovals()
            .then(setApprovals)
            .catch(() => undefined);
        });
    },
    [],
  );

  const handleAnswerQuestion = useCallback((questionId: string, answer: string) => {
    void answerQuestion(questionId, answer)
      .catch((err) => toast(describeError(err)))
      .finally(() => {
        void fetchPendingQuestions()
          .then(setQuestions)
          .catch(() => undefined);
      });
  }, []);

  /* ----------------------------- 会话切换 / 管理 ----------------------------- */

  const loadSession = useCallback(
    async (id: string) => {
      try {
        const history = await fetchSessionMessages(id);
        setMessages(toChatMessages(history, id));
      } catch (err) {
        toast(describeError(err));
      }
      void refreshUsage(id);
      // P9：恢复会话设置（工作区/预设/思考强度）与沙箱权限档
      void fetchSessionSettings(id)
        .then((settings) => {
          setSelectedWorkspace(settings.workspaceCode ?? null);
          setSessionPresetCode(settings.presetCode ?? null);
          setSessionThinking(settings.reasoningEffort ?? null);
        })
        .catch(() => undefined);
      void fetchPermissionMode(id).then(setPermission).catch(() => undefined);
    },
    [refreshUsage],
  );

  const handleSelectSession = useCallback(
    (id: string) => {
      if (id === agentIdRef.current) {
        return;
      }
      abortRef.current?.abort();
      void cancelAgentRun(agentIdRef.current).catch(() => undefined);
      setStreaming(false);
      setAgentId(id);
      setMessages([]);
      void loadSession(id);
    },
    [loadSession],
  );

  /** 裸建会话（不弹框）：删除会话后的回落与内部复用。 */
  const startBlankSession = useCallback((presetCode?: string | null) => {
    abortRef.current?.abort();
    void cancelAgentRun(agentIdRef.current).catch(() => undefined);
    setStreaming(false);
    const id = `s-${Date.now().toString(36)}`;
    setAgentId(id);
    setMessages([]);
    setUsage(null);
    // F3：新对话立即出现在列表（本地占位，done 后由 refreshSessions 对账）
    setSessions((prev) => [
      {
        sessionId: id,
        events: 0,
        eventCount: 0,
        title: null,
        createdAt: Date.now(),
        lastEventAt: Date.now(),
      },
      ...prev.filter((session) => session.sessionId !== id),
    ]);
    setSessionPresetCode(presetCode ?? null);
    setFocusToken((prev) => prev + 1);
    return id;
  }, []);

  /** P9-7：＋新对话 → 新会话对话框（预设/思考强度/工作区，仅新会话可选）。 */
  const handleNewSession = useCallback(() => {
    setShowNewSession(true);
  }, []);

  const handleCreateSession = useCallback(
    (presetCode: string | null, effort: ReasoningEffort | null, workspaceCode: string | null) => {
      setShowNewSession(false);
      const id = startBlankSession(presetCode);
      setSessionThinking(effort);
      setSelectedWorkspace(workspaceCode);
      // P9-7：预设/思考强度/工作区绑定整个 session（中途不换预设）
      void updateSessionSettings(id, {
        presetCode,
        reasoningEffort: effort,
        workspaceCode,
      }).catch((err) => toast(describeError(err)));
      void fetchPermissionMode(id).then(setPermission).catch(() => undefined);
    },
    [startBlankSession],
  );

  const handleRenameSession = useCallback(
    (id: string, title: string) => {
      void renameSession(id, title)
        .then(() => {
          toast('会话已重命名', 'success');
          return refreshSessions();
        })
        .catch((err) => toast(describeError(err)));
    },
    [refreshSessions],
  );

  const handleDeleteSession = useCallback(
    (id: string) => {
      void deleteSession(id)
        .then(async () => {
          toast('会话已删除', 'success');
          const list = await fetchSessions();
          setSessions(list);
          if (id === agentIdRef.current) {
            // F3：删除当前会话后自动切到下一个或新建
            const next = list[0];
            if (next) {
              setAgentId(next.sessionId);
              setMessages([]);
              void loadSession(next.sessionId);
            } else {
              startBlankSession();
            }
          }
        })
        .catch((err) => toast(describeError(err)));
    },
    [loadSession, startBlankSession],
  );

  /* ----------------------------- 发送 / 停止 / 重新生成 ----------------------------- */

  const handleSend = useCallback(
    async (raw: string, options?: { regenerating?: boolean; attachments?: ImageDraft[] }): Promise<void> => {
      const text = raw.trim();
      // P11-8：允许「只有图片没有文字」的消息
      if ((!text && !options?.attachments?.length) || streaming) {
        return;
      }
      const regenerating = options?.regenerating === true;
      const attachments = options?.attachments ?? [];

      // C2：@file 发送展开（SC4：≤5 文件 × 8KB；读不到保留原 token，气泡仍显示原文）
      const expanded = await expandMentions(text, uiMap);

      setPromptHistory((prev) => [...prev.filter((item) => item !== text), text].slice(-50));
      const userMessage: ChatMessage = {
        id: uid(),
        role: 'user',
        text,
        toolCards: [],
        status: 'done',
        createdAt: Date.now(),
        images: attachments.length > 0 ? attachments : undefined,
      };
      const assistantId = uid();
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        text: '',
        toolCards: [],
        segments: [],
        status: 'streaming',
        createdAt: Date.now(),
        regenerating,
      };
      // 重新生成：复用原用户气泡，只追加新的回答（作为新 turn）
      setMessages((prev) =>
        regenerating ? [...prev, assistantMessage] : [...prev, userMessage, assistantMessage],
      );
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const patchAssistant = (patch: (m: ChatMessage) => Partial<ChatMessage>): void => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, ...patch(m) } : m)),
        );
      };

      // M8 #8：文本/卡片按到达序写入 segments；#5：error 是布尔标记，内容取 result
      const appendText = (m: ChatMessage, content: string): Partial<ChatMessage> => {
        const segments = [...(m.segments ?? [])];
        const last = segments[segments.length - 1];
        if (last && last.kind === 'text') {
          segments[segments.length - 1] = { kind: 'text', text: last.text + content };
        } else {
          segments.push({ kind: 'text', text: content });
        }
        return { text: m.text + content, segments };
      };

      const upsertCard = (m: ChatMessage, card: ToolCardState): Partial<ChatMessage> => {
        const toolCards = m.toolCards.slice();
        const idx = toolCards.findIndex((c) => c.key === card.key);
        if (idx >= 0) {
          toolCards[idx] = card;
        } else {
          toolCards.push(card);
        }
        const segments = [...(m.segments ?? [])];
        const segIdx = segments.findIndex(
          (s) => s.kind === 'card' && s.card.key === card.key,
        );
        if (segIdx >= 0) {
          segments[segIdx] = { kind: 'card', card };
        } else {
          segments.push({ kind: 'card', card });
        }
        return { toolCards, segments };
      };

      try {
        await streamAgentMessage(
          {
            agentId: agentIdRef.current,
            message: expanded,
            // F2：per-message model 透传（空 = 跟随生效渠道）
            model: selectedModel || undefined,
            // P9-7：会话预设绑定（新会话时选定，整个 session 不换）
            profile: sessionPresetCode ?? undefined,
            // P9-8：思考强度（空 = 跟随预设/模型默认）
            thinking: sessionThinking ?? undefined,
            // P11-8：图片附件（后端落附件库，事件里只存引用）
            attachments:
              attachments.length > 0
                ? attachments.map((image) => ({ mediaType: image.mediaType, data: image.data }))
                : undefined,
          },
          {
            onChunk: ({ content }) => {
              if (content) {
                patchAssistant((m) => appendText(m, content));
              }
            },
            onThinking: ({ content }) => {
              // P9-8：思考增量累积进当前助手消息（ReasoningBlock 折叠展示）
              if (content) {
                patchAssistant((m) => ({
                  reasoning: (m.reasoning ?? '') + content,
                  reasoningStreaming: true,
                }));
              }
            },
            onStepBreak: (e) => {
              patchAssistant((m) => {
                const key = e.callId || `${e.toolName}-${m.toolCards.length}`;
                return upsertCard(m, {
                  key,
                  toolName: e.toolName ?? 'unknown_tool',
                  callId: e.callId ?? '',
                  args: e.args,
                  status: 'running',
                  startedAt: Date.now(),
                });
              });
            },
            onToolResult: (e) => {
              patchAssistant((m) => {
                const existing = m.toolCards.find(
                  (c) =>
                    (Boolean(e.callId) && c.callId === e.callId) ||
                    (!e.callId && c.toolName === e.toolName),
                );
                // error 布尔标记（或兼容旧字符串）；错误/结果文案都在 result
                const isError =
                  e.error === true ||
                  (typeof e.error === 'string' && e.error !== '' && e.error !== 'false');
                const contentText =
                  e.result == null ? '' : typeof e.result === 'string' ? e.result : JSON.stringify(e.result);
                return upsertCard(m, {
                  key: existing?.key ?? e.callId ?? `${e.toolName}-${m.toolCards.length}`,
                  toolName: e.toolName ?? existing?.toolName ?? 'unknown_tool',
                  callId: e.callId ?? '',
                  args: existing?.args,
                  status: isError ? 'error' : 'success',
                  result: e.result,
                  error: isError ? contentText : undefined,
                  startedAt: existing?.startedAt ?? Date.now(),
                  endedAt: Date.now(),
                });
              });
            },
            onUsage: (e) => {
              // P11-5：每次 LLM 调用后的用量快照。轮次/步数/工具数由 console 端点补，
              // 这里只覆盖 token/缓存/速度与上下文占用，避免把已经拿到的聚合值冲掉。
              setUsage((prev) => ({
                promptTokens: e.promptTokens,
                completionTokens: e.completionTokens,
                totalTokens: e.totalTokens,
                cachedTokens: e.cachedTokens,
                cacheHitRate: e.cacheHitRate,
                elapsedMs: e.elapsedMs,
                tokensPerSecond: e.tokensPerSecond,
                turns: prev?.turns ?? 0,
                steps: prev?.steps ?? 0,
                toolCalls: prev?.toolCalls ?? 0,
                contextTokens: e.lastPromptTokens,
                compactions: prev?.compactions ?? 0,
              }));
            },
            onDone: (e) => {
              patchAssistant((m) => ({
                text: e.text && e.text.length > 0 ? e.text : m.text,
                status: 'done',
                turn: e.turn,
                reasoningStreaming: false,
              }));
            },
            onError: (e) => {
              toast(`[${e.code}] ${e.message}`);
            },
          },
          { signal: controller.signal },
        );
        // 流正常结束但没收到 done：兜底收束状态
        patchAssistant((m) =>
          m.status === 'streaming' ? { status: 'done', reasoningStreaming: false } : {},
        );
      } catch (err) {
        if (err instanceof AgentRunCancelledError) {
          patchAssistant(() => ({ status: 'cancelled' }));
        } else {
          const message = describeError(err);
          patchAssistant(() => ({ status: 'error', error: message }));
          toast(message);
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        void refreshSessions();
        void refreshUsage(agentIdRef.current);
        void fetchPendingApprovals()
          .then(setApprovals)
          .catch(() => undefined);
        void fetchPendingQuestions()
          .then(setQuestions)
          .catch(() => undefined);
      }
    },
    [streaming, selectedModel, sessionPresetCode, sessionThinking, refreshSessions, refreshUsage, uiMap],
  );

  const handleStop = useCallback(() => {
    // 中断本地 fetch 流 + 通知后端取消本轮运行（best-effort）
    abortRef.current?.abort();
    void cancelAgentRun(agentIdRef.current).catch(() => undefined);
  }, []);

  /** F4：重新生成——移除旧回答，复用原用户气泡重发（新 turn），操作行带 spinner。 */
  const handleRegenerate = useCallback(() => {
    if (streaming || messages.length === 0) {
      return;
    }
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || last.status === 'streaming') {
      return;
    }
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser?.text) {
      return;
    }
    setMessages((prev) => prev.filter((m) => m.id !== last.id));
    // P11-8：图片一起重发（附件随消息走，重新生成不该丢图）
    void handleSend(lastUser.text, { regenerating: true, attachments: lastUser.images });
  }, [streaming, messages, handleSend]);

  /* ----------------------------- F4 快捷键 / 快捷入口 ----------------------------- */

  const handleQuickAction = useCallback(
    (action: QuickAction) => {
      if (action === 'chat') {
        // P9-7：开始对话 = 新会话对话框（预设/思考强度/工作区）
        handleNewSession();
        return;
      }
      setSettingsTab(action === 'models' ? 'models' : action === 'plugins' ? 'plugins' : 'about');
      setShowSettings(true);
    },
    [handleNewSession],
  );

  /* ----------------------------- C1 斜杠命令（action 本地执行） ----------------------------- */

  const handleCommand = useCallback(
    (action: string) => {
      if (action === 'new') {
        handleNewSession();
        return;
      }
      if (action === 'settings') {
        setShowSettings(true);
        return;
      }
      if (action === 'theme') {
        handleToggleTheme();
        return;
      }
      if (action === 'compact') {
        // P8-1：真压缩——Compacted 事件落盘（历史保留可溯）
        void compactSession(agentIdRef.current)
          .then((result) => {
            toast(result.compacted ? '已压缩以上对话内容' : '内容太少，无需压缩', 'success');
            return refreshUsage(agentIdRef.current);
          })
          .catch((err) => toast(describeError(err)));
        return;
      }
      if (action === 'model') {
        setModelFocusToken((prev) => prev + 1);
        return;
      }
      if (action === 'export') {
        exportTranscriptMarkdown(messages, agentIdRef.current);
        toast('已导出当前会话 Markdown', 'success');
        return;
      }
      if (action === 'help') {
        toast(
          'Enter 发送 · Shift+Enter 换行 · Ctrl+N 新对话 · Ctrl+, 设置 · Esc 停止生成\n'
            + '/ 命令面板（/compact 压缩、/export 导出、/plan 规划…） · @ 引用文件 · ↑/↓ 召回草稿',
          'info',
          6000,
        );
      }
    },
    [handleNewSession, handleToggleTheme, messages, refreshUsage],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) {
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.shiftKey && !e.altKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        handleNewSession();
        return;
      }
      if (ctrl && e.key === ',') {
        e.preventDefault();
        setShowSettings((prev) => !prev);
        return;
      }
      if (e.key === 'Escape') {
        // P11-10：上下文成分面板是最上层弹层，Esc 先关它
        if (showContext) {
          e.preventDefault();
          setShowContext(false);
          return;
        }
        // P10-5：工作区对话框浮在设置之上，Esc 先关它（宿主组件自己不处理 Esc）
        if (workspaceTarget) {
          e.preventDefault();
          setWorkspaceTarget(null);
          return;
        }
        if (showSettings) {
          e.preventDefault();
          setShowSettings(false);
          return;
        }
        if (streaming) {
          // 生成中且无弹层：Esc 停止生成（侧栏重命名输入已吞掉自己的 Esc）
          e.preventDefault();
          handleStop();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showSettings, showContext, workspaceTarget, streaming, handleNewSession, handleStop]);

  /* ----------------------------- 渲染 ----------------------------- */

  const bootReady = boot.phase === 'ready';
  const bootLabel: Record<BootState['phase'], string> = {
    init: '初始化…',
    checking: '检查 agent 状态…',
    starting: '正在启动 agent…',
    ready: '就绪',
    failed: '启动失败',
  };

  /** P8-1：命令面板数据（内置 + 插件 slashCommands；function tools 不进命令面） */
  const slashItems: SlashItem[] = useMemo(
    () => collectSlashItems(uiMap),
    [uiMap],
  );

  // C3 状态栏：上下文预算取会话预设（P9-7，缺省 default）
  const contextBudget = useMemo(() => {
    const code = sessionPresetCode || 'default';
    return profileDetails.find((p) => p.profileCode === code)?.contextTokenBudget ?? null;
  }, [profileDetails, sessionPresetCode]);

  /* ----------------------------- P10-2：会话头数据 ----------------------------- */

  const activeSession = sessions.find((session) => session.sessionId === agentId) ?? null;
  const headerTitle = activeSession?.title?.trim() || (messages.length > 0 ? '未命名会话' : '新会话');
  /*
   * P11-13：会话头显示「这个会话实际生效的上下文」。
   * 优先级：本窗口里刚选的工作区（新建会话前先选）> 活动会话自身绑定的工作区 > 默认工作区。
   * 少了中间这层，启动时会话头会写「默认工作区」而侧栏高亮的会话其实挂在别的工作区下。
   */
  const activeWorkspaceCode = selectedWorkspace ?? activeSession?.workspaceCode ?? DEFAULT_WORKSPACE_CODE;
  const workspaceLabel =
    workspaces.find((workspace) => workspace.workspaceCode === activeWorkspaceCode)?.displayName ?? null;
  const activePresetCode = sessionPresetCode ?? activeSession?.presetCode ?? null;
  const headerPresetLabel = activePresetCode
    ? profileDetails.find((p) => p.profileCode === activePresetCode)?.displayName ?? activePresetCode
    : null;
  const permissionLabel = PERMISSION_LABEL[permission] ?? null;
  const serviceLabel = bootReady
    ? `服务运行中${agentStatus ? ` · :${agentStatus.port}` : ''}`
    : bootLabel[boot.phase];

  /** 侧栏「插件」入口：直接落到设置对话框的插件页签。 */
  const openPlugins = useCallback(() => {
    setSettingsTab('plugins');
    setShowSettings(true);
  }, []);

  const openSettings = useCallback(() => {
    setShowSettings(true);
  }, []);

  return (
    <div className="app-shell">
      {showSettings && bootReady ? (
        <SettingsDialog
          initialTab={settingsTab}
          serviceRunning={bootReady}
          onClose={() => {
            setShowSettings(false);
            void refreshModel();
            void refreshProfiles();
            void refreshSessions();
            void refreshPluginCount();
          }}
        />
      ) : null}

      {workspaceTarget ? (
        <WorkspaceDialog
          target={workspaceTarget === 'new' ? null : workspaceTarget}
          onClose={() => setWorkspaceTarget(null)}
          onSaved={handleWorkspaceSaved}
        />
      ) : null}

      {showNewSession && bootReady ? (
        <NewSessionDialog
          profiles={profileDetails}
          workspaces={workspaces}
          onCancel={() => setShowNewSession(false)}
          onConfirm={handleCreateSession}
        />
      ) : null}

      {!bootReady ? (
        <section className="boot-panel">
          <span className="boot-panel__logo">◆</span>
          <h2>jnf Harness</h2>
          <p>{bootLabel[boot.phase]}</p>
          {boot.phase === 'starting' || boot.phase === 'checking' ? (
            <div className="boot-spinner" aria-label="loading" />
          ) : null}
          {boot.error ? <p className="error-text">{boot.error}</p> : null}
          {boot.phase === 'failed' ? (
            <button type="button" className="btn btn--primary" onClick={() => void runBootChain()}>
              重试
            </button>
          ) : null}
        </section>
      ) : (
        <div className="app-body">
          <Sidebar
            sessions={sessions}
            workspaces={workspaces}
            activeId={agentId}
            collapsed={sidebarCollapsed}
            themeMode={themeMode}
            serviceLabel={serviceLabel}
            serviceRunning={bootReady}
            pluginCount={pluginCount}
            onSelect={handleSelectSession}
            onNew={handleNewSession}
            onRename={handleRenameSession}
            onDelete={handleDeleteSession}
            onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
            onOpenPlugins={openPlugins}
            onOpenSettings={openSettings}
            onToggleTheme={handleToggleTheme}
            onNewWorkspace={() => setWorkspaceTarget('new')}
            onEditWorkspace={(workspace) => setWorkspaceTarget(workspace)}
            onDeleteWorkspace={(workspace) => void handleDeleteWorkspace(workspace)}
          />
          <main className="app-main">
            <ChatHeader
              title={headerTitle}
              workspaceLabel={workspaceLabel}
              presetLabel={headerPresetLabel}
              permissionLabel={permissionLabel}
              streaming={streaming}
              sidebarCollapsed={sidebarCollapsed}
              onExpandSidebar={() => setSidebarCollapsed(false)}
              onNewSession={handleNewSession}
              onOpenSettings={openSettings}
            />
            <ConversationView
              messages={messages}
              streaming={streaming}
              approvals={approvals}
              questions={questions}
              onResolveApproval={handleResolveApproval}
              onAnswerQuestion={handleAnswerQuestion}
              onRegenerate={handleRegenerate}
              onQuickAction={handleQuickAction}
            />
            <Composer
              disabled={!bootReady}
              streaming={streaming}
              history={promptHistory}
              models={modelOptions}
              selectedModel={selectedModel}
              onSelectModel={setSelectedModel}
              thinking={sessionThinking}
              onSelectThinking={setSessionThinking}
              workspaces={workspaces}
              selectedWorkspace={selectedWorkspace}
              onSelectWorkspace={(code) => {
                setSelectedWorkspace(code);
                void updateSessionSettings(agentIdRef.current, { workspaceCode: code }).catch((err) =>
                  toast(describeError(err)),
                );
              }}
              workspaceDisabled={false}
              permission={permission}
              onSelectPermission={(mode) => {
                setPermission(mode);
                void putPermissionMode(agentIdRef.current, mode).catch((err) => toast(describeError(err)));
              }}
              slashItems={slashItems}
              onCommand={handleCommand}
              focusToken={focusToken}
              modelFocusToken={modelFocusToken}
              onSend={(text, attachments) => {
                // P11-8：附件走 options（Composer 与 handleSend 的签名不同：前者给附件，后者带 regenerating）
                if (attachments && attachments.length > 0) {
                  void handleSend(text, { attachments });
                } else {
                  void handleSend(text);
                }
              }}
              onStop={handleStop}
            />
            <StatusBar
              usage={usage}
              contextBudget={contextBudget}
              streaming={streaming}
              contextDisabled={!agentId}
              onOpenContext={() => setShowContext(true)}
            />
          </main>
        </div>
      )}
      <ToastContainer />
      <ConfirmHost />
      {showContext && agentId ? (
        <ContextPanel
          sessionId={agentId}
          budget={contextBudget}
          onClose={() => setShowContext(false)}
        />
      ) : null}
    </div>
  );
}
