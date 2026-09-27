/**
 * Agent 后端客户端：所有业务请求统一从这里发出（组件内不直接 fetch / invoke）。
 *
 * 契约：
 *  - 统一响应包 {code, info, data}，code "00000" 成功，HTTP 恒 200，请求头 X-API-Key
 *  - POST /api/agent/message        -> data AgentRunResult
 *  - POST /api/agent/stream         -> SSE（fetch + ReadableStream 解析）
 *  - POST /api/agent/{agentId}/cancel
 *  - invoke: start_agent / stop_agent / agent_status
 */

import { invoke } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import {
  API_SUCCESS_CODE,
  type AgentMessageRequest,
  type AgentRunResult,
  type AgentStatus,
  type ApiEnvelope,
  type ChunkEvent,
  type DoneEvent,
  type FinishEvent,
  type MetaEvent,
  type SseEventName,
  type StepBreakEvent,
  type StreamHandlers,
  type ToolResultEvent,
} from '../types';

/** 流式空闲看门狗默认超时：120 秒。 */
export const DEFAULT_IDLE_TIMEOUT_MS = 120_000;

/** 启动链轮询默认参数。 */
const STARTUP_TIMEOUT_MS = 30_000;
const STARTUP_INTERVAL_MS = 800;

/* ----------------------------- 错误类型 ----------------------------- */

/** 后端返回非 "00000" 或响应不合法。 */
export class AgentApiError extends Error {
  readonly code: string;
  readonly info: string;

  constructor(code: string, info: string) {
    super(`[${code}] ${info}`);
    this.name = 'AgentApiError';
    this.code = code;
    this.info = info;
  }
}

/** SSE 流 120s 无数据（含 keepalive 注释帧也算数据；完全无字节才计空闲）。 */
export class StreamIdleError extends Error {
  readonly idleMs: number;

  constructor(idleMs: number = DEFAULT_IDLE_TIMEOUT_MS) {
    super(`流式响应空闲超时（${Math.round(idleMs / 1000)}s 未收到任何数据）`);
    this.name = 'StreamIdleError';
    this.idleMs = idleMs;
  }
}

/** 调用方通过 AbortSignal 主动停止生成。 */
export class AgentRunCancelledError extends Error {
  constructor() {
    super('本次生成已被取消');
    this.name = 'AgentRunCancelledError';
  }
}

/** 启动链超时或失败。 */
export class AgentStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentStartupError';
  }
}

/* ----------------------------- 客户端配置 ----------------------------- */

export interface AgentClientConfig {
  baseUrl: string;
  apiKey: string;
}

let clientConfig: AgentClientConfig | null = null;

/** 由启动链在拿到 agent_status 后注入 baseUrl 与 apiKey。 */
export function configureAgentClient(next: AgentClientConfig): void {
  clientConfig = {
    baseUrl: next.baseUrl.replace(/\/+$/, ''),
    apiKey: next.apiKey,
  };
}

export function getAgentClientConfig(): AgentClientConfig | null {
  return clientConfig;
}

function requireConfig(): AgentClientConfig {
  if (!clientConfig) {
    throw new AgentStartupError('Agent 客户端尚未配置（agent 未就绪）');
  }
  return clientConfig;
}

/* ----------------------------- Tauri invoke ----------------------------- */

export function fetchAgentStatus(): Promise<AgentStatus> {
  return invoke<AgentStatus>('agent_status');
}

export function startAgentProcess(): Promise<unknown> {
  return invoke('start_agent');
}

export function stopAgentProcess(): Promise<unknown> {
  return invoke('stop_agent');
}

/* ----------------------------- REST ----------------------------- */

/** 最近一次网络传输错误（供启动链超时信息带出真实原因）。 */
let lastTransportError = '';

export function getLastTransportError(): string {
  return lastTransportError;
}

/**
 * 双通道传输：原生 window.fetch 优先，失败自动回退 @tauri-apps/plugin-http（IPC 通道，
 * 完全绕开 WebView 的 CORS/PNA/代理网络栈——参照实现实测 plugin-http IPC 更可靠）。
 */
async function httpFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    lastTransportError = '';
    return await fetch(url, init);
  } catch (err) {
    lastTransportError = `window.fetch 失败（${err instanceof Error ? err.message : String(err)}），回退 plugin-http`;
    return await tauriFetch(url, init as never);
  }
}

