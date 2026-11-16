const { Api } = require('node-telegram-bot-api');
const path = require('path');
const { setTimeout: delay } = require('node:timers/promises');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

let bot = null;
let botToken = null;

function setting(name) {
  const value = (process.env[name] || '').trim();
  return !value || value.startsWith('your_') || value === '...' ? '' : value;
}

function getTelegramStatus() {
  const missing = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'].filter((key) => !setting(key));
  return { configured: missing.length === 0, missing };
}

function getBot() {
  const token = setting('TELEGRAM_BOT_TOKEN');
  if (!token) return null;
  if (!bot || botToken !== token) {
    // v2 uses Api with one params object. Never retry an ambiguous write.
    bot = new Api(token, { timeoutMs: 20000, maxRetries: 0 });
    botToken = token;
  }
  return bot;
}

function deliveryError(message, statusCode = 502) {
  return Object.assign(new Error(message), { statusCode });
}

function explainTelegramError(err) {
  if (err.errorCode === 401 || err.errorCode === 404) {
    return 'Telegram rejected the bot token. Check TELEGRAM_BOT_TOKEN in backend/.env and restart the backend.';
  }
  if (err.errorCode === 403) {
    return 'The bot cannot post to this chat. Add it as a channel administrator and allow Post Messages.';
  }
  if (err.errorCode === 400) {
    return 'Telegram could not send this message. Check TELEGRAM_CHAT_ID and the bot\'s channel permissions.';
  }
  if (err.errorCode === 429) {
    const seconds = Number(err.retryAfter);
    return `Telegram is limiting messages. ${seconds > 0 ? `Wait ${seconds} seconds` : 'Wait a moment'} before trying again.`;
  }
  // Raw SDK errors can contain a URL with the bot token.
  return 'Telegram delivery could not be confirmed. Check the channel before retrying to avoid duplicate messages.';
}

function formatBriefing(briefing) {
  let saved;
  try { saved = JSON.parse(briefing.content_json || '{}'); } catch { saved = null; }
  const sections = Array.isArray(saved?.sections)
    ? saved.sections.filter((section) => Array.isArray(section?.stories) && section.stories.length)
    : [];
  if (!sections.length) return briefing.content_markdown || '';
  const parts = [briefing.title || saved.title || `Daily Briefing - ${briefing.date}`];
  if (saved.summary) parts.push(saved.summary);
  for (const section of sections) {
    parts.push(String(section.category || 'General').toUpperCase());
    for (const story of section.stories) {
      if (!story) continue;
      const lines = [story.headline || 'Untitled story', story.summary];
      if (story.why_it_matters) lines.push(`Why it matters: ${story.why_it_matters}`);
      try {
        const url = new URL(story.url);
        if (['http:', 'https:'].includes(url.protocol)) lines.push(`${story.source || 'Source'}: ${url.href}`);
      } catch { /* Ignore invalid source URLs. */ }
      parts.push(lines.filter(Boolean).join('\n'));
    }
  }
  return parts.join('\n\n');
}

function splitMessage(text, maxLength = 3900) {
  if (!Number.isInteger(maxLength) || maxLength < 2 || maxLength > 4096) throw new RangeError('Message length must be between 2 and 4096');
  const chunks = [];
  let remaining = String(text || '').trim();
  while (remaining.length > maxLength) {
    let end = maxLength;
    const boundary = Math.max(remaining.lastIndexOf('\n', end - 1), remaining.lastIndexOf(' ', end - 1));
    if (boundary >= maxLength / 2) end = boundary + 1;
    // Never cut an emoji's UTF-16 surrogate pair.
    const last = remaining.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end--;
    const chunk = remaining.slice(0, end);
    if (chunk.trim()) chunks.push(chunk);
    remaining = remaining.slice(end);
  }
  if (remaining.trim()) chunks.push(remaining);
  return chunks;
}

async function sendBriefing(text, chatId = setting('TELEGRAM_CHAT_ID'), options = {}) {
  const telegram = options.client || getBot();
  if (!telegram) throw deliveryError('Set TELEGRAM_BOT_TOKEN in backend/.env and restart the backend.', 503);
  if (!chatId) throw deliveryError('Set TELEGRAM_CHAT_ID in backend/.env to your channel ID, then restart the backend.', 503);
  const chunks = splitMessage(text);
  if (!chunks.length) throw deliveryError('This briefing is empty. Generate a new briefing first.', 422);
  const messageIds = [];
  for (const chunk of chunks) {
    if (messageIds.length) await delay(options.delayMs ?? 1100);
    try {
      const result = await telegram.sendMessage({
        chat_id: chatId,
        text: chunk,
        // Plain text keeps AI content and URLs without Markdown parser errors.
        link_preview_options: { is_disabled: true },
      });
      messageIds.push(result.message_id);
    } catch (err) {
      const partial = messageIds.length ? `${messageIds.length} of ${chunks.length} messages were sent. Retrying will resend those messages. ` : '';
      throw Object.assign(deliveryError(partial + explainTelegramError(err)), {
        delivered: messageIds.length, total: chunks.length, messageIds,
      });
    }
  }
  return { ok: true, messages: messageIds.length, messageIds };
}

module.exports = { sendBriefing, getBot, getTelegramStatus, formatBriefing, splitMessage, explainTelegramError };
