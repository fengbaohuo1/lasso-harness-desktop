/**
 * 应用内图片预览（P11-14）。
 *
 * 问题：消息气泡与输入区的图片此前是 `<a href={dataUri} target="_blank">`。Tauri 的 WebView
 * 不为 `target="_blank"` 开新窗口（桌面壳里也没有可切换的浏览器标签页），于是点击等于没反应
 * ——用户反馈「图片显示在对话框上方，但点击后无法在页面预览」。
 *
 * 方案：与 confirm.tsx 同构的模块级单例 —— 任意模块调用 `openImage(src, alt?)` 即可，
 * `<LightboxHost />` 在 App 顶层渲染一次。遮罩点击 / Esc 关闭，图片按原始比例适配窗口。
 *
 * 走 `createPortal(..., document.body)`：避免被 `.settings-dialog { overflow: hidden }`、
 * `.conversation` 的滚动容器之类的祖先裁剪。
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface PendingImage {
  src: string;
  alt: string;
}

let pending: PendingImage | null = null;
const listeners = new Set<(next: PendingImage | null) => void>();

function emit(): void {
  for (const listener of listeners) {
    listener(pending);
  }
}

/** 打开应用内图片预览（`src` 可以是 data URI 或普通 URL）。 */
export function openImage(src: string, alt?: string): void {
  if (!src) {
    return;
  }
  pending = { src, alt: alt && alt.trim() ? alt : '图片预览' };
  emit();
}

function close(): void {
  pending = null;
  emit();
}

/** 预览层宿主：在 App 顶层渲染一次。 */
export function LightboxHost(): React.ReactElement | null {
  const [current, setCurrent] = useState<PendingImage | null>(pending);

  useEffect(() => {
    const listener = (next: PendingImage | null): void => setCurrent(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!current) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        // 捕获阶段拦下：预览层之上的 Esc 语义是「关预览」，不该连带关掉设置或中断生成
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [current]);

  if (!current) {
    return null;
  }

  return createPortal(
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={current.alt}
      onMouseDown={close}
    >
      <figure className="lightbox__frame" onMouseDown={(event) => event.stopPropagation()}>
        <img className="lightbox__img" src={current.src} alt={current.alt} />
        <figcaption className="lightbox__bar">
          <span className="lightbox__name" title={current.alt}>
            {current.alt}
          </span>
          <button type="button" className="btn btn--small" onClick={close}>
            关闭
          </button>
        </figcaption>
      </figure>
    </div>,
    document.body,
  );
}
