const { getBot, explainTelegramError } = require('../services/telegram');

async function main() {
  const api = getBot();
  if (!api) throw new Error('Set TELEGRAM_BOT_TOKEN in backend/.env first. Get the token from @BotFather.');
  const me = await api.getMe();
  console.log(`Bot connected: @${me.username}`);
  if (process.argv[2] === 'chats') {
    const updates = await api.getUpdates({ timeout: 0, limit: 100 });
    const chats = new Map();
    for (const update of updates) {
      const message = update.channel_post || update.edited_channel_post || update.message;
      for (const chat of [message?.chat, message?.forward_origin?.chat, update.my_chat_member?.chat]) {
        if (chat) chats.set(chat.id, chat);
      }
    }
    if (!chats.size) console.log('No recent chats found. Add the bot to your channel as an administrator, publish a new channel post, then run this command again.');
    for (const chat of chats.values()) console.log(`${chat.id} | ${chat.type} | ${chat.title || chat.username || chat.first_name || 'Chat'}`);
    console.log('Copy the channel ID (including the minus sign) into TELEGRAM_CHAT_ID in backend/.env.');
    return;
  }
  const chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!chatId || chatId.startsWith('your_')) throw new Error('Set TELEGRAM_CHAT_ID in backend/.env. Run npm run telegram:chats to find your channel ID.');
  const chat = await api.getChat({ chat_id: chatId });
  const member = await api.getChatMember({ chat_id: chat.id, user_id: me.id });
  if (chat.type === 'channel' && !(member.status === 'creator' || (member.status === 'administrator' && member.can_post_messages))) {
    throw new Error('Make the bot a channel administrator with Post Messages permission.');
  }
  console.log(`Ready to send to ${chat.title || chat.username || chat.id} (${chat.id}). No test message was sent.`);
}

main().catch((err) => {
  const message = err.code ? (err.errorCode === 409 ? 'This bot has a webhook or another active receiver. Use your existing bot integration to find the channel ID.' : explainTelegramError(err)) : err.message;
  console.error(message);
  process.exitCode = 1;
});
