/**
 * 输入区（F2 + C1/C2）：模型/画像 chip + 自动增高输入 + 发送/停止 + 草稿历史 +
 * `/` 命令面板（内置命令/插件命令/工具，SC1~SC3）与 `@` 文件提及候选（mentionProviders）。
 * - Enter 发送、Shift+Enter 换行；↑/↓ 召回历史草稿；IME 组合守卫保留；
 * - 浮层开着时 ↑↓/Enter/Tab/Esc 归浮层（选中=采纳/关闭）；
 * - `/` 仅在输入开头触发（命令语义），`@` 在空白后触发（提及语义）；
 * - action 命令走 onCommand 本地执行；prompt 命令填模板（{arg} 处留光标）；
 *   mode:'send' 直接发送；工具项插入工具引导文本；提及选中插 `@path`。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import InputPalette from './InputPalette';
import type { PaletteEntry } from './InputPalette';
import { SendIcon, StopIcon } from './icons';
import { fillTemplate, filterSlashItems } from '../lib/commands';
import type { PaletteState, SlashItem } from '../lib/commands';
import { detectPaletteToken } from '../lib/commands';
import { fetchMentionGroups } from '../lib/mentions';
import type { MentionCandidate } from '../lib/mentions';
import { usePluginUiMap } from '../lib/plugin-ui';

/** 模型选项（数据源 GET /api/harness/settings/models）。 */
export interface ComposerModelOption {
  /** 传给 POST /api/agent/stream 的 model 字段；空串 = 默认（跟随生效渠道）。 */
  value: string;
  /** 展示名「渠道 · 模型」。 */
  label: string;
  /** 生效渠道打徽标。 */
  active?: boolean;
}

/** 画像选项（数据源 GET /api/harness/profiles，A4）。 */
export interface ComposerProfileOption {
  /** 传给 POST /api/agent/stream 的 profile 字段；空串 = 默认画像（default）。 */
  value: string;
  /** 展示名「名称（编码）」。 */
  label: string;
}

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
  /** 画像选项列表（首项由本组件补「默认画像」，A4）。 */
  profiles?: ComposerProfileOption[];
  /** 当前选择的画像码；'' = 默认画像。 */
  selectedProfile?: string;
  onSelectProfile?: (profile: string) => void;
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

export default function Composer({
  disabled,
  streaming,
  history = [],
  models,
  selectedModel,
  onSelectModel,
  profiles = [],
  selectedProfile = '',
  onSelectProfile,
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
    <form className="composer" onSubmit={handleSubmit}>
      <div className="composer__toolbar">
        <select
          ref={modelSelectRef}
          className="composer__model"
          value={selectedModel}
          aria-label="选择模型"
          title="选择本次对话使用的模型（默认跟随生效渠道）"
          onChange={(e) => onSelectModel(e.target.value)}
        >
          <option value="">默认（跟随生效渠道）</option>
          {models.map((option) => (
            <option key={option.value} value={option.value}>
              {option.active ? `${option.label} · 生效` : option.label}
            </option>
          ))}
        </select>
        {onSelectProfile ? (
          <select
            className="composer__profile"
            value={selectedProfile}
            aria-label="选择智能体画像"
            title="选择本次对话使用的画像：按场景裁步数/预算/工具面/提示词（默认 default）"
            onChange={(e) => onSelectProfile(e.target.value)}
          >
            <option value="">默认画像（default）</option>
            {profiles.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : null}
        <span className="composer__spacer" />
      </div>
      <div className="composer__row">
        {palette ? (
          <InputPalette
            entries={paletteRows.map((row) => row.entry)}
            selectedIndex={paletteIndex}
            onHover={setPaletteIndex}
            onPick={applyPaletteRow}
            footer="↑↓ 选择 · Enter/Tab 采纳 · Esc 关闭"
            emptyText={
              palette.mode === 'slash'
                ? '无匹配命令（/help 看全部）'
                : '无匹配文件（继续输入可模糊过滤）'
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
    </form>
  );
}
