/**
 * 输入区：文本输入 + 发送 + 停止生成。
 * Enter 发送、Shift+Enter 换行；生成中显示“停止”按钮。
 */

import { useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';

export interface ComposerProps {
  /** 启动链未就绪时禁用输入。 */
  disabled: boolean;
  /** 是否正在生成（决定显示“停止”）。 */
  streaming: boolean;
  onSend: (text: string) => void | Promise<void>;
  onStop: () => void;
}

export default function Composer({
  disabled,
  streaming,
  onSend,
  onStop,
}: ComposerProps): ReactElement {
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const canSend = !disabled && !streaming && draft.trim() !== '';

  const submit = (): void => {
    const text = draft.trim();
    if (!text || !canSend) {
      return;
    }
    setDraft('');
    void onSend(text);
    textareaRef.current?.focus();
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    submit();
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <textarea
        ref={textareaRef}
        className="composer__input"
        value={draft}
        placeholder={disabled ? 'Agent 尚未就绪…' : '输入消息，Enter 发送，Shift+Enter 换行'}
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
