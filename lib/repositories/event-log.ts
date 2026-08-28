import { query } from '../client';

export interface BotEventRecord {
  id: string;
  guild_id: string;
  event_type: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface LicenseEventRecord {
  id: string;
  license_id: string;
  event_type: string;
  details: Record<string, unknown>;
  created_at: string;
}

export async function logBotEvent(
  guildId: string,
  eventType: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  await query(
    `INSERT INTO bot_events (guild_id, event_type, details) VALUES ($1, $2, $3)`,
    [guildId, eventType, JSON.stringify(details)]
  );
}

export async function getRecentBotEvents(limit: number = 50, guildId?: string): Promise<BotEventRecord[]> {
  let sql = `SELECT id, guild_id, event_type, details, created_at FROM bot_events`;
  const params: unknown[] = [];

  if (guildId) {
    sql += ` WHERE guild_id = $1`;
    params.push(guildId);
  }

  sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const { rows } = await query<BotEventRecord>(sql, params);
  return rows;
}

export async function getLicenseEvents(licenseId: string): Promise<LicenseEventRecord[]> {
  const { rows } = await query<LicenseEventRecord>(
    `SELECT id, license_id, event_type, details, created_at FROM license_events WHERE license_id = $1 ORDER BY created_at DESC`,
    [licenseId]
  );
  return rows;
}
