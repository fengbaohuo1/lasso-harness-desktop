/**
 * 插件 UI 贡献运行时（U1/U4）：清单拉取/缓存/热重载 + 渲染解释器。
 * - 清单来源 GET /api/harness/plugins/ui（仅 ACTIVE 插件）；reloadPluginUi() 免重启重拉（SD5）。
 * - 工具渲染器匹配：先精确匹配注册工具名（可能形如 plugin__sample-tools__weather_query），
 *   不中再匹配最后一个 `__` 段的原始名（weather_query）。
 * - 模板 {args.x.y}/{result.x.y}：args=工具调用参数；result=结果文本按 JSON 解析（失败整体作字符串）；
 *   占位取不到留空；blocks source 点路径取不到该块隐藏。
 * - schemaVersion > PLUGIN_UI_SCHEMA_VERSION 只暴露 supported=false，调用方提示升级，不硬渲。
 *
 * 组件通过 usePluginUiMap() 订阅缓存；请求统一走 agent-client（信封解包 + 双通道）。
 */

import { useEffect, useSyncExternalStore } from 'react';
import { apiRequest } from './agent-client';
import {
  PLUGIN_UI_SCHEMA_VERSION,
  type PluginUiAction,
  type PluginUiBlock,
  type PluginUiEntry,
  type PluginUiField,
  type PluginUiManifest,
  type PluginToolRenderer,
} from '../types';

/* ----------------------------- 缓存与订阅 ----------------------------- */

const EMPTY_MAP: Map<string, PluginUiManifest> = new Map();
let cache: Map<string, PluginUiManifest> = EMPTY_MAP;
let loaded = false;
let inflight: Promise<Map<string, PluginUiManifest>> | null = null;
const listeners = new Set<() => void>();

function publish(next: Map<string, PluginUiManifest>): void {
  cache = next;
  loaded = true;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): Map<string, PluginUiManifest> {
  return cache;
}

/** 拉取 UI 清单（带缓存；force=true 强制重拉，即「重载插件 UI」）。 */
export function loadPluginUi(force = false): Promise<Map<string, PluginUiManifest>> {
  if (inflight) {
    return inflight.then(() => (force ? loadPluginUi(true) : cache));
  }
  if (loaded && !force) {
    return Promise.resolve(cache);
  }
  inflight = apiRequest<PluginUiEntry[]>('/api/harness/plugins/ui')
    .then((entries) => {
      const next = new Map<string, PluginUiManifest>();
      for (const entry of entries ?? []) {
        if (entry?.pluginId && entry.ui) {
          next.set(entry.pluginId, entry.ui);
        }
      }
      publish(next);
      return next;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 热重载 UI 清单（后端改 plugin-ui.json 后免重编壳，SD5）。 */
export function reloadPluginUi(): Promise<Map<string, PluginUiManifest>> {
  return loadPluginUi(true);
}

/** 组件订阅：返回「pluginId → 清单」快照，首次挂载自动拉取。 */
export function usePluginUiMap(): Map<string, PluginUiManifest> {
  const map = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    if (!loaded) {
      void loadPluginUi().catch(() => undefined);
    }
  }, []);
  return map;
}

/** 清单是否可渲染（schemaVersion 超版本只提示升级）。 */
export function isUiSupported(manifest: PluginUiManifest | null | undefined): boolean {
  return !!manifest && manifest.schemaVersion <= PLUGIN_UI_SCHEMA_VERSION;
}

/* ----------------------------- 匹配与求值 ----------------------------- */

export interface RendererMatch {
  pluginId: string;
  renderer: PluginToolRenderer;
}

/** 工具渲染器匹配：精确名优先，再退最后一个 `__` 段原始名。 */
export function findToolRenderer(
  uiMap: Map<string, PluginUiManifest>,
  toolName: string,
): RendererMatch | null {
  for (const [pluginId, manifest] of uiMap) {
    if (!isUiSupported(manifest)) {
      continue;
    }
    const exact = manifest.toolRenderers?.[toolName];
    if (exact) {
      return { pluginId, renderer: exact };
    }
  }
  const raw = toolName.includes('__') ? toolName.slice(toolName.lastIndexOf('__') + 2) : '';
  if (raw && raw !== toolName) {
    for (const [pluginId, manifest] of uiMap) {
      if (!isUiSupported(manifest)) {
        continue;
      }
      const fallback = manifest.toolRenderers?.[raw];
      if (fallback) {
        return { pluginId, renderer: fallback };
      }
    }
  }
  return null;
}

/** 渲染上下文：args=工具参数对象；result=结果文本 JSON 解析值（失败=原字符串）。 */
export interface RenderContext {
  args: unknown;
  result: unknown;
}

/** 工具结果解析：字符串尝试 JSON，失败整体作字符串（text/code 块可用）。 */
export function parseToolResult(result: unknown): unknown {
  if (typeof result !== 'string') {
    return result;
  }
  const trimmed = result.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return result;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return result;
  }
}

