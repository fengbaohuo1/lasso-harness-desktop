/**
 * 工具卡渲染块（U2/U4）：解释 plugin-ui.json 的 blocks 声明——
 * text / kv / table / code / json / actions；source 点路径取不到的块隐藏；
 * 动作按钮经 agent-client 调插件 REST 端点（confirm 先确认、结果 toast）。
 * 视觉复用 tool-card 现有 pre/label 风格与 CSS 令牌（深浅主题通用）。
 */

import { useState } from 'react';
import type { ReactElement } from 'react';
import { toast } from '../lib/toast';
import {
  evalPath,
  evalSource,
  executePluginAction,
  resolveActionBody,
  visibleBlocks,
  type RenderContext,
} from '../lib/plugin-ui';
import type { PluginUiAction, PluginUiBlock } from '../types';

function displayText(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 单个动作按钮（confirm 先确认 → 插件端点 → toast）。 */
function ActionButtons({
  pluginId,
  items,
  ctx,
}: {
  pluginId: string;
  items: PluginUiAction[];
  ctx: RenderContext;
}): ReactElement | null {
  const [busy, setBusy] = useState<string | null>(null);
  if (items.length === 0) {
    return null;
  }
  const run = (action: PluginUiAction): void => {
    if (action.confirm && !window.confirm(action.confirm)) {
      return;
    }
    setBusy(action.label);
    executePluginAction(pluginId, action, resolveActionBody(action, ctx))
      .then((data) => {
        const detail = data == null ? '' : `：${displayText(data).split('\n')[0].slice(0, 120)}`;
        toast(`${action.label} 成功${detail}`, 'success');
      })
      .catch((err) => toast(`${action.label} 失败：${describeError(err)}`, 'error'))
      .finally(() => setBusy(null));
  };
  return (
    <div className="tool-block__actions">
      {items.map((action) => (
        <button
          key={`${action.method}-${action.path}`}
          type="button"
          className="btn btn--small"
          disabled={busy !== null}
          onClick={() => run(action)}
        >
          {busy === action.label ? '执行中…' : action.label}
        </button>
      ))}
    </div>
  );
}

/** 一个渲染块；source 取不到返回 null（该块隐藏）。 */
function Block({
  block,
  pluginId,
  ctx,
}: {
  block: PluginUiBlock;
  pluginId: string;
  ctx: RenderContext;
}): ReactElement | null {
  if (block.type === 'actions') {
    return (
      <div className="tool-block">
        {block.label ? <div className="tool-card__label">{block.label}</div> : null}
        <ActionButtons pluginId={pluginId} items={block.items ?? []} ctx={ctx} />
      </div>
    );
  }

  const value = evalSource(ctx, block.source);
  if (value == null) {
    return null;
  }

  const label = block.label ? <div className="tool-card__label">{block.label}</div> : null;

  switch (block.type) {
    case 'text':
      return (
        <div className="tool-block">
          {label}
          <div className="tool-block__text">{displayText(value)}</div>
        </div>
      );
    case 'kv': {
      const entries =
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.entries(value as Record<string, unknown>)
          : [];
      if (entries.length === 0) {
        return null;
      }
      return (
        <div className="tool-block">
          {label}
          <table className="tool-block__kv">
            <tbody>
              {entries.map(([key, val]) => (
                <tr key={key}>
                  <th>{key}</th>
                  <td>{displayText(val)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'table': {
      const rows = Array.isArray(value) ? (value as unknown[]) : [];
      const columns = block.columns ?? [];
      if (rows.length === 0 || columns.length === 0) {
        return null;
      }
      return (
        <div className="tool-block">
          {label}
          <table className="tool-block__table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.key}>{col.label || col.key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {columns.map((col) => (
                    <td key={col.key}>{displayText(evalPath(row, col.key))}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'code':
      return (
        <div className="tool-block">
          {label}
          <pre className="tool-card__pre">
            {block.language ? <span className="tool-block__lang">{block.language}</span> : null}
            {displayText(value)}
          </pre>
        </div>
      );
    case 'json':
      return (
        <div className="tool-block">
          {label}
          <pre className="tool-card__pre">{displayText(value)}</pre>
        </div>
      );
    default:
      return null;
  }
}

/** blocks 列表渲染；全部块被隐藏时返回 null（调用方回退默认参数/结果视图）。 */
export default function ToolCardBlocks({
  blocks,
  pluginId,
  ctx,
}: {
  blocks: PluginUiBlock[];
  pluginId: string;
  ctx: RenderContext;
}): ReactElement | null {
  const visible = visibleBlocks(blocks, ctx);
  if (visible.length === 0) {
    return null;
  }
  return (
    <div className="tool-blocks">
      {visible.map((block, index) => (
        <Block key={index} block={block} pluginId={pluginId} ctx={ctx} />
      ))}
    </div>
  );
}
