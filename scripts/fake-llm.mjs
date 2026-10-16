#!/usr/bin/env node
/**
 * 假 OpenAI 兼容模型（联调/演示用）：POST /v1/chat/completions → SSE 固定回复。
 * 用法：node scripts/fake-llm.mjs [port]
 *
 * P11-13 追加：
 * - 每个请求打印一行摘要（消息数 / 是否含图片 / 模型名），用于核对多模态链路的请求体；
 * - 分片之间加 40ms 间隔，让状态栏的 tok/s 有可测量的值；
 * - usage 带 prompt_tokens_details.cached_tokens，用于核对缓存命中率展示。
 */
import http from 'node:http';

const port = Number(process.argv[2] || 8777);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 统计请求体里的图片分片数（content 为 parts 数组时才能带图）。 */
function countImages(messages) {
  let images = 0;
  for (const message of messages ?? []) {
    if (Array.isArray(message?.content)) {
      for (const part of message.content) {
        if (part?.type === 'image_url') {
          images += 1;
        }
      }
    }
  }
  return images;
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        /* 非 JSON 请求体照常回固定文本 */
      }
      const images = countImages(parsed.messages);
      console.log(
        '[fake-llm] model=' + (parsed.model ?? '?')
        + ' messages=' + (parsed.messages?.length ?? 0)
        + ' images=' + images
        + ' stream=' + (parsed.stream === true)
        + ' tools=' + (parsed.tools?.length ?? 0),
      );
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const deltas = ['你好，', '我是 jnf-harness，', '联调链路已通。', images > 0 ? '（已收到 ' + images + ' 张图片）' : ''];
      for (const text of deltas) {
        if (!text) {
          continue;
        }
        res.write('data: ' + JSON.stringify({
          choices: [{ delta: { content: text } }],
        }) + '\n\n');
        await sleep(40);
      }
      res.write('data: ' + JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 8,
          prompt_tokens_details: { cached_tokens: 1080 },
        },
      }) + '\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
    return;
  }
  if (req.url.startsWith('/v1/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // 混入一组小米 MiMo 的模型名：用来验证规格目录（1M/128K）与非对话模型（ASR/TTS）的标记。
    const ids = [
      'fake-model',
      'fake-vision-model',
      'mimo-v2.6-flash',
      'mimo-v2.6-pro',
      'mimo-v2.6-pro-ultraspeed',
      'mimo-v2.5',
      'mimo-v2.5-asr',
      'mimo-v2.5-tts',
      'mimo-v2.5-tts-voiceclone',
      'mimo-v2.5-tts-voicedesign',
    ];
    res.end(JSON.stringify({ data: ids.map((id) => ({ id })) }));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, '127.0.0.1', () => {
  console.log('[fake-llm] listening on http://127.0.0.1:' + port);
});
