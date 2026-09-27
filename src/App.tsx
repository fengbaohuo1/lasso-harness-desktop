/**
 * jnf-desktop 主容器：
 *  - 启动链：invoke agent_status -> 未运行则 start_agent -> 轮询 /actuator/health 或 status 直到就绪
 *  - 对话视图：消息流 + 输入框 + 发送 + 停止生成
 * 所有业务请求统一走 lib/agent-client，组件内不直接 fetch / invoke。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import Composer from './components/Composer';
import ConversationView from './components/ConversationView';
import SettingsDialog from './components/SettingsDialog';
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
import type {
  AgentStatus,
  BootState,
  ChatMessage,
  ToolCardState,
  ToolCardStatus,
} from './types';

/** 本桌面壳使用的固定 agentId。 */
const AGENT_ID = 'main';

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

  const bootStartedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

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
      // 轮询 agent_status 与 /actuator/health 直到就绪（内部会注入 baseUrl + apiKey）
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

  /* ----------------------------- 发送 / 停止 ----------------------------- */

  const handleSend = useCallback(
    async (raw: string): Promise<void> => {
      const text = raw.trim();
      if (!text || streaming) {
        return;
      }

      setBanner(null);
      const userMessage: ChatMessage = {
        id: uid(),
        role: 'user',
        text,
        toolCards: [],
        status: 'done',
      };
      const assistantId = uid();
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        text: '',
        toolCards: [],
        status: 'streaming',
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
          { agentId: AGENT_ID, message: text },
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
        // 流正常结束但没收到 done：兜底收敛状态
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
      }
    },
    [streaming],
  );

  const handleStop = useCallback(() => {
    // 中断本地 fetch 流 + 通知后端取消本次运行（best-effort）
    abortRef.current?.abort();
    void cancelAgentRun(AGENT_ID).catch(() => undefined);
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
          {bootReady ? (
            <button type="button" className="btn btn--small" onClick={() => setShowSettings(true)}>
              设置
            </button>
          ) : null}
        </div>
      </header>

      {showSettings && bootReady ? <SettingsDialog onClose={() => setShowSettings(false)} /> : null}

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
        <main className="app-main">
          {banner ? (
            <div className="banner banner--error" role="alert">
              <span>{banner}</span>
              <button type="button" className="banner-close" onClick={() => setBanner(null)}>
                ×
              </button>
            </div>
          ) : null}
          <ConversationView messages={messages} streaming={streaming} />
          <Composer
            disabled={!bootReady}
            streaming={streaming}
            onSend={handleSend}
            onStop={handleStop}
          />
        </main>
      )}
    </div>
  );
}
