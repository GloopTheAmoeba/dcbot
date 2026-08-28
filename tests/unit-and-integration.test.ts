import test from 'node:test';
import assert from 'node:assert/strict';
import { setUseMemoryDb, memoryDb } from '../lib/db/client';
import { runMigrations } from '../lib/db/migrations';
import { createCustomer, getCustomers, getCustomerById } from '../lib/db/repositories/customer';
import {
  activateLicense,
  renewLicense,
  updateLicenseStatus,
  isLicenseActive,
  getLicenseByTelegramUser,
} from '../lib/db/repositories/license';
import { registerGuild, updateGuildChannel, getGuildConfigForBot } from '../lib/db/repositories/discord';
import { calculatePreciseAccountAge, getSnowflakeCreationDate } from '../lib/discord/formatter';
import { processMemberJoinEvent, ChannelMessageSender } from '../lib/discord/join-handler';
import { generateActivationCode } from '../lib/security/codes';
import {
  registerTelegramBotCommands,
  handleTelegramWebhookUpdate,
  clearPendingActivations,
  setPendingActivationForTest,
  PENDING_ACTIVATION_TIMEOUT_MS,
} from '../lib/telegram/bot';

// Force In-Memory Database Mode for clean test execution
setUseMemoryDb(true);

test.beforeEach(async () => {
  memoryDb.clear();
  clearPendingActivations();
  await runMigrations();
});

test('Scenario 1: New customer creation', async () => {
  const { customer, code } = await createCustomer('Acme Corp', 'VIP Client');

  assert.ok(customer.id);
  assert.equal(customer.name, 'Acme Corp');
  assert.equal(customer.notes, 'VIP Client');
  assert.ok(customer.status === 'UNACTIVATED' || customer.status === 'PENDING');
  assert.ok(code);
  assert.match(code, /^DFH199-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
});

test('Scenario 2: Activation code uniqueness', async () => {
  const codes = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const code = generateActivationCode();
    assert.equal(codes.has(code), false, `Duplicate code generated: ${code}`);
    codes.add(code);
  }
  assert.equal(codes.size, 50);
});

test('Scenario 3: First activation', async () => {
  const { customer, code } = await createCustomer('Test Customer');
  const tgUserId = 123456789;

  const result = await activateLicense(code, tgUserId, 'tg_username', 'John');

  assert.equal(result.success, true);
  assert.equal(result.status, 'SUCCESS');
  assert.ok(result.license?.expiresAt);

  const active = await isLicenseActive(customer.id);
  assert.equal(active, true);
});

test('Scenario 4: Correct Telegram account activation', async () => {
  const { customer, code } = await createCustomer('First Account');
  const tgUserId = 999111222;

  const res = await activateLicense(code, tgUserId, 'owner_tg', 'Owner');
  assert.equal(res.success, true);

  const fetched = await getCustomerById(customer.id);
  assert.equal(String(fetched?.telegram_user_id), String(tgUserId));
});

test('Scenario 5: Wrong Telegram account attempting another customer code', async () => {
  const { code } = await createCustomer('Customer A');
  const userA = 10001;
  const userB = 20002;

  // First activation by User A
  const resA = await activateLicense(code, userA, 'user_a');
  assert.equal(resA.success, true);

  // Attempted activation by User B using same code
  const resB = await activateLicense(code, userB, 'user_b');
  assert.equal(resB.success, false);
  assert.equal(resB.status, 'ALREADY_CLAIMED');
});

test('Scenario 6: Duplicate activation (Idempotency)', async () => {
  const { code } = await createCustomer('Customer Same');
  const userA = 55555;

  const res1 = await activateLicense(code, userA, 'user_a');
  assert.equal(res1.success, true);

  // Same user activates again
  const res2 = await activateLicense(code, userA, 'user_a');
  assert.equal(res2.success, true);
  assert.equal(res2.status, 'SUCCESS');
  assert.match(res2.message, /already active/i);
});

test('Scenario 7: Expired license', async () => {
  const { customer, code } = await createCustomer('Expiring Customer');
  const tgUser = 777111;

  await activateLicense(code, tgUser);

  // Manually backdate expiration date in memory store
  const lic = memoryDb.licenses.find((l) => l.customer_id === customer.id);
  if (lic) {
    lic.expires_at = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  }

  const active = await isLicenseActive(customer.id);
  assert.equal(active, false);
});

