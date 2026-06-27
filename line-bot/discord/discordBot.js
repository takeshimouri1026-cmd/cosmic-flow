/**
 * discord/discordBot.js
 * Discord の窓口アダプタ
 *
 * Discordのメッセージを受け取り、共通頭脳 core/brain.js に渡す薄い層。
 * LINEと同じ morike.db を共有するので「同じおへやちゃん・同じ記憶」になる。
 * ただし予定共有(share_schedule)はDiscordでは無効（scheduleEnabled:false）。
 *
 * 起動には DISCORD_BOT_TOKEN が必要。未設定なら起動しない（LINE単体運用OK）。
 * Discord Developer Portal で「MESSAGE CONTENT INTENT」を有効にすること。
 */

import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { processMessage } from '../core/brain.js';

// Discord User ID → 内部キー名のマッピング（Railway Variables で設定）
function getUserMapping() {
  return {
    [process.env.DISCORD_USER_TAKEYUKI]: 'takeyuki',
    [process.env.DISCORD_USER_YORIMI]:   'yorimi',
    [process.env.DISCORD_USER_HANA]:     'hana',
  };
}

export function startDiscordBot() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.log('[Discord] DISCORD_BOT_TOKEN 未設定のため起動しません');
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel], // DM受信に必要
  });

  client.once('ready', () => {
    console.log(`[Discord] ログイン成功: ${client.user.tag}`);
  });

  client.on('messageCreate', async (message) => {
    try {
      // 他のbot・おへや自身の発言は無視（bot同士の無限ループ防止）
      if (message.author.bot) return;

      // メンション文字を読みやすく変換（"<@botID>" → "おへや"、他ユーザーは表示名に）
      let text = message.content ?? '';
      text = text.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), 'おへや');
      for (const [, user] of message.mentions.users) {
        if (user.id === client.user.id) continue;
        const disp = message.guild?.members?.cache?.get(user.id)?.displayName ?? user.globalName ?? user.username;
        text = text.replace(new RegExp(`<@!?${user.id}>`, 'g'), disp);
      }
      text = text.trim();
      if (!text) return; // 添付のみ等はスキップ

      // 家族なら内部キー、それ以外は 'guest'（反応はするが記憶はしない）
      const mapped = getUserMapping()[message.author.id];
      const person = mapped ?? 'guest';
      const senderName = mapped
        ? undefined // brain側でDISPLAY_NAMESから解決
        : (message.member?.displayName ?? message.author.globalName ?? message.author.username);

      if (!mapped) {
        console.log(`[Discord] ゲスト発言: ${senderName}（${message.author.id}）`);
      }

      const conversationKey = `discord:${message.channelId}`;
      const timestamp = new Date(message.createdTimestamp).toISOString();

      await processMessage({
        person,
        senderName,
        senderId: message.author.id,
        conversationKey,
        text,
        timestamp,
        platform: 'discord',
        scheduleEnabled: false, // Discordでは予定共有しない
        reply: async (msg) => { await message.channel.send(msg); },
        push:  async (msg) => { await message.channel.send(msg); },
      });
    } catch (err) {
      console.error('[Discord] メッセージ処理エラー:', err.message);
    }
  });

  client.login(token).catch(err => {
    console.error('[Discord] ログイン失敗:', err.message);
  });
}
