/**
 * jnf-desktop 前端契约类型。
 *
 * 对应后端接口：
 *  - 统一响应包 {code, info, data}，code === "00000" 为成功，HTTP 恒 200，请求头 X-API-Key
 *  - POST /api/agent/message        body AgentMessageRequest -> data AgentRunResult
 *  - POST /api/agent/stream         同 body -> SSE 事件流
 *  - POST /api/agent/{agentId}/cancel
 */

/** 统一响应包。 */
export interface ApiEnvelope<T = unknown> {
  code: string;
  info: string;
  data: T;
}

/** 统一成功码。 */
export const API_SUCCESS_CODE = '00000';

/** invoke("agent_status") 返回值。 */
export interface AgentStatus {
  /** 冻结契约：是否运行中 */
  running: boolean;
  port: number;
  apiKey: string;
  pid?: number;
  /** 壳的诊断语义：running | stopped（兼容读取） */
  status?: string;
}

/** /api/agent/message 与 /api/agent/stream 的请求体。 */
export interface AgentMessageRequest {
  agentId: string;
  message: string;
  model?: string;
  /** A4：智能体画像码（per-message，空 = default 画像）。 */
  profile?: string;
  maxTokens?: number;
  temperature?: number;
  cwd?: string;
}

/** 智能体画像（A1/A4）：按场景裁运行开销的参数集（GET /api/harness/profiles）。 */
export interface AgentProfile {
  profileCode: string;
  displayName: string;
  maxStepsPerTurn: number;
  maxTokenContinuations: number;
  contextTokenBudget: number;
  keepRecentMessages: number;
  compactionThresholdTokens: number;
  maxTokens: number | null;
  temperature: number | null;
  /** 工具画像码（接 R5 工具目录画像白名单，决定模型可见工具面）。 */
  toolProfile: string;
  /** 追加到系统提示词的场景指令（≤4000 字）。 */
  promptExtra: string | null;
}

/** PUT /api/harness/profiles/{code} 的部分字段（缺省沿用原值）。 */
export type AgentProfileInput = Partial<
  Pick<
    AgentProfile,
    | 'displayName'
    | 'maxStepsPerTurn'
    | 'maxTokenContinuations'
    | 'contextTokenBudget'
    | 'keepRecentMessages'
    | 'compactionThresholdTokens'
    | 'maxTokens'
    | 'temperature'
    | 'toolProfile'
    | 'promptExtra'
  >
>;

/** done / REST 响应中的工具调用条目。 */
export interface ToolCallDto {
  toolName: string;
  callId: string;
  args?: unknown;
  result?: unknown;
  error?: string | null;
  status?: string;
}

/** /api/agent/message 的 data 与 done 事件载荷。 */
export interface AgentRunResult {
  agentId: string;
  turn: number;
  status: string;
  text: string;
  toolCalls: ToolCallDto[];
}

/* ----------------------------- SSE 事件 ----------------------------- */

/** meta {agentId} */
export interface MetaEvent {
  agentId: string;
}

/** chunk {content} */
export interface ChunkEvent {
  content: string;
}

/** step_break {toolName, callId, args, status} —— 工具调用开始。 */
export interface StepBreakEvent {
  toolName: string;
  callId: string;
  args: unknown;
  status?: string;
}

/** tool_result {toolName, callId, result, error} —— 工具调用结束。
 *  error 是布尔标记（true=失败），失败/成功的内容文本都在 result（M8 #5 语义）。 */
export interface ToolResultEvent {
  toolName: string;
  callId: string;
  result: unknown;
  error?: boolean | string | null;
}

/** finish {turn} */
export interface FinishEvent {
  turn: number;
}

/** done {agentId, turn, status, text, toolCalls} */
export interface DoneEvent {
  agentId: string;
  turn: number;
  status: string;
  text: string;
  toolCalls: ToolCallDto[];
}

