import { query, transaction } from '../client';
import { hashActivationCode } from '../../security/codes';
import { logger } from '../../logger';

export interface LicenseActionResult {
  success: boolean;
  status: 'SUCCESS' | 'INVALID_CODE' | 'ALREADY_CLAIMED' | 'EXPIRED' | 'SUSPENDED' | 'REVOKED' | 'ERROR';
  message: string;
  license?: {
    id: string;
    customerId: string;
    status: string;
    expiresAt: string | null;
  };
}

export interface CodeEligibilityResult {
  eligible: boolean;
  status: 'VALID' | 'INVALID_CODE' | 'ALREADY_CLAIMED' | 'EXPIRED' | 'SUSPENDED' | 'REVOKED' | 'ALREADY_ACTIVE';
  message: string;
  expiresAt?: string | null;
  customerId?: string;
}

/**
 * Verify if an activation code is valid and eligible for pending activation.
 * Does NOT activate the license, does NOT associate Telegram ID, and does NOT start the timer.
 */
export async function verifyCodeEligibility(
  code: string,
  telegramUserId: number
): Promise<CodeEligibilityResult> {
  const trimmed = code.trim();
  if (!trimmed || trimmed.length < 4) {
    return {
      eligible: false,
      status: 'INVALID_CODE',
      message: '❌ Invalid activation code.\n\nPlease check the code and try again.',
    };
  }

  const codeHash = hashActivationCode(trimmed);

  const { rows: licRows } = await query(
    `SELECT id, customer_id, status, activated_at, expires_at FROM licenses WHERE code_hash = $1`,
    [codeHash]
  );

  if (licRows.length === 0) {
    return {
      eligible: false,
      status: 'INVALID_CODE',
      message: '❌ Invalid activation code.\n\nPlease check the code and try again.',
    };
  }

  const license = licRows[0] as {
    id: string;
    customer_id: string;
    status: string;
    activated_at: string | null;
    expires_at: string | null;
  };

  if (license.status === 'REVOKED') {
    return {
      eligible: false,
      status: 'REVOKED',
      message: '❌ This license has been revoked. Please contact support.',
    };
  }

  if (license.status === 'SUSPENDED') {
    return {
      eligible: false,
      status: 'SUSPENDED',
      message: '❌ This license is currently suspended. Please contact support.',
    };
  }

  // Check if claimed by another Telegram account
  const { rows: tgRows } = await query(
    `SELECT telegram_user_id, customer_id FROM telegram_accounts WHERE customer_id = $1`,
    [license.customer_id]
  );

  if (tgRows.length > 0) {
    const existingTg = tgRows[0] as { telegram_user_id: string | number; customer_id: string };
    if (String(existingTg.telegram_user_id) === String(telegramUserId)) {
      return {
        eligible: false,
        status: 'ALREADY_ACTIVE',
        message: `✅ Your license is already active.\n\nExpires:\n${
          license.expires_at ? new Date(license.expires_at).toISOString().split('T')[0] : 'N/A'
        }`,
        expiresAt: license.expires_at,
        customerId: license.customer_id,
      };
    }
    return {
      eligible: false,
      status: 'ALREADY_CLAIMED',
      message: '❌ This activation code is already associated with another account.',
    };
  }

  // Check if Telegram user is already bound to another customer license
  const { rows: userTgRows } = await query(
    `SELECT telegram_user_id, customer_id FROM telegram_accounts WHERE telegram_user_id = $1`,
    [telegramUserId]
  );

  if (userTgRows.length > 0) {
    const existingUserBound = userTgRows[0] as { telegram_user_id: string | number; customer_id: string };
    if (existingUserBound.customer_id !== license.customer_id) {
      return {
        eligible: false,
        status: 'ALREADY_CLAIMED',
        message: '❌ This activation code is already associated with another account.',
      };
    }
  }

  if (license.status === 'ACTIVE' && license.expires_at && new Date(license.expires_at) < new Date()) {
    return {
      eligible: false,
      status: 'EXPIRED',
      message: '❌ This activation code has expired.',
    };
  }

  return {
    eligible: true,
    status: 'VALID',
    message: 'Activation code received.\n\nType /activate to complete activation.',
    customerId: license.customer_id,
  };
}

/**
 * Activate a license code via Telegram User ID.
 * Enforces transactional row locking, idempotency, expiration checks, and multi-tenant constraints.
 */
