const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { once } = require('node:events');
const { Api } = require('node-telegram-bot-api');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const express = require('express');

// Never use project credentials, the real database, or the public Telegram API.
process.env.TELEGRAM_BOT_TOKEN = '123456:local-test-token';
process.env.TELEGRAM_CHAT_ID = '-1001234567890';
const telegram = require('../src/services/telegram');
const originalSend = telegram.sendBriefing;
let mockProcess;
let mockUrl = process.env.TELEGRAM_MOCK_URL;
let client;
let appServer;
let appUrl;
let db;
let briefings;
let posts;
let sequence = 0;

async function control(value = {}) {
  const response = await fetch(`${mockUrl}/__control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  assert.equal(response.status, 200);
}
async function calls() { return (await fetch(`${mockUrl}/__requests`)).json(); }
async function post(id) {
  const response = await fetch(`${appUrl}/api/briefings/${id}/post`, { method: 'POST' });
  return { status: response.status, body: await response.json() };
}
function draft(text = 'A news briefing with [brackets], **stars**, underscores_ and a link https://example.com/a_b') {
  return briefings.create({ date: '2026-11-15', title: `Test ${++sequence}`, content_markdown: text, content_json: '{}', ai_provider: 'test' });
}

before(async () => {
  if (!mockUrl) {
    mockProcess = spawn(process.execPath, [path.resolve(__dirname, '../../postman/mocks/telegram/default.js')], {
      env: { ...process.env, PORT: '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    mockUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Local mock did not start')), 10000);
      mockProcess.once('error', reject);
      mockProcess.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Local mock exited: ${code}`)); });
      mockProcess.stdout.on('data', (data) => {
        const match = data.toString().match(/telegram-mock:(\d+)/);
        if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); }
      });
    });
  }
  const target = new URL(mockUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname), 'Tests only allow a local mock');
  client = new Api(process.env.TELEGRAM_BOT_TOKEN, { apiRoot: mockUrl, timeoutMs: 500, maxRetries: 0 });
  // Inject a real SDK client pointed at the local HTTP stand-in.
  telegram.sendBriefing = (text) => originalSend(text, process.env.TELEGRAM_CHAT_ID, { client, delayMs: 0 });
  db = new Database(':memory:');
  db.exec(fs.readFileSync(path.resolve(__dirname, '../src/db/schema.sql'), 'utf8'));
  require.cache[require.resolve('../src/db/index')] = { exports: db };
  briefings = require('../src/db/repositories/briefings');
  posts = require('../src/db/repositories/posts');
  const app = express();
  app.use(express.json());
  app.use('/api', require('../src/routes'));
  appServer = app.listen(0, '127.0.0.1');
  await once(appServer, 'listening');
  appUrl = `http://127.0.0.1:${appServer.address().port}`;
});

after(async () => {
  telegram.sendBriefing = originalSend;
  if (appServer) await new Promise((resolve) => appServer.close(resolve));
  db?.close();
  mockProcess?.kill();
});

test('installed v2 SDK constructs correctly', () => {
  assert.equal(typeof telegram.getBot().sendMessage, 'function');
});

test('splits huge paragraphs and emoji without lost text or oversized messages', () => {
  for (const text of ['x'.repeat(10001), 'x'.repeat(3899) + '🌍'.repeat(6000), ('News sentence.\n\n').repeat(800)]) {
    const chunks = telegram.splitMessage(text);
    assert.equal(chunks.join(''), text.trim());
    assert.ok(chunks.every((chunk) => chunk.length <= 3900 && chunk.isWellFormed()));
  }
  assert.deepEqual(telegram.splitMessage(' \n '), []);
});

