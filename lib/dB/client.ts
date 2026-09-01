import { Pool, QueryResult } from 'pg';
import { logger } from '../logger';

class MemoryDatabase {
  public admin_users: Array<Record<string, unknown>> = [];
  public customers: Array<Record<string, unknown>> = [];
  public licenses: Array<Record<string, unknown>> = [];
  public telegram_accounts: Array<Record<string, unknown>> = [];
  public discord_guilds: Array<Record<string, unknown>> = [];
  public guild_configurations: Array<Record<string, unknown>> = [];
  public activation_events: Array<Record<string, unknown>> = [];
  public license_events: Array<Record<string, unknown>> = [];
  public bot_events: Array<Record<string, unknown>> = [];

  public clear() {
    this.admin_users = [];
    this.customers = [];
    this.licenses = [];
    this.telegram_accounts = [];
    this.discord_guilds = [];
    this.guild_configurations = [];
    this.activation_events = [];
    this.license_events = [];
    this.bot_events = [];
  }
}

export const memoryDb = new MemoryDatabase();

let pgPool: Pool | null = null;
let useMemoryDb = false;

if (process.env.DATABASE_URL && process.env.DATABASE_URL !== 'mock') {
  try {
    const isSslRequired =
      process.env.DATABASE_URL.includes('render.com') ||
      process.env.DATABASE_URL.includes('supabase') ||
      process.env.DATABASE_URL.includes('postgres') ||
      process.env.DATABASE_URL.includes('sslmode=require');

    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000, // 5-second connection timeout to prevent hanging connections
      ssl: isSslRequired ? { rejectUnauthorized: false } : false,
    });

    pgPool.on('error', (err) => {
      logger.error('Unexpected error on idle PostgreSQL client', { error: String(err) });
    });
  } catch (err) {
    logger.warn('Failed to initialize PostgreSQL pool, falling back to memory store', { error: String(err) });
    useMemoryDb = true;
  }
} else {
  useMemoryDb = true;
}

export function setUseMemoryDb(val: boolean) {
  useMemoryDb = val;
}

export function isUsingMemoryDb() {
  return useMemoryDb;
}

function isConnectionError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('connection timeout') ||
    msg.includes('cannot connect') ||
    msg.includes('enotfound') ||
    msg.includes('pool is closed') ||
    msg.includes('timeout exceeded')
  );
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<{ rows: T[]; rowCount: number }> {
  if (pgPool && !useMemoryDb) {
    try {
      const res: QueryResult = await pgPool.query(sql, params);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
    } catch (err) {
      logger.error('PostgreSQL query error', { error: String(err) });
      if (process.env.NODE_ENV !== 'production' || isConnectionError(err)) {
        useMemoryDb = true;
        return executeMemoryQuery<T>(sql, params);
      }
      throw err;
    }
  }

  return executeMemoryQuery<T>(sql, params);
}

export async function transaction<T>(
  callback: (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }> }) => Promise<T>
): Promise<T> {
  if (pgPool && !useMemoryDb) {
    let client;
    try {
      client = await pgPool.connect();
    } catch (err) {
      logger.error('PostgreSQL connection error in transaction', { error: String(err) });
      if (process.env.NODE_ENV !== 'production' || isConnectionError(err)) {
        useMemoryDb = true;
        return callback({
          query: async (sql, params) => executeMemoryQuery(sql, params),
        });
      }
      throw err;
    }

    try {
      await client.query('BEGIN');
      const res = await callback({
        query: async (sql, params) => {
          const r = await client.query(sql, params);
          return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
        },
      });
      await client.query('COMMIT');
      return res;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback failure if connection lost
      }
      if (process.env.NODE_ENV !== 'production' || isConnectionError(err)) {
        useMemoryDb = true;
        return callback({
          query: async (sql, params) => executeMemoryQuery(sql, params),
        });
      }
      throw err;
    } finally {
      client.release();
    }
  }

  return callback({
    query: async (sql, params) => executeMemoryQuery(sql, params),
  });
}

