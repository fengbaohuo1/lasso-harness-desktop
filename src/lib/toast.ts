/**
 * toast 体系（F4）：轻量发布/订阅，右下角成功/失败提示。
 * toast(msg, kind) 一调用即入队，ToastContainer 订阅渲染；3s 自动消失、可手动关。
 * 组件内不直接操作 DOM——渲染职责在 components/ToastContainer。
 */

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

type Listener = (items: ToastItem[]) => void;

let nextId = 1;
let items: ToastItem[] = [];
const listeners = new Set<Listener>();
const timers = new Map<number, number>();

function emit(): void {
  const snapshot = items;
  for (const listener of listeners) {
    listener(snapshot);
  }
}

/** 弹一条 toast；默认 error（主区域错误提示的替代品）；durationMs 自定义时长（/help 类长文案用）。 */
export function toast(message: string, kind: ToastKind = 'error', durationMs = 3000): void {
  const item: ToastItem = { id: nextId++, message, kind };
  items = [...items, item];
  emit();
  const timer = window.setTimeout(() => dismissToast(item.id), durationMs);
  timers.set(item.id, timer);
}

export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timers.delete(id);
  }
  if (items.some((item) => item.id === id)) {
    items = items.filter((item) => item.id !== id);
    emit();
  }
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(items);
  return () => {
    listeners.delete(listener);
  };
}
