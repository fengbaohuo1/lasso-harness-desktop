/**
 * C3 底部状态栏：轮次/步数/工具调用/token 用量/上下文占用（进度条）/模型/画像。
 * - 数据源 usage（事件聚合，重启仍准）；上下文占用 = contextTokens / 画像 contextTokenBudget（SC6）；
 * - 无数据显示 —，流式中加活跃态。
 */

import type { ReactElement } from 'react';
import type { SessionUsage } from '../types';

export interface StatusBarProps {
  usage: SessionUsage | null;
  /** 上下文预算（所选画像 contextTokenBudget）；null 不显进度条。 */
  contextBudget: number | null;
  /** 模型展示名（空 = 默认）。 */
  modelLabel: string | null;
  /** 画像展示名（空 = 默认画像）。 */
  profileLabel: string | null;
  streaming: boolean;
}

function fmt(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString();
}

export default function StatusBar({
  usage,
  contextBudget,
  modelLabel,
  profileLabel,
  streaming,
}: StatusBarProps): ReactElement {
  const contextTokens = usage?.contextTokens ?? 0;
  const ratio = contextBudget && contextBudget > 0
    ? Math.min(1, contextTokens / contextBudget)
    : null;
  return (
    <footer className={`status-bar${streaming ? ' status-bar--live' : ''}`}>
      <span className="status-bar__chip" title="会话轮次（TurnStart 事件计数）">
        轮次 <b>{fmt(usage?.turns)}</b>
      </span>
      <span className="status-bar__chip" title="执行步数（StepEnd 事件计数）">
        步数 <b>{fmt(usage?.steps)}</b>
      </span>
      <span className="status-bar__chip" title="工具调用次数（ToolCall 事件计数）">
        工具 <b>{fmt(usage?.toolCalls)}</b>
      </span>
      <span
        className="status-bar__chip"
        title={`token 用量（事件聚合）：输入 ${fmt(usage?.promptTokens)} / 输出 ${fmt(usage?.completionTokens)} / 累计 ${fmt(usage?.totalTokens)}${usage?.compactions ? ` · 压缩 ${usage.compactions} 次` : ''}`}
      >
        tokens <b>↑{fmt(usage?.promptTokens)}</b> <b>↓{fmt(usage?.completionTokens)}</b>
      </span>
      <span
        className="status-bar__chip status-bar__context"
        title="上下文占用：最近一次 LLM 调用的输入 tokens ÷ 画像 contextTokenBudget"
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
      </span>
      <span className="status-bar__spacer" />
      <span className="status-bar__chip status-bar__chip--dim" title="本次对话使用的模型">
        {modelLabel ?? '默认模型'}
      </span>
      <span className="status-bar__chip status-bar__chip--dim" title="本次对话使用的智能体预设">
        {profileLabel ?? '默认预设'}
      </span>
    </footer>
  );
}