/** 点路径求值（"a.b.c"）；中间不是对象 → undefined。 */
export function evalPath(root: unknown, path: string): unknown {
  if (!path) {
    return root;
  }
  let current: unknown = root;
  for (const segment of path.split('.')) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** source 求值："args.x.y" / "result.x.y" / "args" / "result"。 */
export function evalSource(ctx: RenderContext, source: string): unknown {
  const trimmed = (source ?? '').trim();
  if (!trimmed) {
    return undefined;
  }
  const dot = trimmed.indexOf('.');
  const head = dot < 0 ? trimmed : trimmed.slice(0, dot);
  const rest = dot < 0 ? '' : trimmed.slice(dot + 1);
  const root = head === 'args' ? ctx.args : head === 'result' ? ctx.result : undefined;
  return evalPath(root, rest);
}

function templateValue(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** 模板渲染：{args.x}/{result.x} 占位取不到留空。 */
export function renderTemplate(template: string, ctx: RenderContext): string {
  if (!template) {
    return '';
  }
  return template.replace(/\{(args|result)([^}]*)\}/g, (_match, head: string, rest: string) => {
    const path = rest.startsWith('.') ? rest.slice(1) : rest;
    return templateValue(evalSource(ctx, path ? `${head}.${path}` : head));
  });
}

/* ----------------------------- KV ↔ 表单值 ----------------------------- */

export type FormValue = string | number | boolean;

/** KV（字符串值）→ 表单控件值；缺 key 时用 default，再按类型缺省。 */
export function kvToFormValue(field: PluginUiField, kv: Record<string, string>): FormValue {
  const raw = kv[field.key];
  if (raw === undefined) {
    if (field.default !== undefined) {
      return field.default;
    }
    return field.type === 'checkbox' ? false : '';
  }
  if (field.type === 'checkbox') {
    return raw === 'true';
  }
  if (field.type === 'number') {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  return raw;
}

/** 表单控件值 → KV 字符串：number→数字串、checkbox→"true"/"false"、其余原串。 */
export function formValueToKv(field: PluginUiField, value: FormValue): string {
  if (field.type === 'checkbox') {
    return value === true ? 'true' : 'false';
  }
  return value == null ? '' : String(value);
}

/* ----------------------------- 动作执行（U4） ----------------------------- */

/** 调插件 REST 端点 /api/harness/plugins/{id}/api/{path}（信封解包走 apiRequest）。 */
export function executePluginAction(
  pluginId: string,
  action: PluginUiAction,
  body?: unknown,
): Promise<unknown> {
  const method = (action.method || 'GET').toUpperCase();
  const path = action.path.replace(/^\/+/, '');
  const sendBody = method === 'GET' || method === 'DELETE' ? undefined : body;
  return apiRequest<unknown>(
    `/api/harness/plugins/${encodeURIComponent(pluginId)}/api/${path}`,
    method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    sendBody,
  );
}

/** bodyFrom 求值（工具卡语义）：点路径取对象；空/取不到 → undefined。 */
export function resolveActionBody(action: PluginUiAction, ctx: RenderContext): unknown {
  if (!action.bodyFrom || action.bodyFrom === 'form') {
    return undefined;
  }
  return evalSource(ctx, action.bodyFrom);
}

/** 工具卡 actions 块可用性：至少一个按钮。 */
export function isActionsBlock(block: PluginUiBlock): block is Extract<PluginUiBlock, { type: 'actions' }> {
  return block.type === 'actions';
}

/** blocks 里当前可见的子集（actions 看按钮数，其余看 source 是否取到）；调用方据此决定是否回退默认视图。 */
export function visibleBlocks(blocks: PluginUiBlock[], ctx: RenderContext): PluginUiBlock[] {
  return (blocks ?? []).filter((block) =>
    block.type === 'actions' ? (block.items ?? []).length > 0 : evalSource(ctx, block.source) != null,
  );
}