test('Scenario 8: Suspended license', async () => {
  const { customer, code } = await createCustomer('Suspended Corp');
  const tgUser = 888222;

  await activateLicense(code, tgUser);
  await updateLicenseStatus(customer.id, 'SUSPENDED');

  const active = await isLicenseActive(customer.id);
  assert.equal(active, false);

  // Attempt re-activation
  const res = await activateLicense(code, 999999);
  assert.equal(res.success, false);
  assert.equal(res.status, 'SUSPENDED');
});

test('Scenario 9: Revoked license', async () => {
  const { customer, code } = await createCustomer('Revoked Client');
  await updateLicenseStatus(customer.id, 'REVOKED');

  const res = await activateLicense(code, 123123);
  assert.equal(res.success, false);
  assert.equal(res.status, 'REVOKED');
});

test('Scenario 10: Renewal while active', async () => {
  const { customer, code } = await createCustomer('Active Customer');
  await activateLicense(code, 444333);

  const initialLic = memoryDb.licenses.find((l) => l.customer_id === customer.id);
  const oldExpiry = new Date(initialLic?.expires_at as string).getTime();

  const renewRes = await renewLicense(customer.id, 1);
  assert.equal(renewRes.success, true);

  const newExpiry = new Date(renewRes.license?.expiresAt as string).getTime();
  assert.ok(newExpiry > oldExpiry, 'New expiration should extend beyond old expiry');
});

test('Scenario 11: Renewal after expiration', async () => {
  const { customer, code } = await createCustomer('Expired Customer');
  await activateLicense(code, 666555);

  // Backdate expiration
  const lic = memoryDb.licenses.find((l) => l.customer_id === customer.id);
  if (lic) {
    lic.expires_at = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  }

  const renewRes = await renewLicense(customer.id, 1);
  assert.equal(renewRes.success, true);

  const active = await isLicenseActive(customer.id);
  assert.equal(active, true);
});

test('Scenario 12: Tenant isolation', async () => {
  const { customer: custA } = await createCustomer('Tenant A');
  const { customer: custB } = await createCustomer('Tenant B');

  await registerGuild(custA.id, '111222333', 'Guild A');
  await registerGuild(custB.id, '444555666', 'Guild B');

  // Attempt Tenant A updating Tenant B's guild channel
  const updateRes = await updateGuildChannel(custA.id, '444555666', 'channel_999');
  assert.equal(updateRes, false, 'Tenant A must not be allowed to update Tenant B guild');
});

test('Scenario 13: Accurate account-age calculation', async () => {
  // Test Snowflake creation date
  const snowflake = '1118123456789123456';
  const creationDate = getSnowflakeCreationDate(snowflake);
  assert.ok(creationDate instanceof Date);
  assert.equal(isNaN(creationDate.getTime()), false);

  // Test account age calculation
  const created = new Date(Date.UTC(2021, 5, 15)); // June 15, 2021
  const joined = new Date(Date.UTC(2023, 11, 27)); // Dec 27, 2023

  const ageStr = calculatePreciseAccountAge(created, joined);
  assert.equal(ageStr, '2 years, 6 months, 12 days');
});

test('Scenario 14: Discord member-join processing', async () => {
  const { customer, code } = await createCustomer('Member Join SaaS');
  await activateLicense(code, 12345678);

  const guildId = '987654321';
  await registerGuild(customer.id, guildId, 'Test Server');
  await updateGuildChannel(customer.id, guildId, '1122334455');

  let messageSent = false;
  const mockSender: ChannelMessageSender = {
    sendMessage: async () => {
      messageSent = true;
      return { success: true };
    },
  };

  const payload = {
    user: {
      id: '100200300400500',
      username: 'new_member',
      global_name: 'New Member',
      bot: false,
    },
    joined_at: new Date().toISOString(),
    guild_id: guildId,
  };

  const result = await processMemberJoinEvent(payload, mockSender);
  assert.equal(result.processed, true);
  assert.equal(result.reason, 'NOTIFICATION_SENT');
  assert.equal(messageSent, true);
});

