#!/usr/bin/env node
/**
 * 一次性验证：通过 harness SSE 接口与真实厂商对聊（UTF-8 安全）。
 * 用法：node _verify-chat.mjs <port> <apiKey> <message> [agentId]
 */
const [port, apiKey, message, agentId = 'verify-chat'] = process.argv.slice(2);
const base = 'http://127.0.0.1:' + port;

const res = await fetch(base + '/api/agent/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
  body: JSON.stringify({ agentId, message }),
});
const raw = await res.text();
const events = [];
let text = '';
for (const frame of raw.split('\n\n')) {
  let ev = '';
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) ev = line.slice(6).trim();
    if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!ev) continue;
  events.push(ev);
  if (ev === 'chunk') {
    try { text += JSON.parse(data).content || ''; } catch { /* 忽略 */ }
  }
  if (ev === 'error') console.log('error 事件:', data);
  if (ev === 'step_break') console.log('工具:', data.slice(0, 120));
}
console.log('事件序列:', events.join(','));
console.log('模型回复:', text);
