import { query, transaction } from '../db/client';
import { logger } from '../logger';

export interface GuildConfigRecord {
  guild_id: string;
  guild_name: string;
  customer_id: string;
  notification_channel_id: string | null;
  enabled: boolean;
  license_status?: string;
  expires_at?: string | null;
  is_active?: boolean;
}

/**
 * Register a Discord guild to a customer account. Enforces single-tenant ownership per guild.
 */
export async function registerGuild(
  customerId: string,
  guildId: string,
  guildName: string
): Promise<{ success: boolean; message: string }> {
  return transaction(async (client) => {
    // 1. Check if guild is already registered to another customer
    const { rows: existing } = await client.query(
      `SELECT customer_id FROM discord_guilds WHERE guild_id = $1`,
      [guildId]
    );

    if (existing.length > 0) {
      const owner = existing[0] as { customer_id: string };
      if (owner.customer_id !== customerId) {
        return {
          success: false,
          message: 'Guild is already registered to another customer license.',
        };
      }
      // Same customer: update name if changed
      await client.query(`UPDATE discord_guilds SET guild_name = $1 WHERE guild_id = $2`, [guildName, guildId]);
      return { success: true, message: 'Guild record updated.' };
    }

    // 2. Insert new guild
    await client.query(
      `INSERT INTO discord_guilds (guild_id, guild_name, customer_id) VALUES ($1, $2, $3)`,
      [guildId, guildName, customerId]
    );

    // 3. Create default configuration
    await client.query(
      `INSERT INTO guild_configurations (guild_id, notification_channel_id, enabled) VALUES ($1, NULL, TRUE)`,
      [guildId]
    );

    logger.info('Discord guild registered', { customerId, guildId, guildName });
    return { success: true, message: 'Guild registered successfully.' };
  });
}

/**
 * Get Guild Notification Configuration for Bot execution.
 * Validates that the associated Customer License is currently ACTIVE and NOT EXPIRED.
 */
export async function getGuildConfigForBot(guildId: string): Promise<GuildConfigRecord | null> {
  const { rows } = await query<GuildConfigRecord>(
    `
    SELECT 
      g.guild_id, g.guild_name, g.customer_id,
      c.notification_channel_id, c.enabled,
      l.status as license_status, l.expires_at
    FROM discord_guilds g
    JOIN guild_configurations c ON c.guild_id = g.guild_id
    JOIN licenses l ON l.customer_id = g.customer_id
    WHERE g.guild_id = $1
  `,
    [guildId]
  );

  if (rows.length === 0) return null;

  const record = rows[0];
  const now = new Date();
  const isActive =
    record.enabled &&
    record.license_status === 'ACTIVE' &&
    Boolean(record.expires_at) &&
    new Date(record.expires_at!) > now;

  return {
    ...record,
    is_active: isActive,
  };
}

/**
 * Update Notification Channel ID with Tenant Ownership Enforcement
 */
export async function updateGuildChannel(
  customerId: string,
  guildId: string,
  channelId: string | null,
  enabled: boolean = true
): Promise<boolean> {
  // Enforce Tenant Ownership Server-Side
  const { rows: guild } = await query(
    `SELECT id FROM discord_guilds WHERE guild_id = $1 AND customer_id = $2`,
    [guildId, customerId]
  );

  if (guild.length === 0) {
    logger.warn('Tenant ownership violation attempt on guild configuration update', { customerId, guildId });
    return false;
  }

  await query(
    `UPDATE guild_configurations SET notification_channel_id = $1, enabled = $2, updated_at = NOW() WHERE guild_id = $3`,
    [channelId, enabled, guildId]
  );

  logger.info('Guild notification channel updated', { customerId, guildId, channelId });
  return true;
}

/**
 * Get all Discord Guilds owned by a specific Customer
 */
export async function getCustomerGuilds(customerId: string): Promise<GuildConfigRecord[]> {
  const { rows } = await query<GuildConfigRecord>(
    `
    SELECT 
      g.guild_id, g.guild_name, g.customer_id,
      c.notification_channel_id, c.enabled
    FROM discord_guilds g
    LEFT JOIN guild_configurations c ON c.guild_id = g.guild_id
    WHERE g.customer_id = $1
    ORDER BY g.created_at DESC
  `,
    [customerId]
  );

  return rows;
}
