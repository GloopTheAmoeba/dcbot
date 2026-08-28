/**
 * Discord Notification Formatter & Date Utilities
 */

/**
 * Extract UTC Account Creation Date from a Discord Snowflake ID.
 * Discord Epoch starts at 2015-01-01T00:00:00.000Z (1420070400000 ms).
 */
export function getSnowflakeCreationDate(snowflakeId: string): Date {
  try {
    const DISCORD_EPOCH = BigInt(1420070400000);
    const idBig = BigInt(snowflakeId);
    const timestampMs = Number((idBig >> BigInt(22)) + DISCORD_EPOCH);
    return new Date(timestampMs);
  } catch {
    return new Date();
  }
}

/**
 * Calculate precise human-readable account age ("X years, Y months, Z days").
 * Strict UTC calculation with ZERO floating-point numbers.
 */
export function calculatePreciseAccountAge(createdAt: Date, now: Date = new Date()): string {
  if (isNaN(createdAt.getTime())) return 'Unknown';

  let years = now.getUTCFullYear() - createdAt.getUTCFullYear();
  let months = now.getUTCMonth() - createdAt.getUTCMonth();
  let days = now.getUTCDate() - createdAt.getUTCDate();

  if (days < 0) {
    months -= 1;
    // Get total days in previous UTC month
    const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    days += previousMonth.getUTCDate();
  }

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  if (years < 0) return '0 days';

  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? 'year' : 'years'}`);
  if (months > 0) parts.push(`${months} ${months === 1 ? 'month' : 'months'}`);
  parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);

  return parts.length > 0 ? parts.join(', ') : '0 days';
}

export interface DiscordMemberDetails {
  userId: string;
  username: string;
  displayName: string;
  isBot: boolean;
  avatarUrl: string | null;
  accountCreatedAt: Date;
  serverJoinedAt: Date;
  guildId: string;
  guildName: string;
  memberCount: number;
}

export interface DiscordEmbedPayload {
  title: string;
  color: number;
  thumbnail?: { url: string };
  fields: Array<{ name: string; value: string; inline?: boolean }>;
  footer: { text: string };
  timestamp: string;
}

/**
 * Build professional, rich Discord Notification Embed Payload
 */
export function buildJoinNotificationEmbed(member: DiscordMemberDetails): DiscordEmbedPayload {
  const accountAge = calculatePreciseAccountAge(member.accountCreatedAt, member.serverJoinedAt);
  const accountCreatedISO = member.accountCreatedAt.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  const serverJoinedISO = member.serverJoinedAt.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

  return {
    title: `📥 New Member Joined | ${member.displayName}`,
    color: member.isBot ? 0x95a5a6 : 0x2ecc71, // Green for users, Gray for bots
    thumbnail: member.avatarUrl ? { url: member.avatarUrl } : undefined,
    fields: [
      {
        name: '👤 User Information',
        value: `**Display Name:** ${member.displayName}\n**Username:** ${member.username}\n**User Mention:** <@${member.userId}>\n**User ID:** \`${member.userId}\`\n**Account Type:** ${member.isBot ? '🤖 Bot' : '👤 User'}`,
        inline: false,
      },
      {
        name: '⏳ Account Age',
        value: `**Age:** ${accountAge}\n**Created:** ${accountCreatedISO}`,
        inline: true,
      },
      {
        name: '📅 Server Join',
        value: `**Joined:** ${serverJoinedISO}\n**Server Member Count:** ${member.memberCount}`,
        inline: true,
      },
      {
        name: '🏰 Server Information',
        value: `**Server Name:** ${member.guildName}\n**Server ID:** \`${member.guildId}\``,
        inline: false,
      },
    ],
    footer: {
      text: 'MouxBot Join Notification Engine • UTC Time',
    },
    timestamp: new Date().toISOString(),
  };
}