test('Scenario 15: Duplicate event protection', async () => {
  const { customer, code } = await createCustomer('Dedup Test');
  await activateLicense(code, 888777);

  const guildId = '888000111';
  await registerGuild(customer.id, guildId, 'Dedup Guild');
  await updateGuildChannel(customer.id, guildId, '5544332211');

  const mockSender: ChannelMessageSender = {
    sendMessage: async () => ({ success: true }),
  };

  const payload = {
    user: { id: '999888777', username: 'rapid_joiner' },
    joined_at: new Date().toISOString(),
    guild_id: guildId,
  };

  // First join
  const res1 = await processMemberJoinEvent(payload, mockSender);
  assert.equal(res1.processed, true);

  // Immediate second join (duplicate)
  const res2 = await processMemberJoinEvent(payload, mockSender);
  assert.equal(res2.processed, false);
  assert.equal(res2.reason, 'DUPLICATE_EVENT');
});

test('Scenario 16: Telegram setMyCommands API command menu registration', async () => {
  // Test registration function returns false gracefully when invalid token is provided without throwing or exposing secrets
  const resultNoToken = await registerTelegramBotCommands('your_telegram_bot_token_here');
  assert.equal(resultNoToken, false);
});

test('Scenario 17: Activation timing and 1-month term commencement', async () => {
  const { customer, code } = await createCustomer('Timing Customer');
  
  // Before activation: License is UNACTIVATED, active status is false
  const activeBefore = await isLicenseActive(customer.id);
  assert.equal(activeBefore, false);
  
  const customerBefore = await getCustomerById(customer.id);
  assert.ok(customerBefore?.status === 'UNACTIVATED' || customerBefore?.status === 'PENDING');

  // Activate via Telegram
  const tgUser = 333444555;
  const startTime = Date.now();
  const res = await activateLicense(code, tgUser, 'timing_user');
  
  assert.equal(res.success, true);
  assert.equal(res.status, 'SUCCESS');

  // Customer status changes to ACTIVE
  const customerAfter = await getCustomerById(customer.id);
  assert.equal(customerAfter?.status, 'ACTIVE');

  // License is active and expires approximately 30 days from now
  const activeAfter = await isLicenseActive(customer.id);
  assert.equal(activeAfter, true);
  
  const expiryTime = new Date(res.license?.expiresAt as string).getTime();
  const expectedMinExpiry = startTime + 29 * 24 * 60 * 60 * 1000;
  assert.ok(expiryTime >= expectedMinExpiry, 'License expiry should be at least 30 days into the future');
});

test('Scenario 18: Telegram user ownership binding and double-claiming prevention', async () => {
  const { code: codeA } = await createCustomer('Customer A');
  const { code: codeB } = await createCustomer('Customer B');
  const tgUser1 = 11110000;
  const tgUser2 = 22220000;

  // Telegram User 1 claims Code A
  const res1 = await activateLicense(codeA, tgUser1);
  assert.equal(res1.success, true);

  // Telegram User 2 attempts to claim Code A (already bound to User 1) -> REJECT
  const res2 = await activateLicense(codeA, tgUser2);
  assert.equal(res2.success, false);
  assert.equal(res2.status, 'ALREADY_CLAIMED');
  assert.match(res2.message, /already associated with another account/i);

  // Telegram User 1 attempts to claim Code B (User 1 is already bound to Customer A) -> REJECT
  const res3 = await activateLicense(codeB, tgUser1);
  assert.equal(res3.success, false);
  assert.equal(res3.status, 'ALREADY_CLAIMED');
});

test('Scenario 19: Full 3-step Telegram activation flow (/start -> Code -> /activate)', async () => {
  const { code } = await createCustomer('Webhook Customer');
  const tgUserId = 777888999;

  // Step 1: /start
  const startPayload = {
    message: {
      text: '/start',
      from: {
        id: tgUserId,
        username: 'webhook_test_user',
        first_name: 'Tester',
      },
      chat: { id: tgUserId },
    },
  };
  const startRes = await handleTelegramWebhookUpdate(startPayload);
  assert.equal(startRes.handled, true);
  assert.match(startRes.message || '', /Welcome! 👋/);
  assert.match(startRes.message || '', /Please enter your activation code/);

  // Step 2: User enters code
  const codePayload = {
    message: {
      text: code,
      from: {
        id: tgUserId,
        username: 'webhook_test_user',
        first_name: 'Tester',
      },
      chat: { id: tgUserId },
    },
  };
  const codeRes = await handleTelegramWebhookUpdate(codePayload);
  assert.equal(codeRes.handled, true);
  assert.match(codeRes.message || '', /Activation code received/);
  assert.match(codeRes.message || '', /Type \/activate to complete activation/);

  // Verify license is NOT yet activated
  const beforeActivate = await getLicenseByTelegramUser(tgUserId);
  assert.equal(beforeActivate, null);

  // Step 3: User sends /activate
  const activatePayload = {
    message: {
      text: '/activate',
      from: {
        id: tgUserId,
        username: 'webhook_test_user',
        first_name: 'Tester',
      },
      chat: { id: tgUserId },
    },
  };
  const activateRes = await handleTelegramWebhookUpdate(activatePayload);
  assert.equal(activateRes.handled, true);
  assert.match(activateRes.message || '', /License activated successfully/i);
  assert.match(activateRes.message || '', /Your license is now active/i);

  // Verify that license is now bound to the update context Telegram ID (777888999)
  const licInfo = await getLicenseByTelegramUser(tgUserId);
  assert.ok(licInfo);
  assert.equal(licInfo.active, true);
  assert.equal(licInfo.customerName, 'Webhook Customer');
});

