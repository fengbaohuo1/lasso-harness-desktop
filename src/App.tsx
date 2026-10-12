/**
 * jnf-desktop 主容器（M7 + F 组）：
 *  - 启动链：invoke agent_status -> 未运行则 start_agent -> 轮询 health/status 直到就绪
 *  - 布局：顶栏（状态 + 当前模型 + 主题切换 + 设置）| 左侧会话栏（可折叠）| 主区（对话 + 输入）
 *  - 对话：消息流 + 输入框 + 发送/停止；流式期间轮询运行期审批（挂起-裁决）与提问（作答）
 *  - F 组：主题三态、Composer 模型选择、会话重命名/删除/搜索/分组、全局快捷键、
 *    toast、欢迎页、重新生成、About、用量徽标
 * 所有业务请求统一走 lib/agent-client 与 lib/console-client、lib/settings-client，
 * 组件内不直接 fetch / invoke。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import Composer from './components/Composer';
import type { ComposerModelOption, PermissionMode } from './components/Composer';
import ConversationView from './components/ConversationView';
import type { QuickAction } from './components/ConversationView';
import NewSessionDialog from './components/NewSessionDialog';
import SettingsDialog from './components/SettingsDialog';
import type { Tab } from './components/SettingsDialog';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import ToastContainer from './components/ToastContainer';
import { MonitorIcon, MoonIcon, SunIcon } from './components/icons';
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
import { fetchWorkspaces, listModelChannels, listProfiles } from './lib/settings-client';
import {
  THEME_MODE_LABEL,
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
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemeMode());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [modelOptions, setModelOptions] = useState<ComposerModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [profileDetails, setProfileDetails] = useState<AgentProfile[]>([]);
  const [usage, setUsage] = useState<SessionUsage | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [modelFocusToken, setModelFocusToken] = useState(0);
  // P9：工作区 / 会话预设 / 思考强度 / 沙箱权限（会话级）
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null);
  const [sessionPresetCode, setSessionPresetCode] = useState<string | null>(null);
  const [sessionThinking, setSessionThinking] = useState<ReasoningEffort | null>(null);
  const [permission, setPermission] = useState<PermissionMode>('WORKSPACE_WRITE');
  const [showNewSession, setShowNewSession] = useState(false);
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

  const refreshModel = useCallback(async () => {
    try {
      const channels = await listModelChannels();
      const active = channels.find((c) => c.active);
      setActiveModel(active ? active.modelCode : null);
      const seen = new Set<string>();
      const options: ComposerModelOption[] = [];
      for (const channel of channels) {
        if (!channel.modelCode || seen.has(channel.modelCode)) {
          continue;
        }
        seen.add(channel.modelCode);
        options.push({
          value: channel.modelCode,
          label: `${channel.displayName || channel.channelCode} · ${channel.modelCode}`,
          active: channel.active,
        });
      }
      setModelOptions(options);
    } catch {
      setActiveModel(null);
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

  /** C1：命令面板数据（内置 + 插件 slashCommands；function tools 不进命令面） */

  useEffect(() => {
    if (boot.phase !== 'ready') {
      return;
    }
    void refreshSessions();
    void refreshModel();
    void refreshProfiles();
    void refreshWorkspaces();
    void refreshUsage(agentId);
  }, [boot.phase, refreshSessions, refreshModel, refreshProfiles, refreshWorkspaces, refreshUsage, agentId]);

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
    async (raw: string, options?: { regenerating?: boolean }): Promise<void> => {
      const text = raw.trim();
      if (!text || streaming) {
        return;
      }
      const regenerating = options?.regenerating === true;

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
    void handleSend(lastUser.text, { regenerating: true });
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
  }, [showSettings, streaming, handleNewSession, handleStop]);

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
  const profileLabel = sessionPresetCode
    ? profileDetails.find((p) => p.profileCode === sessionPresetCode)?.displayName ?? sessionPresetCode
    : null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-title">
          <span className="app-logo">◆</span>
          <span>jnf Desktop</span>
          <span className="app-subtitle">自有 Agent Harness 桌面壳</span>
        </div>
        <div className="app-status">
          <span className={`status-dot status-dot--${boot.phase}`} />
          <span>{bootLabel[boot.phase]}</span>
          {agentStatus ? (
            <span className="status-detail">
              :{agentStatus.port}
              {typeof agentStatus.pid === 'number' ? ` · pid ${agentStatus.pid}` : ''}
            </span>
          ) : null}
          {bootReady && activeModel ? (
            <span className="model-badge" title="当前生效模型（设置中可切换）">
              {activeModel}
            </span>
          ) : null}
          <button
            type="button"
            className="icon-btn theme-toggle"
            title={`主题：${THEME_MODE_LABEL[themeMode]}（点击切换）`}
            aria-label={`主题：${THEME_MODE_LABEL[themeMode]}（点击切换）`}
            onClick={handleToggleTheme}
          >
            {themeMode === 'system' ? (
              <MonitorIcon />
            ) : themeMode === 'dark' ? (
              <MoonIcon />
            ) : (
              <SunIcon />
            )}
            <span>{THEME_MODE_LABEL[themeMode]}</span>
          </button>
          {bootReady ? (
            <button type="button" className="btn btn--small" onClick={() => setShowSettings(true)}>
              设置
            </button>
          ) : null}
        </div>
      </header>

      {showSettings && bootReady ? (
        <SettingsDialog
          initialTab={settingsTab}
          serviceRunning={bootReady}
          onClose={() => {
            setShowSettings(false);
            void refreshModel();
            void refreshProfiles();
            void refreshSessions();
          }}
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
          <h2>启动链</h2>
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
            activeId={agentId}
            collapsed={sidebarCollapsed}
            onSelect={handleSelectSession}
            onNew={handleNewSession}
            onRename={handleRenameSession}
            onDelete={handleDeleteSession}
            onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
          />
          <main className="app-main">
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
              contextTokens={usage?.contextTokens ?? 0}
              contextBudget={contextBudget}
              slashItems={slashItems}
              onCommand={handleCommand}
              focusToken={focusToken}
              modelFocusToken={modelFocusToken}
              onSend={handleSend}
              onStop={handleStop}
            />
            <StatusBar
              usage={usage}
              contextBudget={contextBudget}
              modelLabel={activeModel}
              profileLabel={profileLabel}
              streaming={streaming}
            />
          </main>
        </div>
      )}
      <ToastContainer />
    </div>
  );
}
