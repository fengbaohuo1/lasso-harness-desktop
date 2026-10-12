/**
 * 任务状态（P9-3）：从消息流的 todo_write 工具卡中提取最新任务快照。
 * - TaskCard：状态点 + 「任务清单」+ 进度徽标 x/y + 清单行（✓ 完成 / 呼吸点 进行中 / 空圈 待办）；
 * - taskStatusBar 文案「任务 2/5 · 当前进行项」由调用方组合（本组件导出快照工具函数）；
 * - 零新事件：todo_write 整表快照随 tool_result/回放下发，前端聚合最新一份。
 */

import { useMemo } from 'react';
import type { ReactElement } from 'react';
import type { ChatMessage, ToolCardState } from '../types';

/** 单条待办。 */
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | string;
}

/** 最新任务快照（completed/total + 明细）。 */
export interface TodoSnapshot {
  items: TodoItem[];
  completed: number;
  total: number;
  inProgress?: string;
  updatedAt: number;
}

/** 从工具卡参数中解析 items 数组（兼容 JSON 字符串 / 对象数组）。 */
function parseItems(raw: unknown): TodoItem[] | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    value = (value as { items?: unknown }).items;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const items: TodoItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as { content?: unknown; status?: unknown };
    if (typeof record.content !== 'string') {
      continue;
    }
    items.push({
      content: record.content,
      status: typeof record.status === 'string' ? record.status : 'pending',
    });
  }
  return items.length > 0 ? items : null;
}

/** 从工具卡中识别 todo_write 并解析快照。 */
function snapshotOf(card: ToolCardState): TodoSnapshot | null {
  if (card.toolName !== 'todo_write' && !card.toolName.endsWith('__todo_write')) {
    return null;
  }
  const source =
    card.args && typeof card.args === 'object' && 'items' in (card.args as object)
      ? (card.args as { items: unknown }).items
      : card.args;
  const items = parseItems(source);
  if (!items) {
    return null;
  }
  const completed = items.filter((item) => item.status === 'completed').length;
  const inProgress = items.find((item) => item.status === 'in_progress')?.content;
  return { items, completed, total: items.length, inProgress, updatedAt: card.endedAt ?? card.startedAt };
}

/** 全消息流的最新任务快照（后写覆盖前写；无任务返回 null）。 */
export function latestTodoSnapshot(messages: ChatMessage[]): TodoSnapshot | null {
  let latest: TodoSnapshot | null = null;
  for (const message of messages) {
    for (const card of message.toolCards) {
      const snapshot = snapshotOf(card);
      if (snapshot && (!latest || snapshot.updatedAt >= latest.updatedAt)) {
        latest = snapshot;
      }
    }
  }
  return latest;
}

/** 单个工具卡的任务快照（null = 非 todo_write，回落通用工具卡渲染）。 */
export function todoSnapshotOf(card: ToolCardState): TodoSnapshot | null {
  return snapshotOf(card);
}

/** 会话顶部任务状态条：「任务 2/5 · 当前进行项」。 */
export function TaskStatusBar({ snapshot }: { snapshot: TodoSnapshot }): ReactElement {
  return (
    <div className="task-status-bar">
      <span className={`task-dot${snapshot.completed === snapshot.total ? ' task-dot--done' : ''}`} aria-hidden="true" />
      <span className="task-status-bar__count">
        任务 <b>{snapshot.completed}</b>/{snapshot.total}
      </span>
      {snapshot.inProgress ? (
        <span className="task-status-bar__current">{snapshot.inProgress}</span>
      ) : snapshot.completed === snapshot.total ? (
        <span className="task-status-bar__current">全部完成</span>
      ) : null}
    </div>
  );
}

/** 任务清单卡片（原位渲染 todo_write 的展开内容）。 */
export default function TaskCard({ snapshot }: { snapshot: TodoSnapshot }): ReactElement {
  const rows = useMemo(
    () =>
      snapshot.items.map((item) => ({
        ...item,
        state: item.status === 'completed' ? 'done' : item.status === 'in_progress' ? 'doing' : 'todo',
      })),
    [snapshot],
  );
  return (
    <div className="task-card">
      <div className="task-card__head">
        <span className={`task-dot${snapshot.completed === snapshot.total ? ' task-dot--done' : ''}`} aria-hidden="true" />
        <span className="task-card__title">任务清单</span>
        <span className="task-card__badge">
          {snapshot.completed}/{snapshot.total}
        </span>
      </div>
      <ul className="task-card__list">
        {rows.map((row, index) => (
          <li key={`${row.content}-${index}`} className={`task-card__item task-card__item--${row.state}`}>
            <span className="task-card__mark" aria-hidden="true">
              {row.state === 'done' ? (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 8.4l3.2 3.2L13 4.8" />
                </svg>
              ) : row.state === 'doing' ? (
                <span className="task-card__pulse" />
              ) : (
                <span className="task-card__circle" />
              )}
            </span>
            <span className="task-card__content">{row.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
