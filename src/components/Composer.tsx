/**
 * 输入区（M7.5）：文本输入 + 发送 + 停止生成 + 草稿历史。
 * Enter 发送、Shift+Enter 换行；↑/↓ 召回历史草稿；生成中显示“停止”按钮。
 */

import { useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';

export interface ComposerProps {
  /** 启动链未就绪时禁用输入。 */
  disabled: boolean;
  /** 是否正在生成（决定显示“停止”）。 */
  streaming: boolean;
  /** 历史草稿（旧→新），↑/↓ 召回。 */
  history?: string[];
  onSend: (text: string) => void | Promise<void>;
  onStop: () => void;
}

export default function Composer({
  disabled,
  streaming,
  history = [],
  onSend,
  onStop,
}: ComposerProps): ReactElement {
  const [draft, setDraft] = useState('');
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const canSend = !disabled && !streaming && draft.trim() !== '';

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
      submit();
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

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <textarea
        ref={textareaRef}
        className="composer__input"
        value={draft}
        placeholder={
          disabled ? 'Agent 尚未就绪…' : '输入消息，Enter 发送，Shift+Enter 换行，↑/↓ 召回历史'
        }
        disabled={disabled}
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="composer__actions">
        {streaming ? (
          <button type="button" className="btn btn--danger" onClick={onStop}>
            停止生成
          </button>
        ) : (
          <button type="submit" className="btn btn--primary" disabled={!canSend}>
            发送
          </button>
        )}
      </div>
    </form>
  );
}
