/**
 * toast 渲染容器（F4）：订阅 lib/toast，右下角展示成功/失败提示。
 * 3s 自动消失由 lib/toast 的定时器负责；此处只渲染 + 手动关闭。
 */

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { dismissToast, subscribeToasts } from '../lib/toast';
import type { ToastItem } from '../lib/toast';

export default function ToastContainer(): ReactElement | null {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setItems), []);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`toast toast--${item.kind}`}>
          <span>{item.message}</span>
          <button
            type="button"
            className="toast__close"
            aria-label="关闭"
            onClick={() => dismissToast(item.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
