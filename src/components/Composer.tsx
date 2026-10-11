/**
 * 输入区（F2）：模型选择 chip + 自动增高输入 + 发送/停止图标按钮 + 草稿历史 + 用量徽标。
 * - Enter 发送、Shift+Enter 换行、Ctrl+Enter 发送；↑/↓ 召回历史草稿；IME 组合守卫保留；
 * - 流式期间输入框**不禁用**（可先输入排队），Enter 不发送，完成后回车发送；
 * - 空输入不可发送；停止按钮方形图标 + tooltip「停止生成」。
 */

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { SendIcon, StopIcon } from './icons';

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
  /** 会话累计 tokens（F6）；0/undefined 隐藏徽标。 */
  usageTotal?: number | null;
  /** 焦点令牌：变化时聚焦输入框（欢迎页快捷入口用）。 */
  focusToken?: number;
  onSend: (text: string) => void | Promise<void>;
  onStop: () => void;
}

const MAX_INPUT_HEIGHT = 200;

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
  usageTotal,
  focusToken = 0,
  onSend,
  onStop,
}: ComposerProps): ReactElement {
  const [draft, setDraft] = useState('');
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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

  const submit = (): void => {
    const text = draft.trim();
    if (!text || !canSend) {
      return;
    }
    setDraft('');
    setHistoryIndex(null);
    void onSend(text);
    textareaRef.current?.focus();
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    submit();
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    const target = e.currentTarget;
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
      ? '生成中…可先输入，完成后回车发送'
      : '输入消息，Enter 发送，Shift+Enter 换行\nCtrl+N 新对话 · Ctrl+, 设置 · ↑/↓ 召回历史';

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className="composer__toolbar">
        <select
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
        {usageTotal && usageTotal > 0 ? (
          <span className="composer__tokens" title="本会话累计 token 用量（事件聚合）">
            tokens 累计 {usageTotal.toLocaleString()}
          </span>
        ) : null}
        <span className="composer__spacer" />
      </div>
      <div className="composer__row">
        <textarea
          ref={textareaRef}
          className="composer__input"
          value={draft}
          placeholder={placeholder}
          disabled={disabled}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
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