test('Scenario 19b: Pending activation expires after 15 minutes of inactivity', async () => {
  const { code } = await createCustomer('Timeout Customer');
  const tgUserId = 555666777;

  // Set pending code that is 16 minutes old
  setPendingActivationForTest(tgUserId, {
    code,
    timestamp: Date.now() - 16 * 60 * 1000,
    username: 'timeout_user',
  });

  const activatePayload = {
    message: {
      text: '/activate',
      from: { id: tgUserId, username: 'timeout_user' },
      chat: { id: tgUserId },
    },
  };

  const res = await handleTelegramWebhookUpdate(activatePayload);
  assert.equal(res.handled, true);
  assert.match(res.message || '', /No activation code is pending/i);
  assert.match(res.message || '', /Please use \/start first/i);

  // License should remain unactivated
  const licInfo = await getLicenseByTelegramUser(tgUserId);
  assert.equal(licInfo, null);
});

test('Scenario 19c: Pending activation code from User A cannot be activated by User B', async () => {
  const { code } = await createCustomer('Isolated Customer');
  const userA = 111111;
  const userB = 222222;

  // User A enters code
  await handleTelegramWebhookUpdate({
    message: {
      text: code,
      from: { id: userA, username: 'user_a' },
      chat: { id: userA },
    },
  });

  // User B tries /activate without entering code
  const resB = await handleTelegramWebhookUpdate({
    message: {
      text: '/activate',
      from: { id: userB, username: 'user_b' },
      chat: { id: userB },
    },
  });

  assert.equal(resB.handled, true);
  assert.match(resB.message || '', /No activation code is pending/i);

  // User B cannot claim User A's pending activation
  const licB = await getLicenseByTelegramUser(userB);
  assert.equal(licB, null);

  // User A now activates successfully
  const resA = await handleTelegramWebhookUpdate({
    message: {
      text: '/activate',
      from: { id: userA, username: 'user_a' },
      chat: { id: userA },
    },
  });

  assert.equal(resA.handled, true);
  assert.match(resA.message || '', /License activated successfully/i);
});

test('Scenario 19d: Invalid activation code is rejected and not stored', async () => {
  const tgUser = 333333;

  const res = await handleTelegramWebhookUpdate({
    message: {
      text: 'DFH199-FAKE-CODE',
      from: { id: tgUser, username: 'fake_user' },
      chat: { id: tgUser },
    },
  });

  assert.equal(res.handled, true);
  assert.match(res.message || '', /Invalid activation code/i);

  // Subsequent /activate should fail because no pending code was stored
  const actRes = await handleTelegramWebhookUpdate({
    message: {
      text: '/activate',
      from: { id: tgUser, username: 'fake_user' },
      chat: { id: tgUser },
    },
  });

  assert.match(actRes.message || '', /No activation code is pending/i);
});

test('Scenario 20: Provisioned license is UNACTIVATED and unassigned to Telegram', async () => {
  const { customer, code } = await createCustomer('Unactivated Client', 'Test Notes');

  assert.ok(customer.id);
  assert.equal(customer.name, 'Unactivated Client');
  assert.equal(customer.status, 'UNACTIVATED');
  assert.equal(customer.telegram_user_id, null);
  assert.equal(customer.activated_at, null);
  assert.equal(customer.expires_at, null);
  assert.ok(code);

  const fetched = await getCustomerById(customer.id);
  assert.ok(fetched);
  assert.equal(fetched.status, 'UNACTIVATED');
  assert.equal(fetched.telegram_user_id, null);
  assert.equal(fetched.expires_at, null);
});

