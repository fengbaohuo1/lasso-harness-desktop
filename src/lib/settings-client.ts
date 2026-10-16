/**
 * 设置域 API 客户端：厂商模型渠道 + 插件管理（M6/P4 配套）。
 * 统一走 agent-client 的 apiRequest（信封解包 + 双通道传输），组件内不直接 fetch。
 */

import { apiRequest } from './agent-client';
import type {
  AgentProfile,
  AgentProfileInput,
  DirectoryListing,
  WorkspaceDeleteResult,
  WorkspaceItem,
  WorkspaceResolve,
} from '../types';

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
  /** P11-1：渠道下挂的具体模型（旧的单模型字段 modelCode 退化为「渠道默认模型」）。 */
  models?: ModelItem[];
}

/** 渠道下的单个模型（P11-1 分层：渠道=连接与密钥，模型=规格与能力）。 */
export interface ModelItem {
  modelCode: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputModalities: string[];
  outputModalities: string[];
  enabled: boolean;
  isDefault: boolean;
  sortOrder?: number;
}

/** 模型规格（P11-2）：发现模型时后端按内置目录补全规格，known=false 表示启发式猜测。 */
export interface ModelSpecInfo {
  modelCode: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputModalities: string[];
  outputModalities: string[];
  known: boolean;
  note: string;
}

/** 扁平模型清单（P11-3）：选择器按渠道分组渲染。 */
export interface ModelCatalogItem {
  ref: string;
  channelCode: string;
  channelDisplayName: string;
  providerCode: string;
  modelCode: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputModalities: string[];
  outputModalities: string[];
  isDefault: boolean;
  channelActive: boolean;
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
  modelSpecs?: ModelSpecInfo[];
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
  /** 第五阶段：是否声明了前端贡献清单（META-INF/plugin-ui.json）。 */
  hasUi?: boolean;
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
  /** 只进不出：留空表示不修改既有密钥；显式传 null 表示清除密钥（P11-3 三分语义）。 */
  apiKey?: string | null;
  /** P11-1：整表提交该渠道下的模型清单（缺省则只保证默认模型一行存在）。 */
  models?: ModelItem[];
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
  modelCode?: string;
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
}): Promise<ModelSpecInfo[]> {
  return apiRequest<ModelSpecInfo[]>('/api/harness/settings/models/discover', 'POST', body);
}

/** P11-3：扁平模型清单（供选择器按渠道分组）。 */
export function fetchModelCatalog(): Promise<ModelCatalogItem[]> {
  return apiRequest<ModelCatalogItem[]>('/api/harness/settings/models/catalog');
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

/* ----------------------------- 智能体画像（A4） ----------------------------- */

export function listProfiles(): Promise<AgentProfile[]> {
  return apiRequest<AgentProfile[]>('/api/harness/profiles');
}

/** 未知码后端回 40000 → 本函数返回 null（调用方按「不存在」处理）。 */
export async function getProfile(profileCode: string): Promise<AgentProfile | null> {
  try {
    return await apiRequest<AgentProfile>(
      `/api/harness/profiles/${encodeURIComponent(profileCode)}`,
    );
  } catch {
    return null;
  }
}

/** upsert：部分字段保存，缺省沿用原值。 */
export function saveProfile(
  profileCode: string,
  input: AgentProfileInput,
): Promise<AgentProfile> {
  return apiRequest<AgentProfile>(
    `/api/harness/profiles/${encodeURIComponent(profileCode)}`,
    'PUT',
    input,
  );
}

/** 删除画像；`default` 禁删（后端 40000，错误信息经 toast 呈现）。 */
export function deleteProfile(profileCode: string): Promise<void> {
  return apiRequest<void>(
    `/api/harness/profiles/${encodeURIComponent(profileCode)}`,
    'DELETE',
  );
}

/* ----------------------------- 工作区（P9-1） ----------------------------- */

export interface WorkspaceInput {
  displayName: string;
  rootPath: string;
}

export interface WorkspacePatch {
  displayName?: string;
  rootPath?: string;
}

export function fetchWorkspaces(): Promise<WorkspaceItem[]> {
  return apiRequest<WorkspaceItem[]>('/api/harness/workspaces');
}

export function createWorkspace(input: WorkspaceInput): Promise<WorkspaceItem> {
  return apiRequest<WorkspaceItem>('/api/harness/workspaces', 'POST', input);
}

export function updateWorkspace(
  workspaceCode: string,
  patch: WorkspacePatch,
): Promise<WorkspaceItem> {
  return apiRequest<WorkspaceItem>(
    `/api/harness/workspaces/${encodeURIComponent(workspaceCode)}`,
    'PUT',
    patch,
  );
}

/**
 * 删除工作区；内置工作区禁删（后端 40000，错误信息经 toast 呈现）。
 * 返回 `unboundSessions` = 被解绑回默认工作区的会话数（P10-6）。
 */
export function deleteWorkspace(workspaceCode: string): Promise<WorkspaceDeleteResult> {
  return apiRequest<WorkspaceDeleteResult>(
    `/api/harness/workspaces/${encodeURIComponent(workspaceCode)}`,
    'DELETE',
  );
}

/**
 * 目录浏览（P10-5）：新建/编辑工作区时挑根目录。
 * `path` 留空 → 从用户主目录起；不可读路径不抛异常，`error` 字段带文案。
 */
export function browseDirectories(path?: string | null): Promise<DirectoryListing> {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  return apiRequest<DirectoryListing>(`/api/harness/workspaces/browse${query}`);
}

/** 解析会话当前工作区（cwd）。 */
export function resolveWorkspace(sessionId: string): Promise<WorkspaceResolve> {
  return apiRequest<WorkspaceResolve>(
    `/api/harness/workspaces/resolve?sessionId=${encodeURIComponent(sessionId)}`,
  );
}
