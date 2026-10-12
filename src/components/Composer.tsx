/**
 * 输入区（P9-4，对齐 dsh prompt-shell）：24px 圆角卡片 = textarea + 工具条。
 * - 工具条左栏：工作区选择器（文件夹 + 名称 + chevron）+ 权限胶囊（盾 + 三档）；
 * - 工具条右栏：模型胶囊 + 思考胶囊（跟随预设/关/低/中/高）+ 上下文圆环 + 发送/停止；
 * - 保留：rows=1 自适应增高、Enter 发送 / Shift+Enter 换行、`/` `@` 浮层键盘导航、
 *   历史草稿 ↑↓、IME 守卫；placeholder「输入消息 · / 命令 · @ 文件」。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import InputPalette from './InputPalette';
import type { PaletteEntry } from './InputPalette';
import { BrainIcon, ChevronIcon, SendIcon, ShieldIcon, StopIcon, WorkspaceIcon } from './icons';
import { fillTemplate, filterSlashItems } from '../lib/commands';
import type { PaletteState, SlashItem } from '../lib/commands';
import { detectPaletteToken } from '../lib/commands';
import { fetchMentionGroups } from '../lib/mentions';
import type { MentionCandidate } from '../lib/mentions';
import { usePluginUiMap } from '../lib/plugin-ui';
import type { ReasoningEffort, WorkspaceItem } from '../types';

/** 模型选项（数据源 GET /api/harness/settings/models）。 */
export interface ComposerModelOption {
  /** 传给 POST /api/agent/stream 的 model 字段；空串 = 默认（跟随生效渠道）。 */
  value: string;
  /** 展示名「渠道 · 模型」。 */
  label: string;
  /** 生效渠道打徽标。 */
  active?: boolean;
}

/** 沙箱权限模式（P9-2，沙箱插件三档）。 */
export type PermissionMode = 'READ_ONLY' | 'WORKSPACE_WRITE' | 'DANGER_FULL_ACCESS';

export const PERMISSION_LABEL: Record<PermissionMode, string> = {
  READ_ONLY: '只读（不限于工作区）',
  WORKSPACE_WRITE: '工作区内读写',
  DANGER_FULL_ACCESS: '完全权限',
};

const PERMISSION_TITLE: Record<PermissionMode, string> = {
  READ_ONLY: '只读：写类工具与命令一律拒绝，读不受限',
  WORKSPACE_WRITE: '工作区内读写：写路径限定会话工作区，命令受越逸约束',
  DANGER_FULL_ACCESS: '完全权限：不做沙箱限制（危险操作仍走审批）',
};

export interface ComposerProps {
  /** 启动链未就绪时禁用输入。 */
  disabled: boolean;
  /** 是否正在生成（显示停止按钮、Enter 不发送）。 */
  streaming: boolean;
  /** 历史草稿（旧→新），↑/↓ 召回。 */
  history?: string[];
  /** 模型选项列表（首项由本组件补「默认」）。 */
  models: ComposerModelOption[];
  /** 当前选择的 model 值；'' = 默认。 */
  selectedModel: string;
  onSelectModel: (model: string) => void;
  /** P9-8：思考强度；null = 跟随预设。 */
  thinking?: ReasoningEffort | null;
  onSelectThinking?: (effort: ReasoningEffort | null) => void;
  /** P9-1：工作区列表与当前选择（无会话时禁用选择器）。 */
  workspaces?: WorkspaceItem[];
  selectedWorkspace?: string | null;
  onSelectWorkspace?: (workspaceCode: string) => void;
  workspaceDisabled?: boolean;
  /** P9-2：沙箱权限模式（会话级）。 */
  permission?: PermissionMode;
  onSelectPermission?: (mode: PermissionMode) => void;
  /** P9-4：上下文圆环数据（contextTokens/contextBudget）。 */
  contextTokens?: number;
  contextBudget?: number | null;
  /** C1：命令面板数据（内置 + 插件 slashCommands + 工具目录）。 */
  slashItems?: SlashItem[];
  /** C1：action 型命令本地执行（new/settings/theme/help）。 */
  onCommand?: (action: string) => void;
  /** 焦点令牌：变化时聚焦输入框（欢迎页快捷入口用）。 */
  focusToken?: number;
  /** P8-1：/model 指令——变化时聚焦模型选择（行为控制不进消息）。 */
  modelFocusToken?: number;
  onSend: (text: string) => void | Promise<void>;
  onStop: () => void;
}