export async function activateLicense(
  code: string,
  telegramUserId: number,
  telegramUsername?: string,
  firstName?: string
): Promise<LicenseActionResult> {
  const codeHash = hashActivationCode(code.trim());

  return transaction(async (client) => {
    // 1. Query License by Hash (FOR UPDATE for row lock)
    const { rows: licRows } = await client.query(
      `SELECT id, customer_id, status, activated_at, expires_at FROM licenses WHERE code_hash = $1 FOR UPDATE`,
      [codeHash]
    );

    if (licRows.length === 0) {
      return {
        success: false,
        status: 'INVALID_CODE',
        message: '❌ Invalid activation code.\n\nPlease check the code and try again.',
      };
    }

    const license = licRows[0] as {
      id: string;
      customer_id: string;
      status: string;
      activated_at: string | null;
      expires_at: string | null;
    };

    // 2. Check if license is Revoked or Suspended
    if (license.status === 'REVOKED') {
      await client.query(
        `INSERT INTO activation_events (license_id, telegram_user_id, status, reason) VALUES ($1, $2, $3, $4)`,
        [license.id, telegramUserId, 'REJECTED_REVOKED', 'License is revoked']
      );
      return {
        success: false,
        status: 'REVOKED',
        message: '❌ This license has been revoked. Please contact support.',
      };
    }

    if (license.status === 'SUSPENDED') {
      await client.query(
        `INSERT INTO activation_events (license_id, telegram_user_id, status, reason) VALUES ($1, $2, $3, $4)`,
        [license.id, telegramUserId, 'REJECTED_SUSPENDED', 'License is suspended']
      );
      return {
        success: false,
        status: 'SUSPENDED',
        message: '❌ This license is currently suspended. Please contact support.',
      };
    }

    // 3. Check existing Telegram account association for this Customer (FOR UPDATE)
    const { rows: tgRows } = await client.query(
      `SELECT telegram_user_id, customer_id FROM telegram_accounts WHERE customer_id = $1 FOR UPDATE`,
      [license.customer_id]
    );

    if (tgRows.length > 0) {
      const existingTg = tgRows[0] as { telegram_user_id: string | number; customer_id: string };
      
      // Idempotency check: Same Telegram user activating their own code again
      if (String(existingTg.telegram_user_id) === String(telegramUserId)) {
        const expStr = license.expires_at ? new Date(license.expires_at).toISOString().split('T')[0] : 'N/A';
        return {
          success: true,
          status: 'SUCCESS',
          message: `✅ Your license is already active.\n\nExpires:\n${expStr}`,
          license: {
            id: license.id,
            customerId: license.customer_id,
            status: license.status,
            expiresAt: license.expires_at,
          },
        };
      }

      // Rejection: Code already claimed by a DIFFERENT Telegram account
      await client.query(
        `INSERT INTO activation_events (license_id, telegram_user_id, status, reason) VALUES ($1, $2, $3, $4)`,
        [license.id, telegramUserId, 'REJECTED_ALREADY_USED', 'Claimed by another Telegram account']
      );
      return {
        success: false,
        status: 'ALREADY_CLAIMED',
        message: '❌ This activation code is already associated with another account.',
      };
    }

    // Check if Telegram user is already bound to another customer license (FOR UPDATE)
    const { rows: userTgRows } = await client.query(
      `SELECT telegram_user_id, customer_id FROM telegram_accounts WHERE telegram_user_id = $1 FOR UPDATE`,
      [telegramUserId]
    );

    if (userTgRows.length > 0) {
      const existingUserBound = userTgRows[0] as { telegram_user_id: string | number; customer_id: string };
      if (existingUserBound.customer_id !== license.customer_id) {
        await client.query(
          `INSERT INTO activation_events (license_id, telegram_user_id, status, reason) VALUES ($1, $2, $3, $4)`,
          [license.id, telegramUserId, 'REJECTED_ALREADY_USED', 'Telegram user already bound to another customer license']
        );
        return {
          success: false,
          status: 'ALREADY_CLAIMED',
          message: '❌ This activation code is already associated with another account.',
        };
      }
    }

    // 4. Check if license is already EXPIRED before activation (if status is ACTIVE)
    if (license.status === 'ACTIVE' && license.expires_at && new Date(license.expires_at) < new Date()) {
      await client.query(
        `INSERT INTO activation_events (license_id, telegram_user_id, status, reason) VALUES ($1, $2, $3, $4)`,
        [license.id, telegramUserId, 'REJECTED_EXPIRED', 'License is expired']
      );
      return {
        success: false,
        status: 'EXPIRED',
        message: '❌ This activation code has expired.',
      };
    }

    // 5. Successful New Activation (PENDING -> ACTIVE)
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 1 Month (30 days UTC)
    const expFormatted = expiresAt.toISOString().split('T')[0];

    // Associate Telegram Account
    await client.query(
      `INSERT INTO telegram_accounts (telegram_user_id, username, first_name, customer_id) VALUES ($1, $2, $3, $4)`,
      [telegramUserId, telegramUsername || null, firstName || null, license.customer_id]
    );

    // Update Customer Status to ACTIVE
    await client.query(
      `UPDATE customers SET status = 'ACTIVE', updated_at = $1 WHERE id = $2`,
      [now.toISOString(), license.customer_id]
    );

    // Update License
    await client.query(
      `UPDATE licenses SET status = $1, activated_at = $2, expires_at = $3, updated_at = $2 WHERE id = $4`,
      ['ACTIVE', now.toISOString(), expiresAt.toISOString(), license.id]
    );

    // Record Activation Event
    await client.query(
      `INSERT INTO activation_events (license_id, telegram_user_id, status, reason) VALUES ($1, $2, $3, $4)`,
      [license.id, telegramUserId, 'SUCCESS', 'Activated successfully via Telegram']
    );

    // Record License Event
    await client.query(
      `INSERT INTO license_events (license_id, event_type, details) VALUES ($1, $2, $3)`,
      [license.id, 'ACTIVATED', JSON.stringify({ telegram_user_id: telegramUserId, expires_at: expiresAt.toISOString() })]
    );

    logger.info('License activated successfully', { licenseId: license.id, telegramUserId });

    return {
      success: true,
      status: 'SUCCESS',
      message: `✅ License activated successfully!\n\nYour license is now active.\n\nExpires:\n${expFormatted}`,
      license: {
        id: license.id,
        customerId: license.customer_id,
        status: 'ACTIVE',
        expiresAt: expiresAt.toISOString(),
      },
    };
  });
}

