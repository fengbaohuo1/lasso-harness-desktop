/**
 * C3 底部状态栏：轮次/步数/工具 · tokens · 缓存命中 · 生成速度 · 上下文占用。
 * - 数据源 usage（事件聚合，重启仍准）；上下文占用 = contextTokens / 画像 contextTokenBudget（SC6）；
 * - 无数据显示 —，流式中加活跃态；
 * - P10-7：模型/预设不再在这里重复展示（模型在输入区胶囊、预设在会话头胶囊），底栏只留运行指标，
 *   并按「分组 · 分隔竖线」组织，贴近 dsh 主页面底栏的密度；
 * - P11-10：上下文占用只此一处（composer 的圆环已删），并且是可点击按钮 → 打开 ContextPanel 看成分。
 */

import type { ReactElement } from 'react';
import type { SessionUsage } from '../types';

export interface StatusBarProps {
  usage: SessionUsage | null;
  /** 上下文预算（所选画像 contextTokenBudget）；null 不显进度条。 */
  contextBudget: number | null;
  streaming: boolean;
  /** P11-10：点击「上下文」区域打开成分面板。 */
  onOpenContext?: () => void;
  /** 是否已有会话（无会话时上下文按钮禁用）。 */
  contextDisabled?: boolean;
}

function fmt(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString();
}

function percent(ratio: number | null): string | null {
  return ratio == null ? null : `${Math.round(ratio * 100)}%`;
}

export default function StatusBar({
  usage,
  contextBudget,
  streaming,
  onOpenContext,
  contextDisabled,
}: StatusBarProps): ReactElement {
  const contextTokens = usage?.contextTokens ?? 0;
  const ratio = contextBudget && contextBudget > 0
    ? Math.min(1, contextTokens / contextBudget)
    : null;
  const cacheHit = usage && usage.promptTokens > 0 ? usage.cacheHitRate : null;
  const speed = usage && usage.tokensPerSecond > 0 ? usage.tokensPerSecond : null;
  return (
    <footer className={`status-bar${streaming ? ' status-bar--live' : ''}`}>
      <span className="status-bar__group">
        <span className="status-bar__chip" title="会话轮次（TurnStart 事件计数）">
          轮次 <b>{fmt(usage?.turns)}</b>
        </span>
        <span className="status-bar__sep" aria-hidden="true">·</span>
        <span className="status-bar__chip" title="执行步数（StepEnd 事件计数）">
          步数 <b>{fmt(usage?.steps)}</b>
        </span>
        <span className="status-bar__sep" aria-hidden="true">·</span>
        <span className="status-bar__chip" title="工具调用次数（ToolCall 事件计数）">
          工具 <b>{fmt(usage?.toolCalls)}</b>
        </span>
      </span>
      <span className="status-bar__divider" aria-hidden="true" />
      <span className="status-bar__group">
        <span
          className="status-bar__chip"
          title={`token 用量（事件聚合）：输入 ${fmt(usage?.promptTokens)} / 输出 ${fmt(usage?.completionTokens)} / 累计 ${fmt(usage?.totalTokens)}`}
        >
          tokens <b>↑{fmt(usage?.promptTokens)}</b> <b>↓{fmt(usage?.completionTokens)}</b>
        </span>
        <span className="status-bar__sep" aria-hidden="true">·</span>
        <span
          className="status-bar__chip"
          title={`提示词缓存命中 ${fmt(usage?.cachedTokens)} tokens（厂商侧缓存，命中部分按更低单价计费）`}
        >
          缓存命中 <b>{cacheHit == null ? '—' : `${Math.round(cacheHit * 100)}%`}</b>
        </span>
        {speed != null ? (
          <>
            <span className="status-bar__sep" aria-hidden="true">·</span>
            <span className="status-bar__chip" title="最近一次 LLM 调用的生成速度（输出 tokens ÷ 耗时）">
              <b>{speed.toFixed(1)}</b> tok/s
            </span>
          </>
        ) : null}
        {usage?.compactions ? (
          <>
            <span className="status-bar__sep" aria-hidden="true">·</span>
            <span className="status-bar__chip" title="上下文压缩次数（compact）">
              压缩 <b>{usage.compactions}</b> 次
            </span>
          </>
        ) : null}
      </span>
      <span className="status-bar__spacer" />
      <button
        type="button"
        className="status-bar__group status-bar__context status-bar__context--button"
        title="上下文占用 = 最近一次 LLM 调用的输入 tokens（上游返回的真实值）÷ 画像的 contextTokenBudget。点开看成分：那里是字符数 ÷ 4 的估算，口径不同、数值会有差异"
        disabled={contextDisabled}
        onClick={onOpenContext}
      >
        上下文 <b>{fmt(contextTokens)}</b>
        {contextBudget ? <span className="status-bar__budget">/{fmt(contextBudget)}</span> : null}
        {ratio != null ? (
          <span className="context-meter" aria-hidden="true">
            <span
              className={`context-meter__fill${ratio >= 0.9 ? ' context-meter__fill--hot' : ratio >= 0.7 ? ' context-meter__fill--warn' : ''}`}
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </span>
        ) : null}
        {percent(ratio) ? <span className="status-bar__pct">{percent(ratio)}</span> : null}
      </button>
    </footer>
  );
}