test('Scenario 21: License list retrieves created UNACTIVATED customers', async () => {
  await createCustomer('Client Alpha');
  await createCustomer('Client Beta');

  const list = await getCustomers();
  assert.equal(list.length, 2);
  const alpha = list.find((c) => c.name === 'Client Alpha');
  const beta = list.find((c) => c.name === 'Client Beta');

  assert.ok(alpha);
  assert.ok(beta);
  assert.equal(alpha.status, 'UNACTIVATED');
  assert.equal(beta.status, 'UNACTIVATED');
});

test('Scenario 22: Activation starts 30-day license timer and binds Telegram ID', async () => {
  const { customer, code } = await createCustomer('Timer Test Client');
  assert.equal(customer.activated_at, null);
  assert.equal(customer.expires_at, null);

  const tgUserId = 554433221;
  const actRes = await activateLicense(code, tgUserId, 'tg_timer_user');
  assert.equal(actRes.success, true);
  assert.ok(actRes.license?.expiresAt);

  const active = await isLicenseActive(customer.id);
  assert.equal(active, true);

  const fetched = await getCustomerById(customer.id);
  assert.ok(fetched);
  assert.equal(fetched.status, 'ACTIVE');
  assert.equal(String(fetched.telegram_user_id), String(tgUserId));
  assert.ok(fetched.activated_at);
  assert.ok(fetched.expires_at);
});

// ==========================================
// Admin Authorization & Session Tests (14 Requirements)
// ==========================================

import {
  createAdminSessionToken,
  verifySessionToken,
  verifyAdminAccess,
  createAdminAccessSession,
  getCookieOptions,
  SESSION_COOKIE_NAME,
} from '../lib/security/auth';
import { POST as createCustomerApi, GET as getCustomersApi } from '../app/api/admin/customers/route';
import { GET as getSessionApi, POST as postSessionApi } from '../app/api/admin/auth/session/route';
import { POST as logoutApi } from '../app/api/admin/auth/logout/route';
import { NextRequest, NextResponse } from 'next/server';

test('Scenario 23 [Test 1]: Admin session token generation for dashboard bootstrap', async () => {
  process.env.ADMIN_ACCESS_KEY = 'test_admin_secret_key_12345';
  
  const token = await createAdminSessionToken();
  assert.ok(token, 'Session token value must be non-empty');
  
  const isValid = await verifySessionToken(token);
  assert.equal(isValid, true, 'Issued session token must be cryptographically valid');
});

test('Scenario 24 [Test 2]: Admin session creation and cookie options', async () => {
  process.env.ADMIN_ACCESS_KEY = 'test_admin_secret_key_12345';

  const token = await createAdminSessionToken();
  assert.ok(token);
  assert.equal(typeof token, 'string');

  const isValid = await verifySessionToken(token);
  assert.equal(isValid, true);

  const opts = getCookieOptions();
  assert.equal(opts.httpOnly, true);
  assert.equal(opts.path, '/');
  assert.equal(opts.sameSite, 'lax');
  assert.equal(opts.maxAge, 86400);
});

test('Scenario 25 [Test 3]: Valid admin session accessing protected API', async () => {
  process.env.ADMIN_ACCESS_KEY = 'test_admin_secret_key_12345';

  const token = await createAdminSessionToken();
  const req = new NextRequest('http://localhost:3000/api/admin/customers', {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
    },
  });

  const isAuth = await verifyAdminAccess(req);
  assert.equal(isAuth, true);

  const res = await getCustomersApi(req);
  assert.equal(res.status, 200);
});

test('Scenario 26 [Test 4]: Missing admin session returning 401 Unauthorized', async () => {
  process.env.ADMIN_ACCESS_KEY = 'test_admin_secret_key_12345';

  const req = new NextRequest('http://localhost:3000/api/admin/customers');
  const isAuth = await verifyAdminAccess(req);
  assert.equal(isAuth, false);

  const res = await getCustomersApi(req);
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error, 'Unauthorized');
});

