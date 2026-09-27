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

// 6. 模型渠道：列表含 M1 契约字段（hasApiKey 只回布尔）
const modelsList = await fetch(base + '/api/harness/settings/models', { headers });
const modelsJson = await modelsList.json();
const channels = modelsJson.data || [];
record('模型渠道列表 + hasApiKey 契约',
  modelsList.status === 200 && Array.isArray(channels)
    && channels.every((c) => typeof c.hasApiKey === 'boolean' && typeof c.apiKeyRef === 'string'));

// 7. 测试连接（M3：对 fake-llm /v1/models 探测）
const testRes = await fetch(base + '/api/harness/settings/models/test', {
  method: 'POST', headers,
  body: JSON.stringify({ baseUrl: 'http://127.0.0.1:8777/v1', protocol: 'openai' }),
});
const testJson = await testRes.json();
record('测试连接（fake-llm 上游）', testJson.data && testJson.data.ok === true,
  testJson.data ? testJson.data.message : '');

// 8. 渠道保存→启用→恢复→删除 回环（保留现场：恢复原生效渠道）
const prevActive = (channels.find((c) => c.active) || {}).channelCode || 'default';
const saveRes = await fetch(base + '/api/harness/settings/models', {
  method: 'POST', headers,
  body: JSON.stringify({
    channelCode: 'smoke-ch', displayName: '冒烟渠道', providerCode: 'custom',
    modelCode: 'smoke-model', baseUrl: 'http://127.0.0.1:8777/v1',
    protocol: 'openai', enabled: true, apiKey: 'sk-smoke-secret',
  }),
});
const saveJson = await saveRes.json();
const keyHidden = saveJson.data && !JSON.stringify(saveJson.data).includes('sk-smoke-secret')
  && saveJson.data.hasApiKey === true;
await fetch(base + '/api/harness/settings/models/active', {
  method: 'POST', headers, body: JSON.stringify({ channelCode: 'smoke-ch' }),
});
await fetch(base + '/api/harness/settings/models/active', {
  method: 'POST', headers, body: JSON.stringify({ channelCode: prevActive }),
});
const delRes = await fetch(base + '/api/harness/settings/models/smoke-ch', {
  method: 'DELETE', headers,
});
record('渠道保存/启用/删除回环 + 密钥不回显', saveRes.status === 200 && keyHidden
  && delRes.status === 200);

// 9. 厂商预设（M5：11 项）
const presetsRes = await fetch(base + '/api/harness/channels/presets', { headers });
const presetsJson = await presetsRes.json();
record('厂商预设 ≥ 11', presetsRes.status === 200 && (presetsJson.data || []).length >= 11,
  '数量: ' + ((presetsJson.data || []).length));

// 10. 插件目录发现（P2）
const catalogRes = await fetch(base + '/api/harness/plugins/catalog', { headers });
const catalogJson = await catalogRes.json();
record('插件目录 catalog', catalogRes.status === 200 && Array.isArray(catalogJson.data));

// 11. 插件配置 KV 写读删（P1：持久化）
await fetch(base + '/api/harness/plugins/smoke-plugin/config', {
  method: 'PUT', headers, body: JSON.stringify({ region: 'cn', level: 'debug' }),
});
const cfgRes = await fetch(base + '/api/harness/plugins/smoke-plugin/config', { headers });
const cfgJson = await cfgRes.json();
await fetch(base + '/api/harness/plugins/smoke-plugin/config/level', { method: 'DELETE', headers });
const cfgRes2 = await fetch(base + '/api/harness/plugins/smoke-plugin/config', { headers });
const cfgJson2 = await cfgRes2.json();
record('插件配置 KV 写读删',
  cfgJson.data && cfgJson.data.region === 'cn' && cfgJson.data.level === 'debug'
  && cfgJson2.data && cfgJson2.data.level === undefined && cfgJson2.data.region === 'cn');

// 12. 回放契约：tool_call 参数必须是 JSON 字符串（防 Map.toString 复发）+ tool_result 错误语义
{
  const rep = await fetch(base + '/api/harness/console/sessions/smoke-agent/messages', { headers });
  const repJson = await rep.json();
  const blocks = (repJson.data || []).flatMap((m) => m.blocks || []);
  const calls = blocks.filter((b) => b.type === 'tool_call');
  const results = blocks.filter((b) => b.type === 'tool_result');
  const argsJsonOk = calls.every((c) => {
    if (typeof c.arguments !== 'string') return false;
    if (c.arguments.trim() === '' || c.arguments.trim() === '{}') return true;
    try { JSON.parse(c.arguments); return true; } catch { return false; }
  });
  const resultShapeOk = results.every((r) => typeof r.error === 'boolean' && 'content' in r);
  record('回放契约：参数 JSON + tool_result 错误语义',
    rep.status === 200 && argsJsonOk && resultShapeOk,
    `tool_call=${calls.length} tool_result=${results.length}`);
}

const failed = checks.filter((c) => !c.ok);
console.log(failed.length === 0 ? '契约冒烟全部通过' : ('失败 ' + failed.length + ' 项'));
process.exit(failed.length === 0 ? 0 : 1);