const MAX_INPUT_HEIGHT = 200;

/** 浮层条目与载荷。 */
interface PaletteRow {
  entry: PaletteEntry;
  payload: SlashItem | MentionCandidate;
}

/** 上下文圆环（22×22 SVG，≥50% 黄、≥80% 红）。 */
function ContextRing({ tokens, budget }: { tokens: number; budget: number | null }): ReactElement {
  const ratio = budget && budget > 0 ? Math.min(1, tokens / budget) : 0;
  const pct = Math.round(ratio * 100);
  const color = ratio >= 0.8 ? 'var(--danger)' : ratio >= 0.5 ? 'var(--warning)' : 'var(--accent)';
  const r = 8;
  const circumference = 2 * Math.PI * r;
  return (
    <span
      className="context-ring"
      title={
        budget
          ? `上下文占用 ${tokens.toLocaleString()} / ${budget.toLocaleString()} tokens（${pct}%）`
          : `上下文占用 ${tokens.toLocaleString()} tokens`
      }
    >
      <svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true">
        <circle cx="11" cy="11" r={r} fill="none" stroke="var(--border-strong)" strokeWidth="2.5" />
        <circle
          cx="11"
          cy="11"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeDasharray={`${circumference * ratio} ${circumference}`}
          strokeLinecap="round"
          transform="rotate(-90 11 11)"
        />
      </svg>
      <span className="context-ring__pct">{pct}</span>
    </span>
  );
}