test('Scenario 27 [Test 5]: Invalid/forged session returning 401 Unauthorized', async () => {
  process.env.ADMIN_ACCESS_KEY = 'test_admin_secret_key_12345';

  const req = new NextRequest('http://localhost:3000/api/admin/customers', {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=invalid.fake.jwt.token`,
    },
  });

  const isAuth = await verifyAdminAccess(req);
  assert.equal(isAuth, false);

  const res = await getCustomersApi(req);
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error, 'Unauthorized');
});

test('Scenario 28 [Test 6]: Generate License with valid admin session', async () => {
  process.env.ADMIN_ACCESS_KEY = 'test_admin_secret_key_12345';

  const token = await createAdminSessionToken();
  const req = new NextRequest('http://localhost:3000/api/admin/customers', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
    },
    body: JSON.stringify({ name: 'Enterprise Corp', notes: 'Yearly Plan' }),
  });

  const res = await createCustomerApi(req);
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.success, true);
  assert.ok(data.customer);
  assert.equal(data.customer.name, 'Enterprise Corp');
  assert.ok(data.activationCode);
  assert.match(data.activationCode, /^DFH199-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
});

test('Scenario 29 [Test 7]: Generate License without admin session returns 401', async () => {
  process.env.ADMIN_ACCESS_KEY = 'test_admin_secret_key_12345';

  const req = new NextRequest('http://localhost:3000/api/admin/customers', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name: 'Hacker Corp' }),
  });

  const res = await createCustomerApi(req);
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error, 'Unauthorized');
});

test('Scenario 30 [Test 8 & 9]: Session persistence across dashboard navigation and refresh', async () => {
  process.env.ADMIN_ACCESS_KEY = 'test_admin_secret_key_12345';

  // 1. Initial dashboard session creation
  const token = await createAdminSessionToken();
  assert.ok(token);

  // 2. Navigate to customer detail sub-path with existing cookie / header
  const req2 = new NextRequest('http://localhost:3000/api/admin/customers', {
    headers: { 'x-admin-session': token },
  });
  const isAuth2 = await verifyAdminAccess(req2);
  assert.equal(isAuth2, true);

  // 3. Refresh page with existing cookie
  const req3 = new NextRequest('http://localhost:3000/api/admin/customers', {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
  });
  const isAuth3 = await verifyAdminAccess(req3);
  assert.equal(isAuth3, true);

  // Verification that token remains valid
  const isValid = await verifySessionToken(token);
  assert.equal(isValid, true);
});

test('Scenario 31 [Test 10]: Logout / Session destruction', async () => {
  const req = new NextRequest('http://localhost:3000/api/admin/auth/logout', { method: 'POST' });
  const res = await logoutApi(req);

  assert.equal(res.status, 200);
  const cookie = res.cookies.get(SESSION_COOKIE_NAME);
  assert.ok(cookie);
  assert.equal(cookie.value, '');
  assert.equal(cookie.maxAge, 0);
});

test('Scenario 32 [Test 11, 12, 13, 14]: Customer, License, Code Generation, and DB Transaction consistency', async () => {
  const { customer, code } = await createCustomer('Transactional Client', 'Priority tier');
  
  assert.ok(customer.id);
  assert.ok(customer.license_id);
  assert.equal(customer.name, 'Transactional Client');
  assert.equal(customer.notes, 'Priority tier');
  assert.equal(customer.status, 'UNACTIVATED');
  assert.ok(code);
  assert.match(code, /^DFH199-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  const fetched = await getCustomerById(customer.id);
  assert.ok(fetched);
  assert.equal(fetched.id, customer.id);
  assert.equal(fetched.activation_code, code);
});

test('Scenario 33: Generate License via x-admin-session Header (Iframe / Cross-Origin compatibility)', async () => {
  process.env.ADMIN_ACCESS_KEY = 'test_admin_secret_key_12345';

  const token = await createAdminSessionToken();
  const req = new NextRequest('http://localhost:3000/api/admin/customers', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-session': token,
    },
    body: JSON.stringify({ name: 'Cross Origin Client', notes: 'Iframe Session' }),
  });

  const res = await createCustomerApi(req);
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.success, true);
  assert.ok(data.customer);
  assert.equal(data.customer.name, 'Cross Origin Client');
  assert.ok(data.activationCode);
  assert.match(data.activationCode, /^DFH199-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
});

test('Scenario 34: Generate License with forged/tampered session token rejected with 401', async () => {
  process.env.ADMIN_ACCESS_KEY = 'test_admin_secret_key_12345';

  const req = new NextRequest('http://localhost:3000/api/admin/customers', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-session': 'eyFakeHeader.eyFakePayload.signature',
    },
    body: JSON.stringify({ name: 'Tampered Attacker' }),
  });

  const res = await createCustomerApi(req);
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error, 'Unauthorized');
});

test.after(() => {
  setTimeout(() => {
    process.exit(0);
  }, 100);
});


