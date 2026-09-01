import { getGuildConfigForBot } from '../repositories/discord';
import { logBotEvent } from '../repositories/event-log';
import {
  DiscordMemberDetails,
  buildJoinNotificationEmbed,
  getSnowflakeCreationDate,
} from './formatter';
import { logger } from '../logger';

// Deduplication cache: key = `${guildId}:${userId}`, value = timestamp
const recentJoinCache = new Map<string, number>();
const DUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// Clean stale entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of recentJoinCache.entries()) {
    if (now - timestamp > DUP_WINDOW_MS) {
      recentJoinCache.delete(key);
    }
  }
}, 60 * 1000);

export interface ChannelMessageSender {
  sendMessage(
    channelId: string,
    embed: ReturnType<typeof buildJoinNotificationEmbed>
  ): Promise<{ success: boolean; errorCode?: string; errorMessage?: string }>;

  checkChannelPermissions?(
    channelId: string
  ): Promise<{ hasPermission: boolean; missingPermissions: string[] }>;
}

export interface RawDiscordMemberPayload {
  user: {
    id: string;
    username: string;
    global_name?: string | null;
    bot?: boolean;
    avatar?: string | null;
  };
  joined_at: string;
  guild_id: string;
  guild_name?: string;
  member_count?: number;
}

export async function processMemberJoinEvent(
  payload: RawDiscordMemberPayload,
  messageSender: ChannelMessageSender
): Promise<{ processed: boolean; reason: string }> {
  const { guild_id: guildId, user, joined_at, guild_name, member_count } = payload;
  const userId = user.id;

  // 1. Deduplication check
  const dedupKey = `${guildId}:${userId}`;
  const lastProcessed = recentJoinCache.get(dedupKey);
  const now = Date.now();

  if (lastProcessed && now - lastProcessed < DUP_WINDOW_MS) {
    logger.info('Duplicate member join event ignored', { guildId, userId });
    return { processed: false, reason: 'DUPLICATE_EVENT' };
  }
  recentJoinCache.set(dedupKey, now);

  // 2. Fetch Guild Config and Validate License State
  const guildConfig = await getGuildConfigForBot(guildId);

  if (!guildConfig) {
    await logBotEvent(guildId, 'UNREGISTERED_GUILD', { userId });
    logger.warn('Join event received for unregistered guild', { guildId });
    return { processed: false, reason: 'UNREGISTERED_GUILD' };
  }

  // 3. License Expiration / Activity Check
  if (!guildConfig.is_active) {
    await logBotEvent(guildId, 'SKIPPED_INACTIVE_LICENSE', {
      customerId: guildConfig.customer_id,
      licenseStatus: guildConfig.license_status,
      expiresAt: guildConfig.expires_at,
    });
    logger.info('Join event skipped due to inactive or expired customer license', {
      guildId,
      customerId: guildConfig.customer_id,
      status: guildConfig.license_status,
    });
    return { processed: false, reason: 'INACTIVE_OR_EXPIRED_LICENSE' };
  }

  // 4. Notification Channel Check
  if (!guildConfig.notification_channel_id) {
    await logBotEvent(guildId, 'CHANNEL_MISSING', {
      customerId: guildConfig.customer_id,
      message: 'No notification channel configured for this guild.',
    });
    logger.warn('Notification channel not configured for guild', { guildId });
    return { processed: false, reason: 'CHANNEL_MISSING' };
  }

  // 5. Construct Member Details with UTC Timestamps
  const accountCreatedAt = getSnowflakeCreationDate(userId);
  const serverJoinedAt = joined_at ? new Date(joined_at) : new Date();

  const memberDetails: DiscordMemberDetails = {
    userId,
    username: user.username,
    displayName: user.global_name || user.username,
    isBot: Boolean(user.bot),
    avatarUrl: user.avatar
      ? `https://cdn.discordapp.com/avatars/${userId}/${user.avatar}.png`
      : null,
    accountCreatedAt,
    serverJoinedAt,
    guildId,
    guildName: guild_name || guildConfig.guild_name || 'Discord Server',
    memberCount: member_count || 1,
  };

  const embed = buildJoinNotificationEmbed(memberDetails);

  // 6. Check Permissions if sender implements permission checking
  if (messageSender.checkChannelPermissions) {
    const permCheck = await messageSender.checkChannelPermissions(guildConfig.notification_channel_id);
    if (!permCheck.hasPermission) {
      await logBotEvent(guildId, 'PERMISSION_ERROR', {
        channelId: guildConfig.notification_channel_id,
        missingPermissions: permCheck.missingPermissions,
      });
      logger.error('Missing permissions to send embed to channel', null, {
        guildId,
        channelId: guildConfig.notification_channel_id,
        missingPermissions: permCheck.missingPermissions,
      });
      return { processed: false, reason: 'PERMISSION_ERROR' };
    }
  }

  // 7. Send Notification Embed
  try {
    const result = await messageSender.sendMessage(guildConfig.notification_channel_id, embed);

    if (!result.success) {
      const errType = result.errorCode === 'UNKNOWN_CHANNEL' || result.errorCode === '10003'
        ? 'CHANNEL_MISSING'
        : result.errorCode === '50013'
        ? 'PERMISSION_ERROR'
        : 'NOTIFICATION_FAILED';

      await logBotEvent(guildId, errType, {
        channelId: guildConfig.notification_channel_id,
        error: result.errorMessage,
      });
      logger.error('Failed to send Discord join notification', null, {
        guildId,
        channelId: guildConfig.notification_channel_id,
        error: result.errorMessage,
      });
      return { processed: false, reason: errType };
    }

    // Success! Log event
    await logBotEvent(guildId, 'NOTIFICATION_SENT', {
      userId,
      username: user.username,
      channelId: guildConfig.notification_channel_id,
    });

    logger.info('Discord join notification sent successfully', { guildId, userId });
    return { processed: true, reason: 'NOTIFICATION_SENT' };
  } catch (err) {
    await logBotEvent(guildId, 'API_ERROR', {
      error: String(err),
    });
    logger.error('Unhandled API exception during member join processing', err, { guildId, userId });
    return { processed: false, reason: 'API_ERROR' };
  }
}