export default function Composer({
  disabled,
  streaming,
  history = [],
  models,
  selectedModel,
  onSelectModel,
  thinking = null,
  onSelectThinking,
  workspaces = [],
  selectedWorkspace = null,
  onSelectWorkspace,
  workspaceDisabled = false,
  permission = 'WORKSPACE_WRITE',
  onSelectPermission,
  contextTokens = 0,
  contextBudget = null,
  slashItems = [],
  onCommand,
  focusToken = 0,
  modelFocusToken = 0,
  onSend,
  onStop,
}: ComposerProps): ReactElement {
  const [draft, setDraft] = useState('');
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [palette, setPalette] = useState<PaletteState | null>(null);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [mentionItems, setMentionItems] = useState<MentionCandidate[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const modelSelectRef = useRef<HTMLSelectElement | null>(null);
  const uiMap = usePluginUiMap();

  const canSend = !disabled && !streaming && draft.trim() !== '';

  // F2：textarea 自动增高（约 200px 后出滚动条）
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [draft]);

  // F4：欢迎页快捷入口「开始对话」→ 聚焦输入框
  useEffect(() => {
    if (focusToken > 0) {
      textareaRef.current?.focus();
    }
  }, [focusToken]);

  // P8-1：/model 指令 → 聚焦模型选择
  useEffect(() => {
    if (modelFocusToken > 0) {
      modelSelectRef.current?.focus();
    }
  }, [modelFocusToken]);

  // C2：@ 候选防抖拉取（150ms；provider 失败静默跳过）
  useEffect(() => {
    if (!palette || palette.mode !== 'mention') {
      setMentionItems([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchMentionGroups(uiMap, palette.query).then((groups) => {
        if (!cancelled) {
          setMentionItems(groups.flatMap((group) => group.items));
        }
      });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [palette, uiMap]);

  const paletteRows: PaletteRow[] = useMemo(() => {
    if (!palette) {
      return [];
    }
    if (palette.mode === 'slash') {
      return filterSlashItems(slashItems, palette.query).map((item) => ({
        entry: {
          key: item.id,
          group: item.group,
          title: item.argumentHint ? `${item.title} ⟨${item.argumentHint}⟩` : item.title,
          description: item.description,
          badge: item.badge,
        },
        payload: item,
      }));
    }
    return mentionItems.map((item) => ({
      entry: {
        key: `${item.pluginId}:${item.value}`,
        group: item.providerLabel,
        title: item.label,
        description: item.value,
        hint: item.description,
      },
      payload: item,
    }));
  }, [palette, slashItems, mentionItems]);

  const syncPalette = (text: string, caret: number): void => {
    const next = detectPaletteToken(text, caret);
    setPalette((prev) => {
      if (!next) {
        return null;
      }
      if (prev && prev.mode === next.mode && prev.start === next.start && prev.query === next.query) {
        return prev;
      }
      return next;
    });
    setPaletteIndex(0);
  };

  /** 采纳浮层项：action 执行 / prompt 填模板 / 提及插路径。 */
  const applyPaletteRow = (index: number): void => {
    const row = paletteRows[index];
    const state = palette;
    if (!row || !state) {
      return;
    }
    const el = textareaRef.current;
    const caret = el ? el.selectionStart : draft.length;
    const head = draft.slice(0, state.start);
    const tail = draft.slice(caret);

    if (state.mode === 'mention') {
      const item = row.payload as MentionCandidate;
      const inserted = `@${item.value} `;
      setDraft(`${head}${inserted}${tail}`);
      setPalette(null);
      focusAt(head.length + inserted.length);
      return;
    }

    const command = row.payload as SlashItem;
    if (command.kind === 'action') {
      setDraft(`${head}${tail}`);
      setPalette(null);
      if (command.action && onCommand) {
        onCommand(command.action);
      }
      return;
    }

    const template = command.template ?? '';
    const filled = fillTemplate(template, '');
    const argIndex = template.indexOf('{arg}');
    if (command.send) {
      setDraft('');
      setPalette(null);
      const message = `${head}${filled}${tail}`.trim();
      if (message) {
        void onSend(message);
      }
      return;
    }
    setDraft(`${head}${filled}${tail}`);
    setPalette(null);
    focusAt(argIndex >= 0 ? head.length + argIndex : head.length + filled.length);
  };

  const focusAt = (position: number): void => {
    window.requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(position, position);
      }
    });
  };

  const submit = (): void => {
    const text = draft.trim();
    if (!text || !canSend) {
      return;
    }
    setDraft('');
    setHistoryIndex(null);
    setPalette(null);
    void onSend(text);
    textareaRef.current?.focus();
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    submit();
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    const target = e.currentTarget;
    // 浮层开着：↑↓/Enter/Tab/Esc 归浮层
    if (palette) {
      const len = paletteRows.length;
      if (e.key === 'ArrowDown' && len > 0) {
        e.preventDefault();
        setPaletteIndex((i) => (i + 1) % len);
        return;
      }
      if (e.key === 'ArrowUp' && len > 0) {
        e.preventDefault();
        setPaletteIndex((i) => (i - 1 + len) % len);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (len > 0) {
          applyPaletteRow(paletteIndex);
        } else {
          setPalette(null);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setPalette(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!streaming) {
        submit();
      }
      // 流式期间 Enter 不发送（可继续打字排队，完成后回车发送；Ctrl+Enter 同语义）
      return;
    }
    if (e.key === 'ArrowUp' && history.length > 0 && target.selectionStart === 0) {
      e.preventDefault();
      const next = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      setDraft(history[next]);
      return;
    }
    if (e.key === 'ArrowDown' && historyIndex !== null) {
      e.preventDefault();
      const next = historyIndex + 1;
      if (next >= history.length) {
        setHistoryIndex(null);
        setDraft('');
      } else {
        setHistoryIndex(next);
        setDraft(history[next]);
      }
    }
  };

  const placeholder = disabled
    ? 'Agent 尚未就绪…'
    : streaming
      ? '生成中…'
      : '输入消息 · / 命令 · @ 文件';

  return (
    <form className="composer composer--shell" onSubmit={handleSubmit}>
      {palette ? (
        <InputPalette
          entries={paletteRows.map((row) => row.entry)}
          selectedIndex={paletteIndex}
          onHover={setPaletteIndex}
          onPick={applyPaletteRow}
          footer="↑↓ 选择 · Enter/Tab 采纳 · Esc 关闭"
          emptyText={
            palette.mode === 'slash' ? '无匹配命令（/help 看全部）' : '无匹配文件（继续输入可模糊过滤）'
          }
        />
      ) : null}
      <textarea
        ref={textareaRef}
        className="composer__input"
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        onChange={(e) => {
          setDraft(e.target.value);
          syncPalette(e.target.value, e.target.selectionStart);
        }}
        onSelect={(e) => syncPalette(e.currentTarget.value, e.currentTarget.selectionStart)}
        onKeyDown={handleKeyDown}
        onBlur={() => setPalette(null)}
      />
      <div className="composer__toolbar">
        {/* 左栏：工作区 + 权限 */}
        <div className="composer__toolbar-left">
          <label className="composer-chip composer-chip--workspace" title="会话工作区（工具按此目录解析路径）">
            <WorkspaceIcon />
            <select
              className="composer-chip__select"
              value={selectedWorkspace ?? ''}
              disabled={workspaceDisabled}
              aria-label="选择工作区"
              onChange={(e) => onSelectWorkspace?.(e.target.value)}
            >
              {workspaces.length === 0 ? <option value="">默认工作区</option> : null}
              {workspaces.map((workspace) => (
                <option key={workspace.workspaceCode} value={workspace.workspaceCode}>
                  {workspace.displayName}
                </option>
              ))}
            </select>
            <span className="composer-chip__chevron" aria-hidden="true">
              <ChevronIcon />
            </span>
          </label>
          <label
            className={`composer-chip composer-chip--permission composer-chip--${permission.toLowerCase()}`}
            title={PERMISSION_TITLE[permission]}
          >
            <ShieldIcon />
            <select
              className="composer-chip__select"
              value={permission}
              aria-label="工具执行权限"
              onChange={(e) => onSelectPermission?.(e.target.value as PermissionMode)}
            >
              {Object.entries(PERMISSION_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <span className="composer-chip__chevron" aria-hidden="true">
              <ChevronIcon />
            </span>
          </label>
        </div>
        {/* 右栏：模型 + 思考 + 圆环 + 发送 */}
        <div className="composer__toolbar-right">
          <label className="composer-chip" title="选择本次对话使用的模型（默认跟随生效渠道）">
            <select
              ref={modelSelectRef}
              className="composer-chip__select"
              value={selectedModel}
              aria-label="选择模型"
              onChange={(e) => onSelectModel(e.target.value)}
            >
              <option value="">模型 · 默认</option>
              {models.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.active ? `${option.label} · 生效` : option.label}
                </option>
              ))}
            </select>
            <span className="composer-chip__chevron" aria-hidden="true">
              <ChevronIcon />
            </span>
          </label>
          {onSelectThinking ? (
            <label className="composer-chip composer-chip--thinking" title="思考强度：低=更快响应、中=平衡、高=充分推理">
              <BrainIcon />
              <select
                className="composer-chip__select"
                value={thinking ?? ''}
                aria-label="思考强度"
                onChange={(e) => onSelectThinking((e.target.value || null) as ReasoningEffort | null)}
              >
                <option value="">思考 · 跟随</option>
                <option value="off">思考 · 关</option>
                <option value="low">思考 · 低</option>
                <option value="medium">思考 · 中</option>
                <option value="high">思考 · 高</option>
              </select>
              <span className="composer-chip__chevron" aria-hidden="true">
                <ChevronIcon />
              </span>
            </label>
          ) : null}
          <ContextRing tokens={contextTokens} budget={contextBudget} />
          <div className="composer__actions">
            {streaming ? (
              <button
                type="button"
                className="icon-btn icon-btn--stop"
                title="停止生成"
                aria-label="停止生成"
                onClick={onStop}
              >
                <StopIcon />
              </button>
            ) : (
              <button
                type="submit"
                className="icon-btn icon-btn--send"
                title="发送（Enter）"
                aria-label="发送"
                disabled={!canSend}
              >
                <SendIcon />
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