function executeMemoryQuery<T>(sql: string, params: unknown[] = []): { rows: T[]; rowCount: number } {
  const cleanSql = sql.trim().replace(/\s+/g, ' ');
  const nowStr = new Date().toISOString();

  const getParam = (ph: string) => {
    const num = parseInt(ph.replace('$', ''), 10);
    return params[num - 1];
  };

  // INSERT
  if (/^INSERT INTO/i.test(cleanSql)) {
    const tableMatch = cleanSql.match(/INSERT INTO ([a-z_]+)/i);
    if (!tableMatch) return { rows: [], rowCount: 0 };
    const tableName = tableMatch[1] as keyof MemoryDatabase;
    const table = memoryDb[tableName] as Array<Record<string, unknown>>;

    const colMatch = cleanSql.match(/\(([^)]+)\)\s+VALUES/i);
    const cols = colMatch ? colMatch[1].split(',').map((c) => c.trim().replace(/"/g, '')) : [];

    const newRecord: Record<string, unknown> = {
      id: crypto.randomUUID(),
      created_at: nowStr,
      updated_at: nowStr,
    };

    cols.forEach((col, idx) => {
      newRecord[col] = params[idx] !== undefined ? params[idx] : null;
    });

    table.push(newRecord);
    return { rows: [newRecord as T], rowCount: 1 };
  }

  // UPDATE
  if (/^UPDATE/i.test(cleanSql)) {
    const tableMatch = cleanSql.match(/UPDATE ([a-z_]+)/i);
    if (!tableMatch) return { rows: [], rowCount: 0 };
    const tableName = tableMatch[1] as keyof MemoryDatabase;
    const table = memoryDb[tableName] as Array<Record<string, unknown>>;

    let updatedCount = 0;
    const updatedRows: Record<string, unknown>[] = [];

    const whereIdMatch = cleanSql.match(/\b(?<![a-z_])id\s*=\s*\$([0-9]+)/i);
    const whereGuildMatch = cleanSql.match(/\bguild_id\s*=\s*\$([0-9]+)/i);

    let targetId: unknown = null;
    let targetGuildId: unknown = null;

    if (whereIdMatch) targetId = params[parseInt(whereIdMatch[1], 10) - 1];
    if (whereGuildMatch) targetGuildId = params[parseInt(whereGuildMatch[1], 10) - 1];

    table.forEach((record) => {
      let matches = true;
      if (targetId && String(record.id) !== String(targetId)) matches = false;
      if (targetGuildId && String(record.guild_id) !== String(targetGuildId)) matches = false;

      if (matches) {
        record.updated_at = nowStr;

        const setClauseMatch = cleanSql.match(/SET (.+) WHERE/i);
        if (setClauseMatch) {
          const assignments = setClauseMatch[1].split(',');
          assignments.forEach((assign) => {
            const [col, valExpr] = assign.split('=').map((s) => s.trim());
            if (valExpr.startsWith('$')) {
              record[col] = getParam(valExpr);
            } else if (valExpr === 'NOW()') {
              record[col] = nowStr;
            } else if (valExpr === 'TRUE') {
              record[col] = true;
            } else if (valExpr === 'FALSE') {
              record[col] = false;
            } else if (valExpr === 'NULL') {
              record[col] = null;
            } else {
              record[col] = valExpr.replace(/^'|'$/g, '');
            }
          });
        }

        updatedCount++;
        updatedRows.push(record);
      }
    });

    return { rows: updatedRows as T[], rowCount: updatedCount };
  }

  // DELETE
  if (/^DELETE FROM/i.test(cleanSql)) {
    const tableMatch = cleanSql.match(/DELETE FROM\s+([a-z_]+)/i);
    if (!tableMatch) return { rows: [], rowCount: 0 };
    const tableName = tableMatch[1].toLowerCase() as keyof MemoryDatabase;
    const table = memoryDb[tableName] as Array<Record<string, unknown>>;

    const whereIdMatch = cleanSql.match(/\b(?<![a-z_])id\s*=\s*\$([0-9]+)/i);
    if (whereIdMatch) {
      const targetId = params[parseInt(whereIdMatch[1], 10) - 1];
      const idx = table.findIndex((r) => String(r.id) === String(targetId));
      if (idx !== -1) {
        table.splice(idx, 1);
        return { rows: [], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  }

  // SELECT
  if (/^SELECT/i.test(cleanSql)) {
    const mainSql = cleanSql.replace(/\(SELECT.*?\)::\w+/gi, '').replace(/\([^)]*\)/g, '');
    const tableMatch = mainSql.match(/FROM\s+([a-z_]+)/i);
    if (!tableMatch) return { rows: [], rowCount: 0 };
    const tableName = tableMatch[1].toLowerCase() as keyof MemoryDatabase;
    let table = (memoryDb[tableName] as Array<Record<string, unknown>>) || [];

    if (/WHERE/i.test(mainSql)) {
      const wherePart = mainSql.substring(mainSql.search(/WHERE/i) + 5);

      table = table.filter((row) => {
        const idMatch = wherePart.match(/\b(?<![a-z_])id\s*=\s*\$([0-9]+)/i);
        if (idMatch) {
          const targetVal = params[parseInt(idMatch[1], 10) - 1];
          if (String(row.id) !== String(targetVal)) return false;
        }

        const custIdMatch = wherePart.match(/\bcustomer_id\s*=\s*\$([0-9]+)/i);
        if (custIdMatch) {
          const targetVal = params[parseInt(custIdMatch[1], 10) - 1];
          if (String(row.customer_id) !== String(targetVal)) return false;
        }

        const guildIdMatch = wherePart.match(/\bguild_id\s*=\s*\$([0-9]+)/i);
        if (guildIdMatch) {
          const targetVal = params[parseInt(guildIdMatch[1], 10) - 1];
          if (String(row.guild_id) !== String(targetVal)) return false;
        }

        const codeHashMatch = wherePart.match(/\bcode_hash\s*=\s*\$([0-9]+)/i);
        if (codeHashMatch) {
          const targetVal = params[parseInt(codeHashMatch[1], 10) - 1];
          if (String(row.code_hash) !== String(targetVal)) return false;
        }

        const tgMatch = wherePart.match(/\btelegram_user_id\s*=\s*\$([0-9]+)/i);
        if (tgMatch) {
          const targetVal = params[parseInt(tgMatch[1], 10) - 1];
          if (String(row.telegram_user_id) !== String(targetVal)) return false;
        }

        const usernameMatch = wherePart.match(/\busername\s*=\s*\$([0-9]+)/i);
        if (usernameMatch) {
          const targetVal = params[parseInt(usernameMatch[1], 10) - 1];
          if (String(row.username) !== String(targetVal)) return false;
        }

        const ilikeMatch = wherePart.match(/ILIKE\s+\$([0-9]+)/i);
        if (ilikeMatch) {
          const targetVal = String(params[parseInt(ilikeMatch[1], 10) - 1] || '').replace(/%/g, '').toLowerCase();
          if (targetVal) {
            const nameStr = String(row.name || row.notes || row.code_display || '').toLowerCase();
            if (!nameStr.includes(targetVal)) return false;
          }
        }

        return true;
      });
    }

    let results: Record<string, unknown>[] = [...table];

    if (cleanSql.includes('JOIN customers')) {
      results = results.map((item) => {
        const cust = memoryDb.customers.find((c) => c.id === item.customer_id);
        return {
          ...item,
          customer_name: cust?.name,
        };
      });
    }

    if (cleanSql.includes('JOIN guild_configurations')) {
      results = results.map((item) => {
        const cfg = memoryDb.guild_configurations.find((g) => g.guild_id === item.guild_id);
        return {
          ...item,
          notification_channel_id: cfg?.notification_channel_id || null,
          enabled: cfg?.enabled ?? true,
        };
      });
    }

    if (cleanSql.includes('JOIN licenses')) {
      results = results.map((item) => {
        const lic = memoryDb.licenses.find((l) => l.customer_id === item.customer_id || l.customer_id === item.id);
        return {
          ...item,
          license_id: lic?.id || item.license_id,
          activation_code: lic?.code_display || item.activation_code,
          code_display: lic?.code_display || item.code_display,
          status: lic?.status || item.status || 'UNACTIVATED',
          license_status: lic?.status || 'UNACTIVATED',
          activated_at: lic?.activated_at || null,
          expires_at: lic?.expires_at || null,
        };
      });
    }

    if (cleanSql.includes('JOIN telegram_accounts')) {
      results = results.map((item) => {
        const tg = memoryDb.telegram_accounts.find((t) => t.customer_id === item.id || t.customer_id === item.customer_id);
        return {
          ...item,
          telegram_user_id: tg?.telegram_user_id || null,
        };
      });
    }

    if (cleanSql.includes('discord_guilds')) {
      results = results.map((item) => {
        const count = memoryDb.discord_guilds.filter((g) => g.customer_id === item.id || g.customer_id === item.customer_id).length;
        return {
          ...item,
          guild_count: count,
        };
      });
    }

    if (cleanSql.includes('ORDER BY created_at DESC')) {
      results.sort((a, b) => new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime());
    }

    return { rows: results as T[], rowCount: results.length };
  }

  return { rows: [], rowCount: 0 };
}