/** error {code, message} */
export interface SseErrorEvent {
  code: string;
  message: string;
}

/** SSE 事件名。以 ":" 开头的注释帧（keepalive）会被忽略，不进入此联合。 */
export type SseEventName =
  | 'meta'
  | 'chunk'
  | 'step_break'
  | 'tool_result'
  | 'finish'
  | 'done'
  | 'error';

/** SSE 事件联合（事件名 + 载荷）。 */
export type SseEvent =
  | { event: 'meta'; data: MetaEvent }
  | { event: 'chunk'; data: ChunkEvent }
  | { event: 'step_break'; data: StepBreakEvent }
  | { event: 'tool_result'; data: ToolResultEvent }
  | { event: 'finish'; data: FinishEvent }
  | { event: 'done'; data: DoneEvent }
  | { event: 'error'; data: SseErrorEvent };

/** 流式回调集合；每个回调都可选，缺省的事件被忽略。 */
export interface StreamHandlers {
  onMeta?: (event: MetaEvent) => void;
  onChunk?: (event: ChunkEvent) => void;
  onStepBreak?: (event: StepBreakEvent) => void;
  onToolResult?: (event: ToolResultEvent) => void;
  onFinish?: (event: FinishEvent) => void;
  onDone?: (event: DoneEvent) => void;
  onError?: (event: SseErrorEvent) => void;
}

/* ----------------------------- UI 状态 ----------------------------- */

/** 工具卡片状态：running（step_break 后）/ success / error（tool_result 后）。 */
export type ToolCardStatus = 'running' | 'success' | 'error';

/** 工具卡片展示状态（step_break 开始、tool_result 结束）。 */
export interface ToolCardState {
  key: string;
  toolName: string;
  callId: string;
  args: unknown;
  status: ToolCardStatus;
  result?: unknown;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export type MessageRole = 'user' | 'assistant';

/** 单条消息的生命周期状态。 */
export type MessageStatus = 'streaming' | 'done' | 'error' | 'cancelled';

/** 对话消息（气泡）。 */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  toolCards: ToolCardState[];
  status: MessageStatus;
  turn?: number;
  error?: string;
  /** 创建时间（毫秒时间戳，M7 时间戳展示）。 */
  createdAt?: number;
  /** 消息内文本/工具卡到达序（M8 #8）；渲染以此为准。 */
  segments?: MsgSegment[];
  /** 重新生成中（F4）：流式期间在操作行显示 spinner。 */
  regenerating?: boolean;
}

/** 启动链阶段。 */
export type BootPhase = 'init' | 'checking' | 'starting' | 'ready' | 'failed';

/** 启动链状态。 */
export interface BootState {
  phase: BootPhase;
  error?: string;
}

/* ----------------------------- M7：会话/审批/设置 DTO ----------------------------- */

/** 应用版本常量。来源：src-tauri/tauri.conf.json 的 version 字段（0.1.0，随打包更新）。 */
export const APP_VERSION = '0.1.0';

/** 时间字段兼容形状：epoch 毫秒或 ISO 字符串（后端 meta.json 两种都可能出）。 */
export type TimeLike = number | string | null | undefined;

/** GET /api/harness/console/sessions 条目（F3 起新增 title/createdAt/lastEventAt/eventCount，旧字段不动）。 */
export interface SessionSummary {
  sessionId: string;
  events: number;
  title?: string | null;
  createdAt?: TimeLike;
  lastEventAt?: TimeLike;
  eventCount?: number;
}

/** GET /api/harness/console/sessions/{id}/usage（F6：事件聚合）。 */
export interface SessionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  turns: number;
}

/** 会话回放中的工具条目（tool_call / tool_result）。 */
export interface ConsoleToolBlock {
  type: 'tool_call' | 'tool_result' | string;
  callId: string;
  name: string;
  arguments?: string;
  content?: unknown;
  error?: unknown;
}

