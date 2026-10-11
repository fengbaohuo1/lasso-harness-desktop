/**
 * C1/SP1 斜杠命令面板数据源：**命令 = 用户发起的行为控制 / skill / 插件功能**
 * （function tools 是智能体的执行器，不进命令面——第八阶段纠偏）。
 * 三组制（对照 dsh）：常用（高频入口）/ 指令（行为控制）/ 技能（插件 slashCommands）。
 * - action：本地执行（onCommand 回调），不进消息；
 * - prompt：模板填入输入框（{arg} = 命令后随行参数），mode:'send' 直接发送。
 */

import type { PluginUiManifest } from '../types';

/** 工具目录条目（GET /api/harness/tool-catalog；工具注册管理页数据源）。 */
export interface ToolCatalogItem {
  toolCode: string;
  displayName: string | null;
  description: string | null;
  category: string | null;
  requiresApproval: boolean;
}

/** 命令面板分组（SP1）。 */
export type SlashGroup = '常用' | '指令' | '技能';

/** 命令面板条目（内置/插件统一形状）。 */
export interface SlashItem {
  id: string;
  group: SlashGroup;
  /** 面板主标题（命令显示 /name）。 */
  title: string;
  description: string;
  /** 右侧徽标（插件名/「本地」）。 */
  badge?: string;
  kind: 'action' | 'prompt';
  /** action 型的本地动作 id。 */
  action?: string;
  /** prompt 型模板（{arg} 占位）。 */
  template?: string;
  /** prompt 型：选中后是否直接发送。 */
  send?: boolean;
  /** 参数提示。 */
  argumentHint?: string;
}

/** 内置命令（SP2：指令是真动作不是提示词）。 */
export const BUILTIN_COMMANDS: SlashItem[] = [
  // 常用
  { id: 'b/new', group: '常用', title: '/new', description: '新建会话', badge: '本地', kind: 'action', action: 'new' },
  {
    id: 'b/plan',
    group: '常用',
    title: '/plan',
    description: '规划模式：先列计划，确认后再动手',
    kind: 'prompt',
    template: '请先制定执行计划（分步骤列出目标、改动点与验证方式），等我确认后再动手：',
    argumentHint: '任务',
  },
  { id: 'b/help', group: '常用', title: '/help', description: '快捷键与命令帮助', badge: '本地', kind: 'action', action: 'help' },
  { id: 'b/settings', group: '常用', title: '/settings', description: '打开设置', badge: '本地', kind: 'action', action: 'settings' },
  // 指令（行为控制）
  { id: 'b/compact', group: '指令', title: '/compact', description: '压缩以上对话内容（落 Compacted 事件）', badge: '本地', kind: 'action', action: 'compact' },
  { id: 'b/model', group: '指令', title: '/model', description: '选择本会话使用的模型', badge: '本地', kind: 'action', action: 'model' },
  { id: 'b/export', group: '指令', title: '/export', description: '将当前会话导出为 Markdown', badge: '本地', kind: 'action', action: 'export' },
  { id: 'b/theme', group: '指令', title: '/theme', description: '切换主题（浅/深/跟随系统）', badge: '本地', kind: 'action', action: 'theme' },
  // 提示词模板（技能型内置）
  {
    id: 'b/review',
    group: '技能',
    title: '/review',
    description: '审查改动：问题、风险与改进点',
    kind: 'prompt',
    template: '请审查以上改动：指出问题、风险与改进点。',
  },
  {
    id: 'b/explain',
    group: '技能',
    title: '/explain',
    description: '解释代码/概念',
    kind: 'prompt',
    template: '请解释：',
    argumentHint: '对象',
  },
  {
    id: 'b/fix',
    group: '技能',
    title: '/fix',
    description: '定位并修复问题',
    kind: 'prompt',
    template: '请定位并修复以下问题：',
    argumentHint: '问题',
  },
  {
    id: 'b/test',
    group: '技能',
    title: '/test',
    description: '补充测试并运行验证',
    kind: 'prompt',
    template: '请为以下改动补充测试并运行验证：',
    argumentHint: '范围',
  },
  {
    id: 'b/docs',
    group: '技能',
    title: '/docs',
    description: '更新相关文档',
    kind: 'prompt',
    template: '请更新相关文档以反映以下改动：',
  },
  {
    id: 'b/commit',
    group: '技能',
    title: '/commit',
    description: '生成规范提交信息',
    kind: 'prompt',
    template: '请为当前改动生成规范的提交信息（类型前缀 + 摘要 + 正文要点）。',
  },
];

