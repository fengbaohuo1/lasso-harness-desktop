/**
 * 模型选择器（P11-9 / D11-3）：
 * 原生 <select> 无法做「搜索 + 按渠道分组 + 勾选 + 规格提示」，故换成自定义浮层。
 * 触发器沿用 composer-chip 外观，浮层向上弹出（输入区在窗口底部）。
 * 值为 `channelCode::modelCode`；'' 表示默认（跟随生效渠道）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { CheckIcon, ChevronIcon, ModelIcon, SearchIcon } from './icons';

export interface ModelPickerOption {
  /** `channelCode::modelCode`；'' 表示默认。 */
  value: string;
  /** 模型编码（触发器与列表主文案）。 */
  label: string;
  channelCode: string;
  channelLabel: string;
  /** 所属渠道是生效渠道。 */
  channelActive?: boolean;
  /** 渠道默认模型。 */
  isDefault?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  imageInput?: boolean;
}

export interface ModelPickerProps {
  options: ModelPickerOption[];
  value: string;
  /** 触发器文案（由上层决定，含「默认」兜底）。 */
  activeLabel: string;
  /** 触发器是否显示生效绿点。 */
  activeDot?: boolean;
  disabled?: boolean;
  /** P8-1：`/model` 指令令牌——变化且 >0 时自动展开。 */
  focusToken?: number;
  onChange: (value: string) => void;
}

/** 默认项（跟随生效渠道）。 */
const DEFAULT_OPTION: ModelPickerOption = {
  value: '',
  label: '默认（跟随生效渠道）',
  channelCode: '',
  channelLabel: '',
};

function compact(value?: number): string | null {
  if (!value || value <= 0) {
    return null;
  }
  return value >= 1000 ? `${Math.round(value / 1000)}K` : String(value);
}

type Row =
  | { kind: 'group'; key: string; label: string; active: boolean }
  | { kind: 'item'; key: string; option: ModelPickerOption };

export default function ModelPicker({
  options,
  value,
  activeLabel,
  activeDot,
  disabled,
  focusToken,
  onChange,
}: ModelPickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (focusToken && focusToken > 0 && !disabled) {
      setOpen(true);
      setQuery('');
    }
  }, [focusToken, disabled]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDocMouseDown = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      searchRef.current?.focus();
    }
  }, [open]);

  /** 过滤 + 按渠道分组；默认项永远排第一。 */
  const rows: Row[] = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const matched = options.filter((option) => {
      if (!keyword) {
        return true;
      }
      return (
        option.label.toLowerCase().includes(keyword) ||
        option.channelLabel.toLowerCase().includes(keyword) ||
        option.channelCode.toLowerCase().includes(keyword)
      );
    });
    const result: Row[] = [{ kind: 'item', key: '__default__', option: DEFAULT_OPTION }];
    const groups = new Map<string, ModelPickerOption[]>();
    for (const option of matched) {
      const list = groups.get(option.channelCode) ?? [];
      list.push(option);
      groups.set(option.channelCode, list);
    }
    groups.forEach((list, channelCode) => {
      result.push({
        kind: 'group',
        key: `group:${channelCode}`,
        label: `${list[0].channelLabel}（${list.length}）`,
        active: Boolean(list[0].channelActive),
      });
      for (const option of list) {
        result.push({ kind: 'item', key: option.value, option });
      }
    });
    return result;
  }, [options, query]);

  const itemIndexes = useMemo(
    () => rows.map((row, index) => (row.kind === 'item' ? index : -1)).filter((index) => index >= 0),
    [rows],
  );

  useEffect(() => {
    setHighlight(itemIndexes.length > 0 ? itemIndexes[0] : 0);
  }, [itemIndexes, query]);

  const pick = (option: ModelPickerOption): void => {
    onChange(option.value);
    setOpen(false);
    setQuery('');
  };

  const move = (delta: number): void => {
    if (itemIndexes.length === 0) {
      return;
    }
    const position = itemIndexes.indexOf(highlight);
    const next = position < 0 ? 0 : (position + delta + itemIndexes.length) % itemIndexes.length;
    setHighlight(itemIndexes[next]);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      const row = rows[highlight];
      if (row && row.kind === 'item') {
        event.preventDefault();
        pick(row.option);
      }
    } else if (event.key === 'Escape') {
      // 浮层自己吃掉 Esc，避免连带关掉底下的设置对话框
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="model-picker" ref={rootRef}>
      <button
        type="button"
        className="composer-chip composer-chip--button"
        title="选择本次对话使用的模型"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        {activeDot ? <span className="status-dot status-dot--on" title="生效中" aria-hidden="true" /> : null}
        <ModelIcon />
        <span className="composer-chip__text">{activeLabel}</span>
        <span className="composer-chip__chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>

      {open ? (
        <div className="model-picker__pop" role="listbox" onKeyDown={onKeyDown}>
          <div className="model-picker__search">
            <SearchIcon />
            <input
              ref={searchRef}
              value={query}
              placeholder="搜索模型…"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          <div className="model-picker__list">
            {rows.map((row) =>
              row.kind === 'group' ? (
                <div key={row.key} className="model-picker__group">
                  <span>{row.label}</span>
                  {row.active ? <span className="model-picker__badge">生效</span> : null}
                </div>
              ) : (
                <button
                  key={row.key}
                  type="button"
                  role="option"
                  aria-selected={row.option.value === value}
                  className={`model-picker__item${row.option.value === value ? ' model-picker__item--on' : ''}${
                    rows[highlight] === row ? ' model-picker__item--hl' : ''
                  }`}
                  onMouseEnter={() => {
                    const index = rows.indexOf(row);
                    if (index >= 0) {
                      setHighlight(index);
                    }
                  }}
                  onClick={() => pick(row.option)}
                >
                  <span className="model-picker__name">{row.option.label}</span>
                  <span className="model-picker__spec">
                    {compact(row.option.contextWindow) ? `${compact(row.option.contextWindow)} 窗口` : ''}
                    {compact(row.option.maxOutputTokens)
                      ? `${compact(row.option.contextWindow) ? ' · ' : ''}${compact(row.option.maxOutputTokens)} 输出`
                      : ''}
                    {row.option.imageInput ? ' · 图片' : ''}
                  </span>
                  {row.option.isDefault ? <span className="model-picker__tag">默认</span> : null}
                  {row.option.value === value ? <CheckIcon /> : null}
                </button>
              ),
            )}
            {options.length === 0 ? (
              <div className="model-picker__empty">还没有可用模型，先去「设置 → 模型渠道」添加。</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
