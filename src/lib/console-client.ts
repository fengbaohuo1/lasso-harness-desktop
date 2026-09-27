/**
 * 控制台/审批 API 客户端（M7 配套）：会话列表/回放 + 运行期审批挂起-裁决。
 * 统一走 agent-client 的 apiRequest（信封解包 + 双通道传输）。
 */

import { apiRequest } from './agent-client';
import type {
  ApprovalVerdict,
  ChatMessage,
  ConsoleMessage,
  RuntimeApprovalDto,
  SessionSummary,
} from '../types';

export function fetchSessions(): Promise<SessionSummary[]> {
  return apiRequest<SessionSummary[]>('/api/harness/console/sessions');
}

export function fetchSessionMessages(sessionId: string): Promise<ConsoleMessage[]> {
  return apiRequest<ConsoleMessage[]>(
    `/api/harness/console/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
}

export function fetchPendingApprovals(): Promise<RuntimeApprovalDto[]> {
  return apiRequest<RuntimeApprovalDto[]>('/api/harness/approvals/runtime/pending');
}

export function resolveApproval(
  approvalId: string,
  verdict: ApprovalVerdict,
): Promise<unknown> {
  return apiRequest(
    `/api/harness/approvals/runtime/${encodeURIComponent(approvalId)}/resolve`,
    'POST',
    { verdict },
  );
}

/**
 * 会话回放 → 对话气泡：USER/ASSISTANT 建气泡，TOOL 消息的结果折进上一条助手消息的工具卡。
 */
export function toChatMessages(
  consoleMessages: ConsoleMessage[],
  idPrefix: string,
): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const message of consoleMessages) {
    if (message.role === 'USER' || message.role === 'SYSTEM') {
      if (message.role === 'USER') {
        out.push({
          id: `${idPrefix}-u${out.length}`,
          role: 'user',
          text: message.text,
          toolCards: [],
          status: 'done',
        });
      }
      continue;
    }
    if (message.role === 'ASSISTANT') {
      const toolCards = message.blocks
        .filter((block) => block.type === 'tool_call')
        .map((block) => ({
          key: block.callId || `${block.name}-${out.length}`,
          toolName: block.name || 'unknown_tool',
          callId: block.callId || '',
          args: safeParse(block.arguments),
          status: 'running' as const,
          startedAt: Date.now(),
        }));
      out.push({
        id: `${idPrefix}-a${out.length}`,
        role: 'assistant',
        text: message.text,
        toolCards,
        status: 'done',
      });
      continue;
    }
    if (message.role === 'TOOL') {
      const previous = findPreviousAssistantWithCards(out);
      for (const block of message.blocks.filter((b) => b.type === 'tool_result')) {
        const card = previous?.toolCards.find((c) => c.callId === block.callId);
        if (card) {
          card.status = block.error ? 'error' : 'success';
          card.result = block.content;
          card.error = block.error ? String(block.error) : undefined;
          card.endedAt = Date.now();
        }
      }
    }
  }
  return out;
}

function findPreviousAssistantWithCards(out: ChatMessage[]): ChatMessage | undefined {
  for (let i = out.length - 1; i >= 0; i -= 1) {
    if (out[i].role === 'assistant' && out[i].toolCards.length > 0) {
      return out[i];
    }
  }
  return undefined;
}

function safeParse(raw?: string): unknown {
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
