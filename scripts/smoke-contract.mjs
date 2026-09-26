#!/usr/bin/env node
/**
 * 契约冒烟（第二阶段联调）：按桌面 UI 的调用方式验证后端契约。
 * 前提：后端 JAR 已按壳的 spawn 参数启动（--harness.auth.api-keys=<key>），fake-llm 在线。
 * 用法：node scripts/smoke-contract.mjs <port> <apiKey>
 */
const [port, apiKey] = process.argv.slice(2);
if (!port || !apiKey) {
  console.error('用法: node scripts/smoke-contract.mjs <port> <apiKey>');
  process.exit(2);
}
const base = 'http://127.0.0.1:' + port;
const headers = { 'Content-Type': 'application/json', 'X-API-Key': apiKey };
const checks = [];
const record = (name, ok, detail) => {
  checks.push({ name, ok });
  console.log((ok ? '✓' : '✗') + ' ' + name + (detail ? ' — ' + detail : ''));
};

// 1. 就绪探测
const health = await fetch(base + '/actuator/health');
record('actuator/health 就绪', health.status === 200);

// 2. Agent Card 发现（数字人接入面）
const card = await fetch(base + '/.well-known/agent-card.json');
const cardJson = await card.json();
record('Agent Card 发现', card.status === 200 && cardJson.protocolVersion === '0.3.0');

// 3. 鉴权：无 key 401
const noAuth = await fetch(base + '/api/agent/message', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ agentId: 'smoke', message: 'hi' }),
});
record('无 API Key → 401', noAuth.status === 401);

// 4. SSE 流式对话（UI 的 streamAgentMessage 同款解析）
const streamRes = await fetch(base + '/api/agent/stream', {
  method: 'POST', headers,
  body: JSON.stringify({ agentId: 'smoke-agent', message: '联调测试' }),
});
const events = new Set();
let text = '';
const reader = streamRes.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const frames = buffer.split('\n\n');
  buffer = frames.pop();
  for (const frame of frames) {
    let event = '';
    let data = '';
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!event) continue;
    events.add(event);
    if (event === 'chunk' && data) {
      try { text += JSON.parse(data).content || ''; } catch { /* 忽略 */ }
    }
  }
}
record('SSE 事件序列 meta/chunk/done',
  events.has('meta') && events.has('chunk') && events.has('done'), '事件: ' + [...events].join(','));
record('流式文本回显', text.includes('jnf-harness'), '文本: ' + text);

// 5. 历史回放
const replay = await fetch(base + '/api/harness/console/sessions/smoke-agent/messages', { headers });
const replayJson = await replay.json();
const replayText = JSON.stringify(replayJson.data || []);
record('历史回放含对话', replay.status === 200 && replayText.includes('联调测试'));

const failed = checks.filter((c) => !c.ok);
console.log(failed.length === 0 ? '契约冒烟全部通过' : ('失败 ' + failed.length + ' 项'));
process.exit(failed.length === 0 ? 0 : 1);
