import { query, transaction } from '../db/client';
import { generateActivationCode, hashActivationCode } from '../security/codes';

export interface CustomerRecord {
  id: string;
  name: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  license_id?: string;
  activation_code?: string;
  status?: string;
  telegram_user_id?: number | null;
  activated_at?: string | null;
  expires_at?: string | null;
  guild_count?: number;
}

export async function createCustomer(name: string, notes?: string): Promise<{ customer: CustomerRecord; code: string }> {
  return transaction(async (client) => {
    // 1. Create Customer
    const { rows: custRows } = await client.query(
      'INSERT INTO customers (name, notes) VALUES ($1, $2) RETURNING *',
      [name, notes || null]
    );
    const customer = custRows[0] as CustomerRecord;

    // 2. Generate Activation Code
    const code = generateActivationCode();
    const codeHash = hashActivationCode(code);

    // 3. Create License Record (UNACTIVATED)
    const { rows: licRows } = await client.query(
      'INSERT INTO licenses (customer_id, code_hash, code_display, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [customer.id, codeHash, code, 'UNACTIVATED']
    );
    const license = licRows[0] as { id: string };

    // 4. Record License Event
    await client.query(
      'INSERT INTO license_events (license_id, event_type, details) VALUES ($1, $2, $3)',
      [license.id, 'CREATED', JSON.stringify({ created_by: 'admin' })]
    );

    return {
      customer: {
        ...customer,
        license_id: license.id as string,
        activation_code: code,
        status: 'UNACTIVATED',
        activated_at: null,
        expires_at: null,
        telegram_user_id: null,
      },
      code,
    };
  });
}

export async function getCustomers(search?: string): Promise<CustomerRecord[]> {
  let sql = `
    SELECT 
      c.id, c.name, c.notes, c.created_at, c.updated_at,
      l.id as license_id, l.code_display as activation_code, COALESCE(l.status, 'UNACTIVATED') as status,
      l.activated_at, l.expires_at,
      t.telegram_user_id,
      (SELECT COUNT(*) FROM discord_guilds dg WHERE dg.customer_id = c.id)::int as guild_count
    FROM customers c
    LEFT JOIN licenses l ON l.customer_id = c.id
    LEFT JOIN telegram_accounts t ON t.customer_id = c.id
  `;

  const params: unknown[] = [];
  if (search && search.trim() !== '') {
    sql += ` WHERE c.name ILIKE $1 OR l.code_display ILIKE $1 OR c.notes ILIKE $1`;
    params.push(`%${search.trim()}%`);
  }

  sql += ` ORDER BY c.created_at DESC`;

  const { rows } = await query<CustomerRecord>(sql, params);
  return rows;
}

export async function getCustomerById(customerId: string): Promise<CustomerRecord | null> {
  const { rows } = await query<CustomerRecord>(
    `
    SELECT 
      c.id, c.name, c.notes, c.created_at, c.updated_at,
      l.id as license_id, l.code_display as activation_code, l.status,
      l.activated_at, l.expires_at,
      t.telegram_user_id
    FROM customers c
    LEFT JOIN licenses l ON l.customer_id = c.id
    LEFT JOIN telegram_accounts t ON t.customer_id = c.id
    WHERE c.id = $1
  `,
    [customerId]
  );

  return rows[0] || null;
}

export async function updateCustomer(customerId: string, name: string, notes?: string): Promise<boolean> {
  const { rowCount } = await query(
    'UPDATE customers SET name = $1, notes = $2, updated_at = NOW() WHERE id = $3',
    [name, notes || null, customerId]
  );
  return rowCount > 0;
}
