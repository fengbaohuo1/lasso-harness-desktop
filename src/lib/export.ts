/**
 * P8-1 /export：当前会话导出 Markdown（气泡文本 + 工具卡摘要），浏览器侧下载。
 * 组装纯前端（消息态即所见）；文件名带会话 id 与时间戳。
 */

import type { ChatMessage } from '../types';

/** 把当前会话组装成 Markdown 文档。 */
export function buildTranscriptMarkdown(messages: ChatMessage[], sessionId: string): string {
  const lines: string[] = [
    `# 会话导出 · ${sessionId}`,
    '',
    `> 导出时间：${new Date().toLocaleString()} · 消息 ${messages.length} 条`,
    '',
  ];
  for (const message of messages) {
    const who = message.role === 'user' ? '👤 用户' : '🤖 助手';
    lines.push(`## ${who}`, '');
    lines.push(message.text && message.text.trim() !== '' ? message.text : '（无文本）', '');
    for (const card of message.toolCards) {
      lines.push(`- 🔧 \`${card.toolName}\` — ${card.status}`, '');
    }
    lines.push('---', '');
  }
  return lines.join('\n');
}

/** 组装并触发下载（a[download] + Blob；WebView2 支持）。 */
export function exportTranscriptMarkdown(messages: ChatMessage[], sessionId: string): void {
  const markdown = buildTranscriptMarkdown(messages, sessionId);
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `session-${sessionId}-${Date.now().toString(36)}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