/**
 * Renew License by 1 Month
 */
export async function renewLicense(customerId: string, months: number = 1): Promise<LicenseActionResult> {
  const { rows } = await query(
    `SELECT id, status, expires_at FROM licenses WHERE customer_id = $1`,
    [customerId]
  );

  if (rows.length === 0) {
    return {
      success: false,
      status: 'INVALID_CODE',
      message: 'No license found for customer.',
    };
  }

  const license = rows[0] as { id: string; status: string; expires_at: string | null };
  const now = new Date();
  let baseDate = now;

  // If active and not expired, extend from existing expiry date
  if (license.expires_at && new Date(license.expires_at) > now) {
    baseDate = new Date(license.expires_at);
  }

  const newExpiresAt = new Date(baseDate.getTime() + months * 30 * 24 * 60 * 60 * 1000);

  await query(
    `UPDATE licenses SET status = 'ACTIVE', expires_at = $1, updated_at = NOW() WHERE id = $2`,
    [newExpiresAt.toISOString(), license.id]
  );

  await query(
    `INSERT INTO license_events (license_id, event_type, details) VALUES ($1, $2, $3)`,
    [license.id, 'RENEWED', JSON.stringify({ extended_months: months, new_expires_at: newExpiresAt.toISOString() })]
  );

  logger.info('License renewed by admin', { customerId, newExpiresAt: newExpiresAt.toISOString() });

  return {
    success: true,
    status: 'SUCCESS',
    message: `License extended until ${newExpiresAt.toISOString().split('T')[0]}.`,
    license: {
      id: license.id,
      customerId,
      status: 'ACTIVE',
      expiresAt: newExpiresAt.toISOString(),
    },
  };
}

/**
 * Update License Status (SUSPENDED, REACTIVATED, REVOKED)
 */
export async function updateLicenseStatus(
  customerId: string,
  newStatus: 'SUSPENDED' | 'ACTIVE' | 'REVOKED'
): Promise<boolean> {
  const { rows } = await query(`SELECT id FROM licenses WHERE customer_id = $1`, [customerId]);
  if (rows.length === 0) return false;

  const licenseId = rows[0].id as string;

  await query(`UPDATE licenses SET status = $1, updated_at = NOW() WHERE id = $2`, [newStatus, licenseId]);

  await query(
    `INSERT INTO license_events (license_id, event_type, details) VALUES ($1, $2, $3)`,
    [licenseId, newStatus === 'ACTIVE' ? 'REACTIVATED' : newStatus, JSON.stringify({ status: newStatus })]
  );

  logger.info('License status updated', { customerId, newStatus });
  return true;
}

/**
 * Check if customer license is valid and active at current UTC time.
 */
export async function isLicenseActive(customerId: string): Promise<boolean> {
  const { rows } = await query(
    `SELECT status, expires_at FROM licenses WHERE customer_id = $1`,
    [customerId]
  );

  if (rows.length === 0) return false;

  const license = rows[0] as { status: string; expires_at: string | null };
  if (license.status !== 'ACTIVE') return false;
  if (!license.expires_at) return false;

  return new Date(license.expires_at) > new Date();
}

/**
 * Check license state by Telegram User ID
 */
export async function getLicenseByTelegramUser(telegramUserId: number): Promise<{
  active: boolean;
  status: string;
  expiresAt: string | null;
  customerName: string | null;
} | null> {
  const { rows } = await query(
    `
    SELECT l.status, l.expires_at, c.name as customer_name
    FROM telegram_accounts t
    JOIN licenses l ON l.customer_id = t.customer_id
    JOIN customers c ON c.id = t.customer_id
    WHERE t.telegram_user_id = $1
  `,
    [telegramUserId]
  );

  if (rows.length === 0) return null;

  const row = rows[0] as { status: string; expires_at: string | null; customer_name: string };
  const isActive = row.status === 'ACTIVE' && Boolean(row.expires_at) && new Date(row.expires_at!) > new Date();

  return {
    active: isActive,
    status: isActive ? 'ACTIVE' : row.status === 'ACTIVE' ? 'EXPIRED' : row.status,
    expiresAt: row.expires_at,
    customerName: row.customer_name,
  };
}
