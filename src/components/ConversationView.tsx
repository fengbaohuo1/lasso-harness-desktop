/**
 * 对话视图（M8）：消息 + 流式渲染 + 工具卡片（默认折叠）+ 审批/提问插槽。
 * 助手消息为全宽正文（无气泡），用户消息右侧气泡；消息内文本/工具卡按到达序混排；
 * 助手正文走 markdown-lite（表格/代码块带复制）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import MarkdownLite from '../lib/markdown-lite';
import ApprovalCard from './ApprovalCard';
import QuestionCard from './QuestionCard';
import type {
  ApprovalVerdict,
  ChatMessage,
  MsgSegment,
  RuntimeApprovalDto,
  RuntimeQuestionDto,
  ToolCardState,
} from '../types';

export interface ConversationViewProps {
  messages: ChatMessage[];
  streaming: boolean;
  approvals?: RuntimeApprovalDto[];
  questions?: RuntimeQuestionDto[];
  onResolveApproval?: (approvalId: string, verdict: ApprovalVerdict) => void;
  onAnswerQuestion?: (questionId: string, answer: string) => void;
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

/** 工具卡片（M8 #1）：默认折叠，头部一行摘要，点击展开参数/结果。 */
function ToolCard({ card }: { card: ToolCardState }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const argsText = formatValue(card.args);
  const resultText = card.error ? card.error : formatValue(card.result);
  const statusLabel: Record<ToolCardState['status'], string> = {
    running: '运行中',
    success: '成功',
    error: '失败',
  };
  const summary = (resultText || argsText || '').split('\n')[0].slice(0, 60);

  return (
    <div className={`tool-card tool-card--${card.status}`}>
      <button
        type="button"
        className="tool-card__head tool-card__head--toggle"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className={`tool-card__icon tool-card__icon--${card.status}`} aria-hidden="true">
          {card.status === 'running' ? '⚙' : card.status === 'success' ? '✓' : '✕'}
        </span>
        <span className="tool-card__name">{card.toolName}</span>
        <span className={`tool-card__status tool-card__status--${card.status}`}>
          {statusLabel[card.status]}
        </span>
        {!expanded && summary ? <span className="tool-card__summary">{summary}</span> : null}
        <span className="tool-card__chevron" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded ? (
        <div>
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
      ) : null}
    </div>
  );
}

/** 消息内混排（M8 #8）：无 segments 时按 先卡片后文本 兜底。 */
function Segments({
  message,
  isUser,
}: {
  message: ChatMessage;
  isUser: boolean;
}): ReactElement {
  const segments: MsgSegment[] =
    message.segments ??
    [
      ...message.toolCards.map((card): MsgSegment => ({ kind: 'card', card })),
      ...(message.text ? [{ kind: 'text' as const, text: message.text }] : []),
    ];
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          <div key={`t${index}`} className="message-text">
            {isUser ? (
              <span className="message-text__plain">{segment.text}</span>
            ) : (
              <MarkdownLite text={segment.text} />
            )}
            {!isUser && message.status === 'streaming' && index === segments.length - 1 ? (
              <span className="cursor" aria-hidden="true" />
            ) : null}
          </div>
        ) : (
          <ToolCard key={segment.card.key} card={segment.card} />
        ),
      )}
    </>
  );
}

function MessageBlock({ message }: { message: ChatMessage }): ReactElement {
  const isUser = message.role === 'user';
  const copyText = message.text;
  return (
    <div className={`message-row message-row--${isUser ? 'user' : 'assistant'}`}>
      {isUser ? (
        <div className="bubble bubble--user">
          <Segments message={message} isUser />
          <div className="bubble__meta">
            {timeLabel(message.createdAt)}
            {copyText ? <CopyTextButton text={copyText} /> : null}
          </div>
        </div>
      ) : (
        <div className="assistant-block">
          <Segments message={message} isUser={false} />

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

          <div className="message-meta">
            {timeLabel(message.createdAt)}
            {message.status === 'cancelled' ? ' · 已停止' : ''}
            {message.status === 'error' ? ' · 出错' : ''}
            {copyText ? <CopyTextButton text={copyText} /> : null}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ConversationView({
  messages,
  streaming,
  approvals = [],
  questions = [],
  onResolveApproval,
  onAnswerQuestion,
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
  }, [messages, approvals, questions, nearBottom, scrollToBottom]);

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
          messages.map((message) => <MessageBlock key={message.id} message={message} />)
        )}
        {approvals.length > 0 && onResolveApproval ? (
          <ApprovalCard approvals={approvals} onResolve={onResolveApproval} />
        ) : null}
        {questions.length > 0 && onAnswerQuestion ? (
          <QuestionCard questions={questions} onAnswer={onAnswerQuestion} />
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
