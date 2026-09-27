/**
 * 对话视图（M7.3）：消息气泡 + 流式渲染 + 工具卡片 + 审批插槽。
 * 助手消息走 markdown-lite（代码块带复制）；自动滚动 +「回到底部」；消息复制与时间戳。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import MarkdownLite from '../lib/markdown-lite';
import ApprovalCard from './ApprovalCard';
import type { ApprovalVerdict, ChatMessage, RuntimeApprovalDto, ToolCardState } from '../types';

export interface ConversationViewProps {
  messages: ChatMessage[];
  streaming: boolean;
  approvals?: RuntimeApprovalDto[];
  onResolveApproval?: (approvalId: string, verdict: ApprovalVerdict) => void;
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

function timeLabel(ts?: number): string {
  if (!ts) {
    return '';
  }
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CopyTextButton({ text }: { text: string }): ReactElement | null {
  const [copied, setCopied] = useState(false);
  if (!text) {
    return null;
  }
  return (
    <button
      type="button"
      className="bubble__copy"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          },
          () => undefined,
        );
      }}
    >
      {copied ? '已复制' : '复制'}
    </button>
  );
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
          {card.status === 'running' ? '⚙' : card.status === 'success' ? '✓' : '✕'}
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
          <div className="bubble__text">
            {isUser ? message.text : <MarkdownLite text={message.text} />}
            {message.status === 'streaming' ? <span className="cursor" aria-hidden="true" /> : null}
          </div>
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

        <div className="bubble__meta">
          {timeLabel(message.createdAt)}
          {message.status === 'cancelled' ? ' · 已停止' : ''}
          {message.status === 'error' ? ' · 出错' : ''}
          {message.text ? <CopyTextButton text={message.text} /> : null}
        </div>
      </div>
    </div>
  );
}

export default function ConversationView({
  messages,
  streaming,
  approvals = [],
  onResolveApproval,
}: ConversationViewProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [nearBottom, setNearBottom] = useState(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth'): void => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior });
    }
  }, []);

  useEffect(() => {
    if (nearBottom) {
      scrollToBottom('auto');
    }
  }, [messages, approvals, nearBottom, scrollToBottom]);

  const handleScroll = (): void => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    setNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  return (
    <div className="conversation-wrap">
      {streaming ? <div className="streaming-bar" aria-hidden="true" /> : null}
      <div className="conversation" ref={scrollRef} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <div className="conversation__empty">
            <p className="conversation__hint">
              我是 jnf-harness 智能体。直接输入消息开始对话；我会按需调用工具
              （文件/搜索/命令等），涉及敏感操作时会在这里向你申请审批。
            </p>
          </div>
        ) : (
          messages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}
        {approvals.length > 0 && onResolveApproval ? (
          <ApprovalCard approvals={approvals} onResolve={onResolveApproval} />
        ) : null}
      </div>
      {!nearBottom ? (
        <button type="button" className="scroll-bottom" onClick={() => scrollToBottom()}>
          ↓ 回到底部
        </button>
      ) : null}
    </div>
  );
}