async function requestEnvelope<T>(path: string, init?: RequestInit): Promise<T> {
  const cfg = requireConfig();
  let response: Response;
  try {
    response = await httpFetch(`${cfg.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': cfg.apiKey,
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    throw new AgentApiError('NETWORK', `请求失败：${err instanceof Error ? err.message : String(err)}`);
  }

  const raw = await response.text();
  let envelope: ApiEnvelope<T>;
  try {
    envelope = JSON.parse(raw) as ApiEnvelope<T>;
  } catch {
    throw new AgentApiError(
      `HTTP_${response.status}`,
      `响应不是合法 JSON：${raw.slice(0, 200)}`,
    );
  }
  if (envelope.code !== API_SUCCESS_CODE) {
    throw new AgentApiError(envelope.code, envelope.info || '请求失败');
  }
  return envelope.data;
}

/** 通用 REST 调用（信封解包 + 双通道传输；设置页等非对话流量统一走这里）。 */
export function apiRequest<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<T> {
  return requestEnvelope<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** POST /api/agent/message（非流式）。 */
export function sendAgentMessage(req: AgentMessageRequest): Promise<AgentRunResult> {
  return requestEnvelope<AgentRunResult>('/api/agent/message', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

/** POST /api/agent/{agentId}/cancel。 */
export function cancelAgentRun(
  agentId: string,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  return requestEnvelope<unknown>(`/api/agent/${encodeURIComponent(agentId)}/cancel`, {
    method: 'POST',
    signal: options.signal,
  }).then(() => undefined);
}

/** GET /actuator/health（启动链就绪探测，返回任意响应即视为可达）。 */
export async function probeHealth(options: { signal?: AbortSignal } = {}): Promise<boolean> {
  const cfg = requireConfig();
  try {
    await httpFetch(`${cfg.baseUrl}/actuator/health`, {
      method: 'GET',
      headers: { 'X-API-Key': cfg.apiKey },
      signal: options.signal,
    });
    return true;
  } catch {
    return false;
  }
}

/* ----------------------------- 启动链 ----------------------------- */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 启动链：轮询 agent_status（及 /actuator/health）直到就绪。
 * 就绪条件：running === true 且 port > 0，且 /actuator/health 可达。
 * 就绪后自动 configureAgentClient。
 */
export async function waitForAgentReady(
  options: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<AgentStatus> {
  const timeoutMs = options.timeoutMs ?? STARTUP_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? STARTUP_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let lastStatus: AgentStatus | null = null;

  for (;;) {
    if (options.signal?.aborted) {
      throw new AgentRunCancelledError();
    }
    try {
      lastStatus = await fetchAgentStatus();
    } catch (err) {
      lastStatus = null;
      if (Date.now() >= deadline) {
        throw new AgentStartupError(
          `agent_status 不可用：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 就绪判定兼容两种形状：冻结契约 running: boolean / 壳的 status: 'running'
    const isRunning =
      lastStatus != null &&
      (lastStatus.running === true || lastStatus.status === 'running');
    if (lastStatus && isRunning && lastStatus.port > 0) {
      configureAgentClient({
        baseUrl: `http://127.0.0.1:${lastStatus.port}`,
        apiKey: lastStatus.apiKey ?? '',
      });
      if (await probeHealth({ signal: options.signal })) {
        return lastStatus;
      }
    }

    if (Date.now() >= deadline) {
      const detail = lastStatus
        ? `running=${lastStatus.running ?? lastStatus.status}, port=${lastStatus.port}`
        : '无状态信息';
      const probe = getLastTransportError() || '探测无响应（未见传输层错误）';
      throw new AgentStartupError(
        `Agent 启动超时（${Math.round(timeoutMs / 1000)}s）：${detail}；${probe}`,
      );
    }
    await sleep(intervalMs);
  }
}

/* ----------------------------- SSE 流式 ----------------------------- */

export interface StreamOptions {
  /** 调用方取消信号；abort 后抛 AgentRunCancelledError。 */
  signal?: AbortSignal;
  /** 空闲看门狗超时，默认 120s，超时抛 StreamIdleError。 */
  idleTimeoutMs?: number;
}

interface ParsedFrame {
  name?: string;
  data: string;
}

/** 解析单个 SSE 帧；以 ":" 开头的注释帧（keepalive）返回 null。 */
function parseSseFrame(rawFrame: string): ParsedFrame | null {
  let name: string | undefined;
  const dataLines: string[] = [];
  for (const line of rawFrame.split(/\r?\n/)) {
    if (line === '' || line.startsWith(':')) {
      continue; // 空行 / 注释帧（keepalive）
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }
    if (field === 'event') {
      name = value;
    } else if (field === 'data') {
      dataLines.push(value);
    }
    // id / retry 等字段忽略
  }
  if (dataLines.length === 0) {
    return null;
  }
  return { name, data: dataLines.join('\n') };
}

function isSseEventName(value: unknown): value is SseEventName {
  return (
    value === 'meta' ||
    value === 'chunk' ||
    value === 'step_break' ||
    value === 'tool_result' ||
    value === 'finish' ||
    value === 'done' ||
    value === 'error'
  );
}

/** 把一个已解析帧分发到 handlers；done 事件载荷会被返回。 */
function dispatchSseFrame(
  frame: ParsedFrame,
  handlers: StreamHandlers,
): { done?: DoneEvent; error?: AgentApiError } {
  let payload: unknown;
  try {
    payload = JSON.parse(frame.data);
  } catch {
    return {}; // 非 JSON 数据帧直接忽略
  }

  let name = frame.name;
  if (!name && payload && typeof payload === 'object') {
    const hint = (payload as { event?: unknown; type?: unknown }).event ?? (payload as { type?: unknown }).type;
    if (isSseEventName(hint)) {
      name = hint;
    }
  }
  if (!isSseEventName(name)) {
    return {};
  }

  switch (name) {
    case 'meta':
      handlers.onMeta?.(payload as MetaEvent);
      return {};
    case 'chunk':
      handlers.onChunk?.(payload as ChunkEvent);
      return {};
    case 'step_break':
      handlers.onStepBreak?.(payload as StepBreakEvent);
      return {};
    case 'tool_result':
      handlers.onToolResult?.(payload as ToolResultEvent);
      return {};
    case 'finish':
      handlers.onFinish?.(payload as FinishEvent);
      return {};
    case 'done': {
      const done = payload as DoneEvent;
      handlers.onDone?.(done);
      return { done };
    }
    case 'error': {
      const errEvent = payload as { code?: unknown; message?: unknown };
      const code = typeof errEvent.code === 'string' ? errEvent.code : 'STREAM_ERROR';
      const message = typeof errEvent.message === 'string' ? errEvent.message : '流式返回错误';
      handlers.onError?.({ code, message });
      return { error: new AgentApiError(code, message) };
    }
  }
}

/**
 * POST /api/agent/stream：fetch + ReadableStream 解析 SSE。
 *
 * - 支持 AbortSignal 取消（抛 AgentRunCancelledError）
 * - 120s 空闲看门狗：这段时间内没有收到任何字节则中断并抛 StreamIdleError
 * - `:` 开头的注释帧（keepalive）忽略
 * - 返回 done 事件载荷；未收到 done 时返回 null
 */
export async function streamAgentMessage(
  req: AgentMessageRequest,
  handlers: StreamHandlers = {},
  options: StreamOptions = {},
): Promise<AgentRunResult | null> {
  const cfg = requireConfig();
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const controller = new AbortController();
  let cancelledByUser = false;
  let idleTimedOut = false;

  const externalSignal = options.signal;
  const onExternalAbort = (): void => {
    cancelledByUser = true;
    controller.abort();
  };
  if (externalSignal) {
    if (externalSignal.aborted) {
      cancelledByUser = true;
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdleTimer = (): void => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      idleTimedOut = true;
      controller.abort();
    }, idleTimeoutMs);
  };
  const cleanup = (): void => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
    externalSignal?.removeEventListener('abort', onExternalAbort);
  };
  const translateAbort = (err: unknown): unknown => {
    if (idleTimedOut) {
      return new StreamIdleError(idleTimeoutMs);
    }
    if (cancelledByUser) {
      return new AgentRunCancelledError();
    }
    return err;
  };

  resetIdleTimer();

  let response: Response;
  try {
    response = await httpFetch(`${cfg.baseUrl}/api/agent/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': cfg.apiKey,
      },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
  } catch (err) {
    cleanup();
    throw translateAbort(err);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    cleanup();
    throw new AgentApiError('NO_BODY', '流式响应没有可读取的数据体');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let doneResult: AgentRunResult | null = null;
  let streamError: AgentApiError | null = null;

  const handleFrame = (rawFrame: string): void => {
    const frame = parseSseFrame(rawFrame);
    if (!frame) {
      return;
    }
    const dispatched = dispatchSseFrame(frame, handlers);
    if (dispatched.done) {
      doneResult = dispatched.done;
    }
    if (dispatched.error) {
      streamError = dispatched.error;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      resetIdleTimer();
      buffer += decoder.decode(value, { stream: true });

      for (;;) {
        const boundary = /\r?\n\r?\n/.exec(buffer);
        if (!boundary) {
          break;
        }
        const rawFrame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        handleFrame(rawFrame);
        if (streamError) {
          break;
        }
      }
      if (streamError) {
        break;
      }
    }

    if (!streamError && buffer.trim() !== '') {
      // 流结束时残留的最后一帧（未以空行收尾）
      handleFrame(buffer);
    }
  } catch (err) {
    cleanup();
    throw translateAbort(err);
  }

  cleanup();
  if (idleTimedOut) {
    throw new StreamIdleError(idleTimeoutMs);
  }
  if (cancelledByUser) {
    throw new AgentRunCancelledError();
  }
  if (streamError) {
    throw streamError;
  }
  return doneResult;
}
