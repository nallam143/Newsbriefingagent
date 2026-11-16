const briefingsRepo = require('../db/repositories/briefings');
const postsRepo = require('../db/repositories/posts');
const { sendBriefing, formatBriefing } = require('../services/telegram');

// Share an in-flight delivery across clicks and scheduled sends in this server.
const inFlight = new Map();

async function postToTelegram(briefingId) {
  if (inFlight.has(briefingId)) return inFlight.get(briefingId);
  const briefing = briefingsRepo.getById(briefingId);
  if (!briefing) throw Object.assign(new Error('Briefing not found'), { statusCode: 404 });
  if (briefing.status === 'posted') {
    return { success: true, channel: 'telegram', alreadyPosted: true, postedAt: briefing.posted_at };
  }
  const delivery = deliver(briefingId, briefing);
  inFlight.set(briefingId, delivery);
  try {
    return await delivery;
  } finally {
    inFlight.delete(briefingId);
  }
}

async function deliver(briefingId, briefing) {
  try {
    const result = await sendBriefing(formatBriefing(briefing));

    postsRepo.create({
      briefing_id: briefingId,
      channel: 'telegram',
      status: 'success',
      response: JSON.stringify(result),
    });

    const postedAt = new Date().toISOString();
    briefingsRepo.updateStatus(briefingId, 'posted', postedAt);

    return { success: true, channel: 'telegram', messages: result.messages, postedAt };
  } catch (err) {
    postsRepo.create({
      briefing_id: briefingId,
      channel: 'telegram',
      status: 'failed',
      response: err.message,
    });
    throw err;
  }
}

module.exports = { postToTelegram };
