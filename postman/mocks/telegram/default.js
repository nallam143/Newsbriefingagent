// Local-only Telegram stand-in based on https://core.telegram.org/bots/api#sendmessage.
// Control routes are test helpers, not Telegram API endpoints.
const http = require('node:http');
let calls = [];
let failure = {};
const server = http.createServer(async (req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  let body = req.body;
  if (body === undefined) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    body = raw;
  }
  if (typeof body === 'string') {
    try {
      body = req.headers['content-type']?.includes('application/x-www-form-urlencoded')
        ? Object.fromEntries(new URLSearchParams(body)) : JSON.parse(body || '{}');
    } catch { return reply(400, { ok: false }); }
  }
  if (req.url === '/__control' && req.method === 'POST') {
    calls = [];
    failure = body;
    return reply(200, { ok: true });
  }
  if (req.url === '/__requests') return reply(200, calls);
  if (req.url !== '/bot123456:local-test-token/sendMessage' || req.method !== 'POST') {
    return reply(501, { ok: false, description: 'Not modelled in this local mock' });
  }
  calls.push(body);
  if (failure.delayMs) await new Promise((resolve) => setTimeout(resolve, failure.delayMs));
  if (failure.status && calls.length === (failure.failAt || 1)) {
    return reply(failure.status, {
      ok: false, error_code: failure.status,
      description: 'Simulated error containing secret 123456:local-test-token',
      parameters: failure.status === 429 ? { retry_after: 2 } : undefined,
    });
  }
  if (!body.chat_id || !body.text?.trim() || body.text.length > 4096 || body.parse_mode) {
    return reply(400, { ok: false, error_code: 400, description: 'Invalid sendMessage payload' });
  }
  reply(200, { ok: true, result: {
    message_id: calls.length, date: Math.floor(Date.now() / 1000),
    chat: { id: Number(body.chat_id), type: 'channel', title: 'Local test channel' }, text: body.text,
  } });
});
server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => {
  console.log(`telegram-mock:${server.address().port}`);
});
