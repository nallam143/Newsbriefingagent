const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const cron = require('node-cron');

function loadFile(relative, dependencies, env) {
  const sandbox = {
    module: { exports: {} }, require: (name) => {
      assert.ok(name in dependencies, `Unexpected import: ${name}`);
      return dependencies[name];
    },
    process: { env }, fetch, console: { log() {}, error() {} },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), sandbox);
  return sandbox.module.exports;
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
function close(server) { return new Promise((resolve) => server.close(resolve)); }

async function appFor(aiUrl) {
  const state = { saves: 0, posts: 0 };
  const briefings = { create: () => { state.saves++; return { id: 'local-test-draft' }; } };
  const poster = { postToTelegram: async () => { state.posts++; } };
  const env = { AI_LAYER_URL: aiUrl, TELEGRAM_BOT_TOKEN: 'dummy-token' };
  const runner = loadFile('agents/runner.js', {
    './collector': { collectAll: async () => ({ sources: 1 }) },
    './poster': poster,
    '../db/repositories/articles': { getRecent: () => [{ id: 'test-article', title: 'Local fixture', url: 'https://example.com' }] },
    '../db/repositories/briefings': briefings,
    '../services/time': { appDate: () => '2026-11-17' },
  }, env);
  const router = loadFile('routes/index.js', {
    express, 'node-cron': cron,
    '../db/repositories/sources': {}, '../db/repositories/briefings': briefings,
    '../agents/runner': runner, '../agents/poster': poster,
    '../services/telegram': { getTelegramStatus: () => ({ configured: false, missing: [] }) },
    '../services/time': { APP_TIMEZONE: 'Asia/Kolkata' },
  }, env);
  const app = express();
  app.use(express.json());app.use('/api',router);
  const server = http.createServer(app);
  const url = await listen(server);
  return { server, url, state };
}

async function run(url) {
  const response = await fetch(`${url}/api/run`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoPost: false }),
  });
  return { status: response.status, body: await response.json() };
}

test('stopped AI service returns actionable 503 and does not save or post', async () => {
  const unused = http.createServer();
  const deadUrl = await listen(unused);
  await close(unused);
  const app = await appFor(deadUrl);
  try {
    const result = await run(app.url);
    assert.equal(result.status, 503);
    assert.match(result.body.error, /Start the service in the ai-layer folder/);
    assert.match(result.body.error, /AI_LAYER_URL/);
    assert.equal(app.state.saves, 0);assert.equal(app.state.posts, 0);
  } finally { await close(app.server); }
});

test('reachable AI service still saves a draft without posting', async () => {
  let request;
  const ai = http.createServer(async (req,res) => {
    let raw='';for await (const part of req) raw+=part;
    request={ method:req.method, url:req.url, data:JSON.parse(raw) };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ title:'Local test', markdown:'# Test', selected_indexes:[1], provider:'test' }));
  });
  const app = await appFor(await listen(ai));
  try {
    const result = await run(app.url);
    assert.equal(result.status, 200);assert.equal(result.body.briefingId,'local-test-draft');
    assert.equal(request.url,'/briefing');assert.equal(request.method,'POST');
    assert.equal(request.data.articles.length,1);
    assert.equal(app.state.saves,1);assert.equal(app.state.posts,0);
  } finally { await close(app.server);await close(ai); }
});

test('AI HTTP errors remain distinct from connection failures', async () => {
  const ai = http.createServer((req,res) => {res.writeHead(500);res.end('Model unavailable');});
  const app = await appFor(await listen(ai));
  try {
    const result = await run(app.url);
    assert.equal(result.status,500);assert.match(result.body.error,/AI Layer error \(500\)/);
    assert.equal(app.state.saves,0);assert.equal(app.state.posts,0);
  } finally {await close(app.server);await close(ai);}
});