/** 插件贡献命令（skill）→ 面板条目（技能组，SP1）。 */
export function pluginSlashItems(uiMap: Map<string, PluginUiManifest>): SlashItem[] {
  const items: SlashItem[] = [];
  for (const [pluginId, manifest] of uiMap) {
    if (!manifest || manifest.schemaVersion > 1) {
      continue;
    }
    for (const command of manifest.slashCommands ?? []) {
      if (!command?.name) {
        continue;
      }
      items.push({
        id: `p/${pluginId}/${command.name}`,
        group: '技能',
        title: `/${command.name.replace(/^\/+/, '')}`,
        description: command.description ?? '',
        badge: pluginId,
        kind: 'prompt',
        template: command.template ?? command.name,
        send: command.mode === 'send',
        argumentHint: command.argumentHint,
      });
    }
  }
  return items;
}

/** 全部命令（内置 → 插件技能）。function tools 不进命令面（SP1 纠偏）。 */
export function collectSlashItems(uiMap: Map<string, PluginUiManifest>): SlashItem[] {
  return [...BUILTIN_COMMANDS, ...pluginSlashItems(uiMap)];
}

/** 输入浮层触发态：mode + 查询词 + token 起点（/ 或 @ 的下标）。 */
export interface PaletteState {
  mode: 'slash' | 'mention';
  query: string;
  start: number;
}

/**
 * 从文本/光标推断触发 token：`/` 仅在输入开头（命令语义）；
 * `@` 在空白后（提及语义）。空白/超界字符即返回 null（浮层关闭）。
 */
export function detectPaletteToken(text: string, caret: number): PaletteState | null {
  const before = text.slice(0, caret);
  if (before.startsWith('/')) {
    const query = before.slice(1);
    return /\s/.test(query) ? null : { mode: 'slash', query, start: 0 };
  }
  const match = /(^|\s)@([A-Za-z0-9_\u4e00-\u9fa5][A-Za-z0-9_\-.\/\\\u4e00-\u9fa5]*)?$/.exec(before);
  if (match) {
    const query = match[2] ?? '';
    return { mode: 'mention', query, start: before.length - query.length - 1 };
  }
  return null;
}

/** 模板填参：{arg} 替换为参数（无参留空）。 */
export function fillTemplate(template: string, arg: string): string {
  return template.replace(/\{arg\}/g, arg.trim());
}

/**
 * fuzzy 过滤：大小写不敏感子序匹配 title/description，title 前缀命中/连续命中优先。
 * 空 query 原序返回。
 */
export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return items;
  }
  const scored: Array<{ item: SlashItem; score: number }> = [];
  for (const item of items) {
    const title = item.title.toLowerCase();
    const haystack = `${title} ${item.description.toLowerCase()} ${item.badge ?? ''}`;
    if (!isSubsequence(needle, haystack)) {
      continue;
    }
    let score = 0;
    if (title === needle) {
      score = 100;
    } else if (title.startsWith(`/${needle}`) || title.startsWith(needle)) {
      score = 80;
    } else if (title.includes(needle)) {
      score = 60;
    } else {
      score = 40;
    }
    scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.item);
}

/** 子序列匹配（"pl" 命中 "/plan"）。 */
function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) {
      i += 1;
      if (i >= needle.length) {
        return true;
      }
    }
  }
  return needle.length === 0;
}
