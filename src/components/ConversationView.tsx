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
import { RefreshIcon } from './icons';
import type {
  ApprovalVerdict,
  ChatMessage,
  MsgSegment,
  RuntimeApprovalDto,
  RuntimeQuestionDto,
  ToolCardState,
} from '../types';

/** 欢迎页快捷入口动作（F4 空态）。 */
export type QuickAction = 'chat' | 'models' | 'plugins' | 'about';

export interface ConversationViewProps {
  messages: ChatMessage[];
  streaming: boolean;
  approvals?: RuntimeApprovalDto[];
  questions?: RuntimeQuestionDto[];
  onResolveApproval?: (approvalId: string, verdict: ApprovalVerdict) => void;
  onAnswerQuestion?: (questionId: string, answer: string) => void;
  /** 重新生成（F4）：重发最后一条助手消息的上一条用户消息。 */
  onRegenerate?: () => void;
  /** 欢迎页快捷入口（F4 空态）。 */
  onQuickAction?: (action: QuickAction) => void;
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

function MessageBlock({
  message,
  showRegenerate,
  onRegenerate,
}: {
  message: ChatMessage;
  showRegenerate: boolean;
  onRegenerate?: () => void;
}): ReactElement {
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
            {message.regenerating && message.status === 'streaming' ? (
              <button
                type="button"
                className="message-meta__action message-meta__action--busy"
                disabled
                title="正在重新生成"
              >
                <RefreshIcon /> 生成中…
              </button>
            ) : null}
            {showRegenerate && onRegenerate ? (
              <button
                type="button"
                className="message-meta__action"
                title="重新生成：重发上一条用户消息"
                onClick={onRegenerate}
              >
                <RefreshIcon /> 重新生成
              </button>
            ) : null}
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
  onRegenerate,
  onQuickAction,
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

  // 最后一条助手消息提供「重新生成」（流式中不显示）
  const lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'assistant') {
        return i;
      }
    }
    return -1;
  })();

  return (
    <div className="conversation-wrap">
      {streaming ? <div className="streaming-bar" aria-hidden="true" /> : null}
      <div className="conversation" ref={scrollRef} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <div className="welcome-hero">
            <div className="welcome-hero__logo" aria-hidden="true">
              ◆
            </div>
            <h1 className="welcome-hero__title">jnf-harness Desktop</h1>
            <p className="welcome-hero__desc">
              自有 Agent Harness 桌面端：对话驱动，按需调用工具（文件/搜索/命令），
              敏感操作先审批后执行，会话事件全程可回放。
            </p>
            <div className="welcome-hero__cards">
              <button
                type="button"
                className="welcome-card"
                onClick={() => onQuickAction?.('chat')}
              >
                <div className="welcome-card__title">开始对话</div>
                <div className="welcome-card__hint">聚焦输入框，直接提问或下达任务</div>
              </button>
              <button
                type="button"
                className="welcome-card"
                onClick={() => onQuickAction?.('models')}
              >
                <div className="welcome-card__title">模型设置</div>
                <div className="welcome-card__hint">配置厂商渠道、密钥，测试连接并启用</div>
              </button>
              <button
                type="button"
                className="welcome-card"
                onClick={() => onQuickAction?.('plugins')}
              >
                <div className="welcome-card__title">插件管理</div>
                <div className="welcome-card__hint">安装/启用/停用插件，编辑插件配置</div>
              </button>
              <button
                type="button"
                className="welcome-card"
                onClick={() => onQuickAction?.('about')}
              >
                <div className="welcome-card__title">关于</div>
                <div className="welcome-card__hint">版本、快捷键一览与项目说明</div>
              </button>
            </div>
            <p className="welcome-hero__shortcut">
              Enter 发送 · Shift+Enter 换行 · Ctrl+N 新对话 · Ctrl+, 设置
            </p>
          </div>
        ) : (
          messages.map((message, index) => (
            <MessageBlock
              key={message.id}
              message={message}
              showRegenerate={
                index === lastAssistantIndex &&
                index === messages.length - 1 &&
                !streaming &&
                message.status !== 'streaming'
              }
              onRegenerate={onRegenerate}
            />
          ))
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
