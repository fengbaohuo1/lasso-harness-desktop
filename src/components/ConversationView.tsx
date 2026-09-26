/**
 * 对话视图：消息气泡 + 流式渲染 + 工具卡片。
 * 工具卡片由 step_break 开始、tool_result 结束，展示工具名 / 参数 / 结果 / 成败色。
 */

import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import type { ChatMessage, ToolCardState } from '../types';

export interface ConversationViewProps {
  messages: ChatMessage[];
  streaming: boolean;
}

/** 把任意值渲染成可读文本（JSON 优先）。 */
function formatValue(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ToolCard({ card }: { card: ToolCardState }): ReactElement {
  const argsText = formatValue(card.args);
  const resultText = card.error ? card.error : formatValue(card.result);
  const statusLabel: Record<ToolCardState['status'], string> = {
    running: '运行中',
    success: '成功',
    error: '失败',
  };

  return (
    <div className={`tool-card tool-card--${card.status}`}>
      <div className="tool-card__head">
        <span className={`tool-card__icon tool-card__icon--${card.status}`} aria-hidden="true">
          {card.status === 'running' ? '⟳' : card.status === 'success' ? '✓' : '✕'}
        </span>
        <span className="tool-card__name">{card.toolName}</span>
        <span className={`tool-card__status tool-card__status--${card.status}`}>
          {statusLabel[card.status]}
        </span>
      </div>
      {argsText ? (
        <div className="tool-card__section">
          <div className="tool-card__label">参数</div>
          <pre className="tool-card__pre">{argsText}</pre>
        </div>
      ) : null}
      {resultText ? (
        <div className="tool-card__section">
          <div className="tool-card__label">{card.error ? '错误' : '结果'}</div>
          <pre className="tool-card__pre">{resultText}</pre>
        </div>
      ) : null}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }): ReactElement {
  const isUser = message.role === 'user';
  return (
    <div className={`bubble-row bubble-row--${isUser ? 'user' : 'assistant'}`}>
      <div className={`bubble bubble--${isUser ? 'user' : 'assistant'}`}>
        {!isUser && message.toolCards.length > 0 ? (
          <div className="tool-cards">
            {message.toolCards.map((card) => (
              <ToolCard key={card.key} card={card} />
            ))}
          </div>
        ) : null}

        {message.text ? (
          <div className="bubble__text">{message.text}</div>
        ) : null}

        {message.status === 'streaming' && message.text === '' && message.toolCards.length === 0 ? (
          <div className="typing" aria-label="生成中">
            <span />
            <span />
            <span />
          </div>
        ) : null}

        {message.status === 'error' && message.error ? (
          <div className="bubble__error">{message.error}</div>
        ) : null}
        {message.status === 'cancelled' ? (
          <div className="bubble__meta">已停止生成</div>
        ) : null}
      </div>
    </div>
  );
}

export default function ConversationView({
  messages,
  streaming,
}: ConversationViewProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, streaming]);

  return (
    <div className="conversation" ref={scrollRef}>
      {messages.length === 0 ? (
        <div className="conversation__empty">
          <p>开始和你的 Agent 对话吧。</p>
          <p className="conversation__hint">
            消息经 /api/agent/stream 流式返回；工具调用会以卡片形式展示。
          </p>
        </div>
      ) : (
        messages.map((m) => <MessageBubble key={m.id} message={m} />)
      )}
    </div>
  );
}
