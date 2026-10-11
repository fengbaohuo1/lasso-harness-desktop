/**
 * 输入浮层（C1/C2 共用）：`/` 命令面板与 `@` 提及候选的分组列表。
 * - 纯展示组件：分组标题 + 条目（标题/说明/徽标）+ 高亮行；点击=采纳；
 * - 键盘导航由 Composer 统一处理（↑↓/Enter/Tab/Esc）。
 */

import type { ReactElement } from 'react';

/** 浮层条目（命令/工具/文件统一形状）。 */
export interface PaletteEntry {
  key: string;
  /** 分组标题（「命令」「插件命令」「工具」或 provider 标签）。 */
  group: string;
  title: string;
  description?: string;
  badge?: string;
  /** 右侧补充（参数提示/文件大小等）。 */
  hint?: string;
}

export interface InputPaletteProps {
  entries: PaletteEntry[];
  /** 当前高亮下标（-1 无）。 */
  selectedIndex: number;
  /** 鼠标悬停同步高亮。 */
  onHover: (index: number) => void;
  onPick: (index: number) => void;
  /** 浮层底部提示行。 */
  footer?: string;
  /** 无命中时的空态文案。 */
  emptyText?: string;
}

export default function InputPalette({
  entries,
  selectedIndex,
  onHover,
  onPick,
  footer,
  emptyText,
}: InputPaletteProps): ReactElement {
  let lastGroup = '';
  return (
    <div className="palette" role="listbox" aria-label="命令与提及">
      {entries.length === 0 ? (
        <div className="palette__empty">{emptyText ?? '无匹配项'}</div>
      ) : (
        entries.map((entry, index) => {
          const showGroup = entry.group !== lastGroup;
          lastGroup = entry.group;
          return (
            <div key={entry.key}>
              {showGroup ? <div className="palette__group">{entry.group}</div> : null}
              <button
                type="button"
                className={`palette__item${index === selectedIndex ? ' palette__item--active' : ''}`}
                role="option"
                aria-selected={index === selectedIndex}
                onMouseEnter={() => onHover(index)}
                // mousedown 抢在 textarea 失焦前采纳
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(index);
                }}
              >
                <span className="palette__title">{entry.title}</span>
                {entry.description ? (
                  <span className="palette__desc">{entry.description}</span>
                ) : null}
                <span className="palette__tail">
                  {entry.hint ? <span className="palette__hint">{entry.hint}</span> : null}
                  {entry.badge ? <span className="palette__badge">{entry.badge}</span> : null}
                </span>
              </button>
            </div>
          );
        })
      )}
      {footer ? <div className="palette__footer">{footer}</div> : null}
    </div>
  );
}