test('formats structured categories, summaries and safe source links', () => {
  const text = telegram.formatBriefing({ title: 'Daily news', content_json: JSON.stringify({ summary: 'Overview', sections: [{ category: 'science', stories: [
    { headline: 'A & B', summary: 'New research', why_it_matters: 'Helpful', source: 'Source', url: 'https://example.com/a_b' },
    { headline: 'Unsafe link', url: 'javascript:alert(1)' },
  ] }] }) });
  for (const expected of ['Daily news', 'Overview', 'SCIENCE', 'A & B', 'Why it matters: Helpful', 'https://example.com/a_b']) assert.ok(text.includes(expected));
  assert.ok(!text.includes('javascript:'));
  assert.equal(telegram.formatBriefing({ content_json: 'invalid', content_markdown: 'Legacy' }), 'Legacy');
});

test('configuration endpoint returns missing keys without exposing credentials', async () => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  try {
    const response = await (await fetch(`${appUrl}/api/telegram/status`)).json();
    assert.deepEqual(response, { configured: false, missing: ['TELEGRAM_BOT_TOKEN'] });
    await assert.rejects(originalSend('News'), (err) => err.statusCode === 503);
  } finally { process.env.TELEGRAM_BOT_TOKEN = token; }
});

test('click endpoint sends the complete briefing and records successful delivery', async () => {
  await control();
  const item = draft('Headline\n\n' + 'A & B_[test] 🌍 '.repeat(700));
  const result = await post(item.id);
  assert.equal(result.status, 200);
  const sent = await calls();
  assert.ok(sent.length > 1);
  assert.equal(sent.map((call) => call.text).join(''), item.content_markdown.trim());
  assert.ok(sent.every((call) => String(call.chat_id) === '-1001234567890' && !call.parse_mode && call.text.length <= 4096));
  assert.equal(result.body.messages, sent.length);
  assert.equal(briefings.getById(item.id).status, 'posted');
  assert.equal(posts.getByBriefing(item.id)[0].status, 'success');
  const repeated = await post(item.id);
  assert.equal(repeated.body.alreadyPosted, true);
  assert.equal((await calls()).length, sent.length);
});

test('concurrent clicks share one delivery', async () => {
  await control({ delayMs: 50 });
  const item = draft();
  const results = await Promise.all([post(item.id), post(item.id), post(item.id)]);
  assert.ok(results.every((result) => result.status === 200));
  assert.equal((await calls()).length, 1);
  assert.equal(posts.getByBriefing(item.id).length, 1);
});

for (const status of [400, 401, 403, 429, 500]) {
  test(`Telegram ${status} leaves briefing unposted and hides sensitive SDK errors`, async () => {
    await control({ status });
    const item = draft();
    const result = await post(item.id);
    assert.equal(result.status, 502);
    assert.equal(result.body.delivered, 0);
    assert.ok(!JSON.stringify(result.body).includes('local-test-token'));
    assert.equal(briefings.getById(item.id).status, 'draft');
    assert.equal(posts.getByBriefing(item.id)[0].status, 'failed');
    assert.equal((await calls()).length, 1, 'No automatic retries');
  });
}

test('partial delivery warns about resending and never marks briefing posted', async () => {
  await control({ status: 403, failAt: 2 });
  const item = draft('x'.repeat(9000));
  const result = await post(item.id);
  assert.equal(result.status, 502);
  assert.equal(result.body.delivered, 1);
  assert.equal(result.body.total, 3);
  assert.match(result.body.error, /Retrying will resend/);
  assert.equal((await calls()).length, 2);
  assert.equal(briefings.getById(item.id).status, 'draft');
});

test('a timed-out send is not retried automatically', async () => {
  await control({ delayMs: 800 });
  const result = await post(draft().id);
  assert.equal(result.status, 502);
  assert.match(result.body.error, /could not be confirmed/);
  assert.equal((await calls()).length, 1);
  await new Promise((resolve) => setTimeout(resolve, 350));
});

test('missing and empty briefings produce useful responses without a Telegram call', async () => {
  await control();
  assert.equal((await post('does-not-exist')).status, 404);
  assert.equal((await post(draft('   ').id)).status, 422);
  assert.equal((await calls()).length, 0);
});
