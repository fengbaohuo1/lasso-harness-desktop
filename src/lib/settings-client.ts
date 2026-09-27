/**
 * 设置域 API 客户端：厂商模型渠道 + 插件管理（M6/P4 配套）。
 * 统一走 agent-client 的 apiRequest（信封解包 + 双通道传输），组件内不直接 fetch。
 */

import { apiRequest } from './agent-client';

/* ----------------------------- 类型 ----------------------------- */

export interface ModelChannel {
  channelCode: string;
  displayName: string;
  providerCode: string;
  modelCode: string;
  baseUrl: string;
  apiKeyRef: string;
  protocol: string;
  enabled: boolean;
  active: boolean;
  hasApiKey: boolean;
}

export interface ChannelPreset {
  providerCode: string;
  displayName: string;
  protocol: string;
  baseUrl: string;
  recommendedModel: string;
}

export interface ModelTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  models?: string[];
}

export interface PluginItem {
  pluginId: string;
  displayName: string;
  pluginVersion: string;
  runtimeType: string;
  sourcePath: string;
  entrypoint: string;
  status: string;
  runtimeState: string;
}

export interface PluginCatalogItem {
  pluginId: string;
  displayName: string;
  version: string;
  runtimeType: string;
  sourcePath: string;
  entrypoint: string;
  description: string;
  installed: boolean;
}

export interface ModelChannelInput {
  channelCode: string;
  displayName: string;
  providerCode: string;
  modelCode: string;
  baseUrl: string;
  protocol: string;
  enabled: boolean;
  /** 只进不出：留空表示不修改既有密钥。 */
  apiKey?: string;
}

/* ----------------------------- 模型渠道 ----------------------------- */

export function listModelChannels(): Promise<ModelChannel[]> {
  return apiRequest<ModelChannel[]>('/api/harness/settings/models');
}

export function saveModelChannel(input: ModelChannelInput): Promise<ModelChannel> {
  return apiRequest<ModelChannel>('/api/harness/settings/models', 'POST', input);
}

export function deleteModelChannel(channelCode: string): Promise<void> {
  return apiRequest<void>(
    `/api/harness/settings/models/${encodeURIComponent(channelCode)}`,
    'DELETE',
  );
}

export function activateModelChannel(channelCode: string): Promise<void> {
  return apiRequest<void>('/api/harness/settings/models/active', 'POST', { channelCode });
}

export function testModelChannel(body: {
  channelCode?: string;
  baseUrl?: string;
  apiKey?: string;
  apiKeyRef?: string;
  protocol?: string;
}): Promise<ModelTestResult> {
  return apiRequest<ModelTestResult>('/api/harness/settings/models/test', 'POST', body);
}

export function discoverModels(body: {
  channelCode?: string;
  baseUrl?: string;
  apiKey?: string;
  protocol?: string;
}): Promise<string[]> {
  return apiRequest<string[]>('/api/harness/settings/models/discover', 'POST', body);
}

export function fetchChannelPresets(): Promise<ChannelPreset[]> {
  return apiRequest<ChannelPreset[]>('/api/harness/channels/presets');
}

/* ----------------------------- 插件 ----------------------------- */

export function listPlugins(): Promise<PluginItem[]> {
  return apiRequest<PluginItem[]>('/api/harness/plugins');
}

export function fetchPluginCatalog(): Promise<PluginCatalogItem[]> {
  return apiRequest<PluginCatalogItem[]>('/api/harness/plugins/catalog');
}

export function installPlugin(input: {
  pluginId: string;
  displayName: string;
  pluginVersion: string;
  runtimeType: string;
  sourcePath: string;
  entrypoint: string;
}): Promise<unknown> {
  return apiRequest('/api/harness/plugins/install', 'POST', input);
}

export function activatePlugin(pluginId: string): Promise<unknown> {
  return apiRequest('/api/harness/plugins/activate', 'POST', { pluginId });
}

export function disablePlugin(pluginId: string): Promise<unknown> {
  return apiRequest(`/api/harness/plugins/${encodeURIComponent(pluginId)}/disable`, 'POST');
}

export function reloadPlugin(pluginId: string): Promise<unknown> {
  return apiRequest(`/api/harness/plugins/${encodeURIComponent(pluginId)}/reload`, 'POST');
}

export function uninstallPlugin(pluginId: string): Promise<unknown> {
  return apiRequest(`/api/harness/plugins/${encodeURIComponent(pluginId)}`, 'DELETE');
}

export function getPluginConfig(pluginId: string): Promise<Record<string, string>> {
  return apiRequest<Record<string, string>>(
    `/api/harness/plugins/${encodeURIComponent(pluginId)}/config`,
  );
}

export function savePluginConfig(
  pluginId: string,
  config: Record<string, string>,
): Promise<Record<string, string>> {
  return apiRequest<Record<string, string>>(
    `/api/harness/plugins/${encodeURIComponent(pluginId)}/config`,
    'PUT',
    config,
  );
}

export function deletePluginConfigKey(pluginId: string, configKey: string): Promise<void> {
  return apiRequest<void>(
    `/api/harness/plugins/${encodeURIComponent(pluginId)}/config/${encodeURIComponent(configKey)}`,
    'DELETE',
  );
}
