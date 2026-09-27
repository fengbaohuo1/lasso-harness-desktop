/**
 * jnf-desktop 主容器（M7）：
 *  - 启动链：invoke agent_status -> 未运行则 start_agent -> 轮询 health/status 直到就绪
 *  - 布局：顶栏（状态 + 当前模型 + 设置）| 左侧会话栏 | 主区（对话 + 输入）
 *  - 对话：消息流 + 输入框 + 发送 + 停止生成；流式期间轮询运行期审批（挂起-裁决）
 * 所有业务请求统一走 lib/agent-client 与 lib/console-client、lib/settings-client，
 * 组件内不直接 fetch / invoke。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import Composer from './components/Composer';
import ConversationView from './components/ConversationView';
import SettingsDialog from './components/SettingsDialog';
import Sidebar from './components/Sidebar';
import {
  AgentApiError,
  AgentRunCancelledError,
  StreamIdleError,
  cancelAgentRun,
  fetchAgentStatus,
  startAgentProcess,
  streamAgentMessage,
  waitForAgentReady,
} from './lib/agent-client';
import {
  fetchPendingApprovals,
  fetchSessionMessages,
  fetchSessions,
  resolveApproval,
  toChatMessages,
} from './lib/console-client';
import { listModelChannels } from './lib/settings-client';
import type {
  AgentStatus,
  ApprovalVerdict,
  BootState,
  ChatMessage,
  RuntimeApprovalDto,
  SessionSummary,
  ToolCardState,
  ToolCardStatus,
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

export default function App(): ReactElement {
  const [boot, setBoot] = useState<BootState>({ phase: 'init' });
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [agentId, setAgentId] = useState<string>(DEFAULT_AGENT_ID);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [approvals, setApprovals] = useState<RuntimeApprovalDto[]>([]);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);

  const bootStartedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;

  /* ----------------------------- 启动链 ----------------------------- */

  const runBootChain = useCallback(async () => {
    setBoot({ phase: 'checking' });
    setBanner(null);
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

  /* ----------------------------- 侧栏/模型徽标数据 ----------------------------- */

  const refreshSessions = useCallback(async () => {
    try {
      const list = await fetchSessions();
      setSessions(list);
    } catch {
      // 侧栏数据失败不打扰主流程
    }
  }, []);

  const refreshModel = useCallback(async () => {
    try {
      const channels = await listModelChannels();
      const active = channels.find((c) => c.active);
      setActiveModel(active ? active.modelCode : null);
    } catch {
      setActiveModel(null);
    }
  }, []);

  useEffect(() => {
    if (boot.phase !== 'ready') {
      return;
    }
    void refreshSessions();
    void refreshModel();
  }, [boot.phase, refreshSessions, refreshModel]);

  /* ----------------------------- 运行期审批轮询（挂起-裁决） ----------------------------- */

  useEffect(() => {
    if (boot.phase !== 'ready') {
      return;
    }
    let stopped = false;
    const poll = async (): Promise<void> => {
      try {
        const pending = await fetchPendingApprovals();
        if (!stopped) {
          setApprovals(pending);
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

  const handleResolveApproval = useCallback((approvalId: string, verdict: ApprovalVerdict) => {
    void resolveApproval(approvalId, verdict)
      .catch((err) => setBanner(describeError(err)))
      .finally(() => {
        void fetchPendingApprovals()
          .then(setApprovals)
          .catch(() => undefined);
      });
  }, []);

  /* ----------------------------- 会话切换 ----------------------------- */

  const loadSession = useCallback(async (id: string) => {
    try {
      const history = await fetchSessionMessages(id);
      setMessages(toChatMessages(history, id));
    } catch (err) {
      setBanner(describeError(err));
    }
  }, []);

  const handleSelectSession = useCallback(
    (id: string) => {
      if (id === agentId) {
        return;
      }
      abortRef.current?.abort();
      void cancelAgentRun(agentId).catch(() => undefined);
      setStreaming(false);
      setAgentId(id);
      setMessages([]);
      void loadSession(id);
    },
    [agentId, loadSession],
  );

  const handleNewSession = useCallback(() => {
    abortRef.current?.abort();
    void cancelAgentRun(agentId).catch(() => undefined);
    setStreaming(false);
    const id = `s-${Date.now().toString(36)}`;
    setAgentId(id);
    setMessages([]);
  }, [agentId]);

  /* ----------------------------- 发送 / 停止 ----------------------------- */

  const handleSend = useCallback(
    async (raw: string): Promise<void> => {
      const text = raw.trim();
      if (!text || streaming) {
        return;
      }

      setBanner(null);
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
        status: 'streaming',
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const patchAssistant = (patch: (m: ChatMessage) => Partial<ChatMessage>): void => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, ...patch(m) } : m)),
        );
      };

      try {
        await streamAgentMessage(
          { agentId: agentIdRef.current, message: text },
          {
            onChunk: ({ content }) => {
              patchAssistant((m) => ({ text: m.text + (content ?? '') }));
            },
            onStepBreak: (e) => {
              patchAssistant((m) => {
                const key = e.callId || `${e.toolName}-${m.toolCards.length}`;
                const card: ToolCardState = {
                  key,
                  toolName: e.toolName ?? 'unknown_tool',
                  callId: e.callId ?? '',
                  args: e.args,
                  status: 'running',
                  startedAt: Date.now(),
                };
                const idx = m.toolCards.findIndex((c) => c.key === key);
                if (idx >= 0) {
                  const next = m.toolCards.slice();
                  next[idx] = card;
                  return { toolCards: next };
                }
                return { toolCards: [...m.toolCards, card] };
              });
            },
            onToolResult: (e) => {
              patchAssistant((m) => {
                const next = m.toolCards.slice();
                const idx = next.findIndex(
                  (c) =>
                    (Boolean(e.callId) && c.callId === e.callId) ||
                    (!e.callId && c.toolName === e.toolName),
                );
                const errorText =
                  e.error == null || e.error === '' ? undefined : String(e.error);
                const status: ToolCardStatus = errorText ? 'error' : 'success';
                const base: ToolCardState =
                  idx >= 0
                    ? next[idx]
                    : {
                        key: e.callId || `${e.toolName}-${next.length}`,
                        toolName: e.toolName ?? 'unknown_tool',
                        callId: e.callId ?? '',
                        args: undefined,
                        status,
                        startedAt: Date.now(),
                      };
                const merged: ToolCardState = {
                  ...base,
                  status,
                  result: e.result,
                  error: errorText,
                  endedAt: Date.now(),
                };
                if (idx >= 0) {
                  next[idx] = merged;
                } else {
                  next.push(merged);
                }
                return { toolCards: next };
              });
            },
            onDone: (e) => {
              patchAssistant((m) => ({
                text: e.text && e.text.length > 0 ? e.text : m.text,
                status: 'done',
                turn: e.turn,
              }));
            },
            onError: (e) => {
              setBanner(`[${e.code}] ${e.message}`);
            },
          },
          { signal: controller.signal },
        );
        // 流正常结束但没收到 done：兜底收束状态
        patchAssistant((m) => (m.status === 'streaming' ? { status: 'done' } : {}));
      } catch (err) {
        if (err instanceof AgentRunCancelledError) {
          patchAssistant(() => ({ status: 'cancelled' }));
        } else {
          const message = describeError(err);
          patchAssistant(() => ({ status: 'error', error: message }));
          setBanner(message);
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        void refreshSessions();
        void fetchPendingApprovals()
          .then(setApprovals)
          .catch(() => undefined);
      }
    },
    [streaming, refreshSessions],
  );

  const handleStop = useCallback(() => {
    // 中断本地 fetch 流 + 通知后端取消本轮运行（best-effort）
    abortRef.current?.abort();
    void cancelAgentRun(agentIdRef.current).catch(() => undefined);
  }, []);

  /* ----------------------------- 渲染 ----------------------------- */

  const bootReady = boot.phase === 'ready';
  const bootLabel: Record<BootState['phase'], string> = {
    init: '初始化…',
    checking: '检查 agent 状态…',
    starting: '正在启动 agent…',
    ready: '就绪',
    failed: '启动失败',
  };

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
          {bootReady ? (
            <button type="button" className="btn btn--small" onClick={() => setShowSettings(true)}>
              设置
            </button>
          ) : null}
        </div>
      </header>

      {showSettings && bootReady ? (
        <SettingsDialog
          onClose={() => {
            setShowSettings(false);
            void refreshModel();
            void refreshSessions();
          }}
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
            onSelect={handleSelectSession}
            onNew={handleNewSession}
          />
          <main className="app-main">
            {banner ? (
              <div className="banner banner--error" role="alert">
                <span>{banner}</span>
                <button type="button" className="banner-close" onClick={() => setBanner(null)}>
                  ×
                </button>
              </div>
            ) : null}
            <ConversationView
              messages={messages}
              streaming={streaming}
              approvals={approvals}
              onResolveApproval={handleResolveApproval}
            />
            <Composer
              disabled={!bootReady}
              streaming={streaming}
              history={promptHistory}
              onSend={handleSend}
              onStop={handleStop}
            />
          </main>
        </div>
      )}
    </div>
  );
}
