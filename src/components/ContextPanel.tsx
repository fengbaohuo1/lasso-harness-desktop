/**
 * P11-10 / D11-9：上下文成分面板。
 * 由状态栏「上下文」区域点开，数据源 GET /api/harness/console/sessions/{id}/context。
 * 后端只给 token 估算（chars/4，与 ReactLoopAgent 同口径），这里只做展示不做二次推算。
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactElement } from 'react';
import { CloseIcon } from './icons';
import { fetchSessionContext } from '../lib/console-client';
import type { ContextBreakdown } from '../types';

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface ContextPanelProps {
  sessionId: string;
  /** 上下文预算（画像 contextTokenBudget）；null 不显占比。 */
  budget: number | null;
  onClose: () => void;
}

/** 成分桶：键 → 中文名 + 色板变量。 */
const BUCKETS: Array<{ key: keyof ContextBreakdown; label: string; color: string }> = [
  { key: 'systemTokens', label: '系统提示词', color: 'var(--accent)' },
  { key: 'summaryTokens', label: '历史摘要', color: 'var(--warning)' },
  { key: 'userTokens', label: '用户消息', color: 'var(--success)' },
  { key: 'assistantTokens', label: '助手回复', color: 'var(--running)' },
  { key: 'reasoningTokens', label: '思考内容', color: 'var(--text-faint)' },
  { key: 'toolResultTokens', label: '工具结果', color: 'var(--danger)' },
];

function fmt(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString();
}

export default function ContextPanel({ sessionId, budget, onClose }: ContextPanelProps): ReactElement {
  const [data, setData] = useState<ContextBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchSessionContext(sessionId)
      .then((next) => {
        if (!cancelled) {
          setData(next);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(describeError(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const total = data?.estimatedTokens ?? 0;
  const parts = data
    ? BUCKETS.map((bucket) => ({ ...bucket, value: Number(data[bucket.key] ?? 0) })).filter(
        (bucket) => bucket.value > 0,
      )
    : [];
  const ratio = budget && budget > 0 ? Math.min(1, total / budget) : null;

  return createPortal(
    <div className="settings-overlay" onMouseDown={onClose}>
      <div
        className="ctx-panel"
        role="dialog"
        aria-label="上下文成分"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ctx-panel__head">
          <h2>上下文成分</h2>
          <button type="button" className="icon-btn" title="关闭（Esc）" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="ctx-panel__body">
          {error ? <div className="banner banner--error">{error}</div> : null}
          <div className="ctx-panel__total">
            合计 <b>{fmt(total)}</b> tokens
            {budget ? <span className="ctx-panel__dim">/ 预算 {fmt(budget)}</span> : null}
            {ratio != null ? <span className="ctx-panel__dim">（{Math.round(ratio * 100)}%）</span> : null}
            <span className="ctx-panel__note">估算口径：字符数 ÷ 4（与内核裁剪同口径）</span>
          </div>

          {parts.length > 0 ? (
            <div className="ctx-panel__bar" aria-hidden="true">
              {parts.map((part) => (
                <span
                  key={String(part.key)}
                  className="ctx-panel__seg"
                  style={{ flexGrow: part.value, background: part.color }}
                  title={`${part.label} ${fmt(part.value)} tokens`}
                />
              ))}
            </div>
          ) : null}

          <div className="ctx-panel__buckets">
            {data
              ? BUCKETS.map((bucket) => {
                  const value = Number(data[bucket.key] ?? 0);
                  const share = total > 0 ? value / total : 0;
                  return (
                    <div key={String(bucket.key)} className="ctx-panel__bucket">
                      <span className="ctx-panel__dot" style={{ background: bucket.color }} />
                      <span className="ctx-panel__name">{bucket.label}</span>
                      <span className="ctx-panel__value">{fmt(value)}</span>
                      <span className="ctx-panel__dim">
                        {total > 0 ? `${Math.round(share * 100)}%` : '—'}
                      </span>
                    </div>
                  );
                })
              : null}
          </div>

          <div className="ctx-panel__section">
            <div className="ctx-panel__section-title">
              消息明细（{data ? data.messages.length : 0}）
            </div>
            <div className="ctx-panel__list">
              {data && data.messages.length === 0 ? (
                <div className="ctx-panel__empty">当前还没有历史消息。</div>
              ) : null}
              {data
                ? data.messages.map((item, index) => (
                    <div key={`${item.role}-${item.turn}-${item.step}-${index}`} className="ctx-panel__row">
                      <span className="ctx-panel__role" data-role={item.role}>
                        {item.role}
                      </span>
                      <span className="ctx-panel__coord">
                        #{item.turn}.{item.step}
                      </span>
                      <span className="ctx-panel__preview">{item.preview}</span>
                      <span className="ctx-panel__value">{fmt(item.tokens)}</span>
                    </div>
                  ))
                : null}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
