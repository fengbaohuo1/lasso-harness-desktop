/**
 * 应用内确认框（P10-8）。
 *
 * 问题：此前删除工作区/预设、插件动作确认都用 `window.confirm`。Tauri 的 WebView 会把原生
 * 确认框渲染成系统弹窗，标题直接暴露内部地址（实测显示「localhost:1420 显示」），与整体
 * 界面风格割裂——用户一眼就能看出「这不是应用自己的界面」。
 *
 * 方案：模块级单例 + Promise API，任意模块 `await confirmAction({...})` 即可，无需把回调
 * 从 App 逐层透传到 5 个调用点；`<ConfirmHost />` 挂在 App 顶层负责渲染。
 *
 * 约定：
 * - 同一时刻只有一个待决确认；出现新的确认时旧的按「取消」结算，避免 Promise 永久悬挂；
 * - Esc = 取消，Enter = 确认；键盘监听用捕获阶段并 stopPropagation，
 *   免得删除确认弹着时把底下的设置对话框一起关掉；
 * - 走 `createPortal(..., document.body)`，不受 `.settings-dialog { overflow: hidden }` 裁剪。
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ConfirmOptions {
  /** 标题，默认「确认操作」。 */
  title?: string;
  /** 正文（必填）。 */
  message: string;
  /** 确认按钮文案，默认「确定」。 */
  confirmLabel?: string;
  /** 取消按钮文案，默认「取消」。 */
  cancelLabel?: string;
  /** 危险操作：确认按钮用警示色。 */
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

let pending: PendingConfirm | null = null;
const listeners = new Set<(next: PendingConfirm | null) => void>();

function emit(): void {
  for (const listener of listeners) {
    listener(pending);
  }
}

function settle(confirmed: boolean): void {
  const current = pending;
  pending = null;
  emit();
  current?.resolve(confirmed);
}

/** 弹出应用内确认框；返回用户是否点了确认。 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  if (pending) {
    // 上一个确认未结算（例如上层组件被卸载），先按取消收尾
    pending.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    pending = { ...options, resolve };
    emit();
  });
}

/** 确认框宿主：在 App 顶层渲染一次。 */
export function ConfirmHost(): React.ReactElement | null {
  const [current, setCurrent] = useState<PendingConfirm | null>(pending);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const listener = (next: PendingConfirm | null): void => setCurrent(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!current) {
      return;
    }
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        settle(false);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        settle(true);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [current]);

  if (!current) {
    return null;
  }

  return createPortal(
    <div className="settings-overlay" onMouseDown={() => settle(false)}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="confirm-dialog__head">{current.title ?? '确认操作'}</div>
        <div className="confirm-dialog__body">{current.message}</div>
        <div className="confirm-dialog__foot">
          <button type="button" className="btn" onClick={() => settle(false)}>
            {current.cancelLabel ?? '取消'}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={`btn ${current.danger ? 'btn--danger' : 'btn--primary'}`}
            onClick={() => settle(true)}
          >
            {current.confirmLabel ?? '确定'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
