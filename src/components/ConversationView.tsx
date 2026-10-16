/**
 * 对话视图（M8）：消息 + 流式渲染 + 工具卡片（默认折叠）+ 审批/提问插槽。
 * 助手消息为全宽正文（无气泡），用户消息右侧气泡；消息内文本/工具卡按到达序混排；
 * 助手正文走 markdown-lite（表格/代码块带复制）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import MarkdownLite from '../lib/markdown-lite';
import {
  findToolRenderer,
  parseToolResult,
  renderTemplate,
  usePluginUiMap,
  visibleBlocks,
  type RenderContext,
} from '../lib/plugin-ui';
import ApprovalCard from './ApprovalCard';
import QuestionCard from './QuestionCard';
import ToolCardBlocks from './ToolCardBlocks';
import ReasoningBlock from './ReasoningBlock';
import TaskCard, { latestTodoSnapshot, todoSnapshotOf, TaskStatusBar } from './TaskCard';
import type { TodoSnapshot } from './TaskCard';
import {
  ArrowDownIcon,
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  GearIcon,
  RefreshIcon,
} from './icons';
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

/** 工具卡片（M8 #1）：默认折叠，头部一行摘要，点击展开参数/结果。
 * U2：命中插件 toolRenderer 的工具按 plugin-ui.json blocks 渲染
 * （折叠头用 title/summary 模板结果，展开渲 blocks；取不到回退默认视图）。 */
function ToolCard({ card }: { card: ToolCardState }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const uiMap = usePluginUiMap();
  const match = findToolRenderer(uiMap, card.toolName);
  const todo: TodoSnapshot | null = useMemo(() => todoSnapshotOf(card), [card]);
  const ctx: RenderContext = useMemo(
    () => ({ args: card.args, result: parseToolResult(card.result) }),
    [card.args, card.result],
  );
  const argsText = formatValue(card.args);
  const resultText = card.error ? card.error : formatValue(card.result);
  const statusLabel: Record<ToolCardState['status'], string> = {
    running: '运行中',
    success: '成功',
    error: '失败',
  };
  const fallbackSummary = (resultText || argsText || '').split('\n')[0].slice(0, 60);
  const renderedTitle = match ? renderTemplate(match.renderer.title ?? '', ctx) : '';
  const renderedSummary = match ? renderTemplate(match.renderer.summary ?? '', ctx) : '';
  const displayName = renderedTitle || card.toolName;
  const summary = renderedSummary || fallbackSummary;
  const rendererVisible = match ? visibleBlocks(match.renderer.blocks ?? [], ctx).length > 0 : false;

  return (
    <div className={`tool-card tool-card--${card.status}`}>
      <button
        type="button"
        className="tool-card__head tool-card__head--toggle"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className={`tool-card__icon tool-card__icon--${card.status}`} aria-hidden="true">
          {card.status === 'running' ? (
            <GearIcon />
          ) : card.status === 'success' ? (
            <CheckIcon />
          ) : (
            <CloseIcon />
          )}
        </span>
        <span className="tool-card__name">{displayName}</span>
        <span className={`tool-card__status tool-card__status--${card.status}`}>
          {statusLabel[card.status]}
        </span>
        {!expanded && summary ? <span className="tool-card__summary">{summary}</span> : null}
        <span
          className={`tool-card__chevron${expanded ? ' tool-card__chevron--open' : ''}`}
          aria-hidden="true"
        >
          <ChevronIcon />
        </span>
      </button>
      {expanded ? (
        <div>
          {/* P9-3：todo_write 命中任务卡渲染（快照清单，替代原始 JSON） */}
          {todo ? <TaskCard snapshot={todo} /> : null}
          {!todo && match && rendererVisible ? (
            <ToolCardBlocks blocks={match.renderer.blocks ?? []} pluginId={match.pluginId} ctx={ctx} />
          ) : null}
          {!todo && (!match || !rendererVisible) ? (
            <>
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
            </>
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
          {/* P9-8：思考内容折叠块（流式「思考中」/静止「思考过程」） */}
          {message.reasoning ? (
            <ReasoningBlock text={message.reasoning} streaming={message.reasoningStreaming === true} />
          ) : null}
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

  // P9-3：会话任务状态（todo_write 最新快照；无任务不显示状态条）
  const todoSnapshot = useMemo(() => latestTodoSnapshot(messages), [messages]);

  return (
    <div className="conversation-wrap">
      {streaming ? <div className="streaming-bar" aria-hidden="true" /> : null}
      <div className="conversation" ref={scrollRef} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <div className="welcome-hero">
            <div className="welcome-hero__logo" aria-hidden="true">
              jnf
            </div>
            <h1 className="welcome-hero__title">jnf-harness Desktop</h1>
            <p className="welcome-hero__desc">
              自有 Agent Harness 桌面端：对话驱动，按需调用工具（文件/搜索/命令），
              敏感操作先审批后执行，会话事件全程可回放。
            </p>
            <div className="welcome-hero__actions">
              <button
                type="button"
                className="welcome-action"
                onClick={() => onQuickAction?.('chat')}
              >
                开始对话
              </button>
              <button
                type="button"
                className="welcome-action"
                onClick={() => onQuickAction?.('models')}
              >
                模型设置
              </button>
              <button
                type="button"
                className="welcome-action"
                onClick={() => onQuickAction?.('plugins')}
              >
                插件管理
              </button>
              <button
                type="button"
                className="welcome-action"
                onClick={() => onQuickAction?.('about')}
              >
                关于
              </button>
            </div>
            <p className="welcome-hero__shortcut">
              Enter 发送 · / 命令与工具 · @ 引用文件 · Ctrl+N 新对话 · Ctrl+, 设置
            </p>
          </div>
        ) : (
          <>
            {todoSnapshot ? <TaskStatusBar snapshot={todoSnapshot} /> : null}
            {messages.map((message, index) => (
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
            ))}
          </>
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
          <ArrowDownIcon /> 回到底部
        </button>
      ) : null}
    </div>
  );
}
