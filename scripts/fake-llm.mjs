#!/usr/bin/env node
/**
 * 假 OpenAI 兼容模型（联调/演示用）：POST /v1/chat/completions → SSE 固定回复。
 * 用法：node scripts/fake-llm.mjs [port]
 */
import http from 'node:http';

const port = Number(process.argv[2] || 8777);

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const deltas = ['你好，', '我是 jnf-harness，', '联调链路已通。'];
      for (const text of deltas) {
        res.write('data: ' + JSON.stringify({
          choices: [{ delta: { content: text } }],
        }) + '\n\n');
      }
      res.write('data: ' + JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 8 },
      }) + '\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
    return;
  }
  if (req.url.startsWith('/v1/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'fake-model' }] }));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, '127.0.0.1', () => {
  console.log('[fake-llm] listening on http://127.0.0.1:' + port);
});
