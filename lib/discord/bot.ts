import { Client, GatewayIntentBits, TextChannel, EmbedBuilder } from 'discord.js';
import { processMemberJoinEvent, ChannelMessageSender } from './join-handler';
import { logger } from '../logger';

let discordClient: Client | null = null;

export function getDiscordClient(): Client | null {
  if (discordClient) return discordClient;

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || token === 'your_discord_bot_token_here') {
    logger.warn('DISCORD_BOT_TOKEN not provided. Discord Gateway client running in mock/webhook mode.');
    return null;
  }

  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers, // Requires Server Members Intent enabled in Discord Dev Portal
    ],
  });

  discordClient.on('ready', () => {
    logger.info(`Discord Bot logged in as ${discordClient?.user?.tag}`);
  });

  discordClient.on('guildMemberAdd', async (member) => {
    logger.info('Guild member add event received via Gateway', {
      guildId: member.guild.id,
      userId: member.user.id,
    });

    const messageSender: ChannelMessageSender = {
      sendMessage: async (channelId, embedData) => {
        try {
          const channel = await discordClient?.channels.fetch(channelId);
          if (!channel || !(channel instanceof TextChannel)) {
            return { success: false, errorCode: 'UNKNOWN_CHANNEL', errorMessage: 'Channel not found or not text channel' };
          }

          const embed = new EmbedBuilder()
            .setTitle(embedData.title)
            .setColor(embedData.color)
            .setTimestamp(new Date(embedData.timestamp))
            .setFooter(embedData.footer);

          if (embedData.thumbnail) {
            embed.setThumbnail(embedData.thumbnail.url);
          }

          embedData.fields.forEach((f) => embed.addFields({ name: f.name, value: f.value, inline: f.inline }));

          await channel.send({ embeds: [embed] });
          return { success: true };
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const errCode = (err as { code?: number })?.code ? String((err as { code?: number }).code) : 'API_ERROR';
          return { success: false, errorCode: errCode, errorMessage: errMsg };
        }
      },
    };

    await processMemberJoinEvent(
      {
        user: {
          id: member.user.id,
          username: member.user.username,
          global_name: member.user.globalName,
          bot: member.user.bot,
          avatar: member.user.avatar,
        },
        joined_at: member.joinedAt?.toISOString() || new Date().toISOString(),
        guild_id: member.guild.id,
        guild_name: member.guild.name,
        member_count: member.guild.memberCount,
      },
      messageSender
    );
  });

  discordClient.login(token).catch((err) => {
    logger.error('Discord login error', err);
  });

  return discordClient;
}

export async function stopDiscordBot() {
  if (discordClient) {
    logger.info('Stopping Discord Bot gracefully...');
    await discordClient.destroy();
    discordClient = null;
  }
}
