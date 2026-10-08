/**
 * 控制台/审批 API 客户端（M7 配套）：会话列表/回放 + 运行期审批挂起-裁决。
 * 统一走 agent-client 的 apiRequest（信封解包 + 双通道传输）。
 */

import { apiRequest } from './agent-client';
import type {
  ApprovalVerdict,
  ChatMessage,
  ConsoleMessage,
  MsgSegment,
  RuntimeApprovalDto,
  RuntimeQuestionDto,
  SessionSummary,
  SessionUsage,
} from '../types';

export function fetchSessions(): Promise<SessionSummary[]> {
  return apiRequest<SessionSummary[]>('/api/harness/console/sessions');
}

/** 重命名会话（F3 契约：PATCH，body {title}，data:{sessionId,title}）。 */
export function renameSession(
  sessionId: string,
  title: string,
): Promise<{ sessionId: string; title: string }> {
  return apiRequest<{ sessionId: string; title: string }>(
    `/api/harness/console/sessions/${encodeURIComponent(sessionId)}`,
    'PATCH',
    { title },
  );
}

/** 删除会话（F3 契约：软删，事件文件保留）。 */
export function deleteSession(sessionId: string): Promise<void> {
  return apiRequest<void>(
    `/api/harness/console/sessions/${encodeURIComponent(sessionId)}`,
    'DELETE',
  );
}

/** 会话用量（F6 契约：事件聚合，无 usage 时全 0）。 */
export function fetchSessionUsage(sessionId: string): Promise<SessionUsage> {
  return apiRequest<SessionUsage>(
    `/api/harness/console/sessions/${encodeURIComponent(sessionId)}/usage`,
  );
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

/** 待作答问题（ask_user_question 挂起）。 */
export function fetchPendingQuestions(): Promise<RuntimeQuestionDto[]> {
  return apiRequest<RuntimeQuestionDto[]>('/api/harness/questions/runtime/pending');
}

/** 提交回答，Agent 流式恢复。 */
export function answerQuestion(questionId: string, answer: string): Promise<unknown> {
  return apiRequest(
    `/api/harness/questions/runtime/${encodeURIComponent(questionId)}/answer`,
    'POST',
    { answer },
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
      // segments：文本先于卡片（生成序近似），卡片与 toolCards 同引用，结果折入即同步
      const segments: MsgSegment[] = [];
      if (message.text) {
        segments.push({ kind: 'text', text: message.text });
      }
      for (const card of toolCards) {
        segments.push({ kind: 'card', card });
      }
      out.push({
        id: `${idPrefix}-a${out.length}`,
        role: 'assistant',
        text: message.text,
        toolCards,
        segments,
        status: 'done',
      });
      continue;
    }
    if (message.role === 'TOOL') {
      const previous = findPreviousAssistantWithCards(out);
      for (const block of message.blocks.filter((b) => b.type === 'tool_result')) {
        const card = previous?.toolCards.find((c) => c.callId === block.callId);
        if (card) {
          // error 是布尔标记；真实错误信息在 content 里（不能把 "true" 当错误文案展示）
          if (block.error) {
            card.status = 'error';
            card.error = typeof block.content === 'string' ? block.content : formatValue(block.content);
            card.result = undefined;
          } else {
            card.status = 'success';
            card.result = block.content;
            card.error = undefined;
          }
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

function formatValue(value: unknown): string {
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
