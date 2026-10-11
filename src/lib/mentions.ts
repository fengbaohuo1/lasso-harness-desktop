/**
 * C2 @file 提及：候选拉取（mentionProviders.endpoint）与发送展开（readEndpoint）。
 * - 候选响应约定 {"items":[{value,label,description?}]}（≤20 条）；
 * - 展开响应约定 {"content":"..."}；每文件截 8KB、每次最多 5 个（SC4），失败保留原 token；
 * - provider 来自插件 UI 清单（usePluginUiMap），端点调用走 executePluginAction（信封解包）。
 */

import { executePluginAction } from './plugin-ui';
import type { PluginMentionProvider, PluginUiManifest } from '../types';

/** @ 候选条目（provider 响应 items 项）。 */
export interface MentionCandidate {
  value: string;
  label: string;
  description?: string;
  /** 来源 provider 分组标题。 */
  providerLabel: string;
  pluginId: string;
}

/** 带分组的候选结果。 */
export interface MentionGroup {
  pluginId: string;
  label: string;
  items: MentionCandidate[];
}

/** 发送展开上限（SC4）。 */
export const MAX_MENTION_FILES = 5;
export const MAX_MENTION_CHARS = 8 * 1024;

/** 汇总所有 trigger=@ 的 provider（v1 固定 @）。 */
export function mentionProvidersOf(uiMap: Map<string, PluginUiManifest>): Array<{
  pluginId: string;
  provider: PluginMentionProvider;
}> {
  const result: Array<{ pluginId: string; provider: PluginMentionProvider }> = [];
  for (const [pluginId, manifest] of uiMap) {
    if (!manifest || manifest.schemaVersion > 1) {
      continue;
    }
    for (const provider of manifest.mentionProviders ?? []) {
      if (provider?.endpoint && (provider.trigger ?? '@') === '@') {
        result.push({ pluginId, provider });
      }
    }
  }
  return result;
}

/** 候选拉取：并发调各 provider 端点（失败的组静默跳过）。 */
export async function fetchMentionGroups(
  uiMap: Map<string, PluginUiManifest>,
  query: string,
): Promise<MentionGroup[]> {
  const providers = mentionProvidersOf(uiMap);
  const groups = await Promise.all(
    providers.map(async ({ pluginId, provider }): Promise<MentionGroup | null> => {
      try {
        const path = `${provider.endpoint.replace(/^\/+/, '')}?q=${encodeURIComponent(query)}`;
        const data = (await executePluginAction(pluginId, { label: '', method: 'GET', path })) as {
          items?: Array<{ value?: string; label?: string; description?: string }>;
        } | null;
        const items = (data?.items ?? [])
          .filter((item): item is { value: string; label: string; description?: string } =>
            Boolean(item?.value))
          .map((item) => ({
            value: item.value,
            label: item.label ?? item.value,
            description: item.description,
            providerLabel: provider.label ?? provider.id,
            pluginId,
          }));
        return items.length > 0 ? { pluginId, label: provider.label ?? provider.id, items } : null;
      } catch {
        return null;
      }
    }),
  );
  return groups.filter((group): group is MentionGroup => group !== null);
}

/** 提及 token 形状：@后跟路径/文件名字符。 */
const MENTION_TOKEN = /@([A-Za-z0-9_\u4e00-\u9fa5][A-Za-z0-9_\-.\/\\\u4e00-\u9fa5]*)/g;

/**
 * 发送展开：把 @token 替换为「@path 保留 + 文末引用块」。
 * 全部读取失败时原样返回（模型仍可用 fs 工具自取）。
 */
export async function expandMentions(
  text: string,
  uiMap: Map<string, PluginUiManifest>,
): Promise<string> {
  const providers = mentionProvidersOf(uiMap).filter(({ provider }) => provider.readEndpoint);
  if (providers.length === 0 || !text.includes('@')) {
    return text;
  }
  const tokens = [...text.matchAll(MENTION_TOKEN)]
    .map((match) => match[1])
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, MAX_MENTION_FILES);
  const blocks: string[] = [];
  for (const token of tokens) {
    for (const { pluginId, provider } of providers) {
      try {
        const path = `${provider.readEndpoint!.replace(/^\/+/, '')}?path=${encodeURIComponent(token)}`;
        const data = (await executePluginAction(pluginId, { label: '', method: 'GET', path })) as {
          content?: string;
        } | null;
        if (typeof data?.content === 'string') {
          const content = data.content.length > MAX_MENTION_CHARS
            ? `${data.content.slice(0, MAX_MENTION_CHARS)}\n…（已截断）`
            : data.content;
          blocks.push(`[引用文件 @${token}]\n\`\`\`\n${content}\n\`\`\``);
          break;
        }
      } catch {
        // 该 provider 读不到则试下一个；都失败保留原 token
      }
    }
  }
  return blocks.length > 0 ? `${text}\n\n${blocks.join('\n\n')}` : text;
}