/** GET /api/harness/console/sessions/{id}/messages 条目。 */
export interface ConsoleMessage {
  role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL' | string;
  text: string;
  blocks: ConsoleToolBlock[];
}

/** GET /api/harness/approvals/runtime/pending 条目（挂起-裁决）。 */
export interface RuntimeApprovalDto {
  id: string;
  toolName: string;
  argsJson: string;
  createdAt: string;
}

/** 审批裁决。 */
export type ApprovalVerdict = 'ALLOW_ONCE' | 'ALLOW_SESSION' | 'DENY';

/** GET /api/harness/questions/runtime/pending 条目（ask_user_question 挂起-作答）。 */
export interface RuntimeQuestionDto {
  questionId: string;
  question: string;
  options: string[];
}

/** 消息内混排片段（M8 #8）：文本/工具卡按到达序保存。 */
export type MsgSegment =
  | { kind: 'text'; text: string }
  | { kind: 'card'; card: ToolCardState };

/* ----------------------- 第五阶段：插件 UI 贡献清单（schemaVersion 1） ----------------------- */

/** 清单支持的最高 schemaVersion；更高版本只提示「请升级桌面端」不硬渲。 */
export const PLUGIN_UI_SCHEMA_VERSION = 1;

/** settingsPage 字段类型（v1）。 */
export type PluginUiFieldType = 'text' | 'password' | 'number' | 'checkbox' | 'select' | 'textarea';

/** select 选项。 */
export interface PluginUiFieldOption {
  value: string;
  label: string;
}

/** settingsPage 表单字段；值与插件配置 KV 互转（number→数字串、checkbox→"true"/"false"）。 */
export interface PluginUiField {
  key: string;
  label: string;
  type: PluginUiFieldType;
  placeholder?: string;
  help?: string;
  required?: boolean;
  default?: string | number | boolean;
  min?: number;
  max?: number;
  options?: PluginUiFieldOption[];
}

/** settingsPage 分组。 */
export interface PluginUiSection {
  title?: string;
  fields: PluginUiField[];
}

/** 动作按钮（工具卡 actions 与 settingsPage.actions 共用）。
 *  bodyFrom：点路径（如 "result.meta"）取对象做请求体；settingsPage 里 "form" = 当前表单全部值。 */
export interface PluginUiAction {
  label: string;
  method: string;
  path: string;
  bodyFrom?: string;
  confirm?: string;
}

/** table 块列定义。 */
export interface PluginUiColumn {
  key: string;
  label: string;
}

/** 工具卡渲染块（source 为点路径：args.x.y / result.x.y；取不到该块隐藏）。 */
export type PluginUiBlock =
  | { type: 'text'; source: string; label?: string }
  | { type: 'kv'; source: string; label?: string }
  | { type: 'table'; source: string; label?: string; columns: PluginUiColumn[] }
  | { type: 'code'; source: string; label?: string; language?: string }
  | { type: 'json'; source: string; label?: string }
  | { type: 'actions'; label?: string; items: PluginUiAction[] };

/** 工具渲染器（title/summary 为模板：{args.x}/{result.x}，取不到留空）。 */
export interface PluginToolRenderer {
  title?: string;
  summary?: string;
  blocks?: PluginUiBlock[];
}

/** 插件独立配置页面（U3：无此节回退 KV 编辑器）。 */
export interface PluginSettingsPage {
  title?: string;
  description?: string;
  sections?: PluginUiSection[];
  actions?: PluginUiAction[];
}

/** META-INF/plugin-ui.json（SD1 统一插件包的前端贡献清单）。 */
export interface PluginUiManifest {
  schemaVersion: number;
  toolRenderers?: Record<string, PluginToolRenderer>;
  settingsPage?: PluginSettingsPage;
}

/** GET /api/harness/plugins/ui 条目（仅 ACTIVE）。 */
export interface PluginUiEntry {
  pluginId: string;
  ui: PluginUiManifest | null;
}
