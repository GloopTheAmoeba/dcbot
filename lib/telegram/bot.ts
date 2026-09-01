import { Bot, Context } from 'grammy';
import { activateLicense, getLicenseByTelegramUser, verifyCodeEligibility } from '../db/repositories/license';
import { logger } from '../logger';

export interface PendingActivation {
  code: string;
  timestamp: number;
  username?: string;
  firstName?: string;
}

// In-memory pending activations tied to Telegram User ID
const pendingActivations = new Map<number, PendingActivation>();
const awaitingCodeUsers = new Map<number, number>();

// 15 minutes expiration for pending activation attempts
export const PENDING_ACTIVATION_TIMEOUT_MS = 15 * 60 * 1000;

export function clearPendingActivations(): void {
  pendingActivations.clear();
  awaitingCodeUsers.clear();
}

export function getPendingActivation(userId: number): PendingActivation | undefined {
  const pending = pendingActivations.get(userId);
  if (!pending) return undefined;
  if (Date.now() - pending.timestamp > PENDING_ACTIVATION_TIMEOUT_MS) {
    pendingActivations.delete(userId);
    return undefined;
  }
  return pending;
}

export function setPendingActivationForTest(userId: number, pending: PendingActivation): void {
  pendingActivations.set(userId, pending);
}

let telegramBot: Bot | null = null;
let webhookRegistered = false;

/**
 * Register official Bot API commands with Telegram using setMyCommands
 */
export async function registerTelegramBotCommands(botToken?: string): Promise<boolean> {
  const token = botToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'your_telegram_bot_token_here' || token.startsWith('mock') || token === 'test_token') {
    logger.warn('TELEGRAM_BOT_TOKEN not provided. Skipping Telegram setMyCommands registration.');
    return false;
  }

  const commands = [
    { command: 'start', description: 'Begin activation' },
    { command: 'activate', description: 'Complete activation after entering your code' },
    { command: 'status', description: 'Check your license status' },
    { command: 'help', description: 'Show help' },
  ];

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const url = `https://api.telegram.org/bot${token}/setMyCommands`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands,
        scope: { type: 'all_private_chats' },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await response.json();
    if (data.ok) {
      logger.info('Successfully registered Telegram bot commands with all_private_chats scope');
      return true;
    } else {
      logger.error('Failed to set Telegram commands via Bot API', {
        description: data.description,
        error_code: data.error_code,
      });
      return false;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error('Error during Telegram setMyCommands request', { error: errMsg });
    return false;
  }
}

/**
 * Register Telegram Webhook using official Telegram setWebhook Bot API method.
 * Constructs URL safely from APP_URL env variable.
 * Idempotent: safe to run multiple times without duplicating or failing.
 */
export async function registerTelegramWebhook(): Promise<{ success: boolean; message: string; webhookUrl?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'your_telegram_bot_token_here' || token.startsWith('mock') || token === 'test_token') {
    logger.warn('TELEGRAM_BOT_TOKEN not configured. Skipping webhook registration.');
    return { success: false, message: 'TELEGRAM_BOT_TOKEN not configured' };
  }

  const baseUrl = process.env.APP_URL;
  if (!baseUrl || baseUrl.includes('localhost') || baseUrl === 'your_app_url_here') {
    logger.warn('APP_URL is not configured or set to localhost. Webhook registration requires a public HTTPS URL.');
    return { success: false, message: 'Public APP_URL required for Webhook registration' };
  }

  const cleanBase = baseUrl.replace(/\/+$/, '');
  const webhookUrl = `${cleanBase}/api/telegram/webhook`;
  const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;

  try {
    // 1. First register Bot commands
    await registerTelegramBotCommands(token);

    // 2. Call setWebhook via Telegram Bot API
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secretToken || undefined,
        allowed_updates: ['message'],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await response.json();
    if (data.ok) {
      webhookRegistered = true;
      logger.info('Telegram Webhook registered successfully', { webhookUrl });
      return { success: true, message: 'Webhook registered successfully', webhookUrl };
    } else {
      logger.error('Telegram setWebhook API error', { description: data.description, error_code: data.error_code });
      return { success: false, message: data.description || 'Webhook registration failed' };
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error('Error calling Telegram setWebhook', { error: errMsg });
    return { success: false, message: errMsg };
  }
}

/**
 * Diagnostic helper: fetch Webhook status from Telegram API without leaking bot token.
 */
export async function getTelegramWebhookInfo(): Promise<Record<string, unknown>> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'your_telegram_bot_token_here' || token.startsWith('mock') || token === 'test_token') {
    return { configured: false, reason: 'TELEGRAM_BOT_TOKEN missing or default' };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await response.json();
    if (data.ok) {
      return {
        configured: true,
        url: data.result.url || null,
        has_custom_certificate: data.result.has_custom_certificate,
        pending_update_count: data.result.pending_update_count,
        last_error_date: data.result.last_error_date ? new Date(data.result.last_error_date * 1000).toISOString() : null,
        last_error_message: data.result.last_error_message || null,
        max_connections: data.result.max_connections,
        allowed_update_types: data.result.allowed_updates || [],
      };
    }
    return { configured: false, reason: data.description };
  } catch (err) {
    return { configured: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Send reply message directly using Telegram Bot API sendMessage endpoint.
 */
async function sendTelegramMessage(chatId: number, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'your_telegram_bot_token_here' || token.startsWith('mock') || token === 'test_token') {
    return false;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await response.json();
    return Boolean(data.ok);
  } catch (err) {
    logger.error('Failed to send Telegram message via Bot API', { chatId, error: String(err) });
    return false;
  }
}

export function getTelegramBot(): Bot | null {
  if (telegramBot) return telegramBot;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'your_telegram_bot_token_here') {
    logger.warn('TELEGRAM_BOT_TOKEN not provided. Telegram bot running in webhook/direct dispatch mode.');
    return null;
  }

  // If APP_URL is present, production relies on Webhook mode - do NOT run long polling!
  const baseUrl = process.env.APP_URL;
  if (baseUrl && !baseUrl.includes('localhost')) {
    logger.info('APP_URL detected. Initializing Telegram in Webhook Mode (Polling disabled).');
    if (!webhookRegistered) {
      registerTelegramWebhook().catch((err) => {
        logger.error('Background webhook registration error', { error: String(err) });
      });
    }
    return null;
  }

  // Otherwise fallback to Polling mode for local dev
  telegramBot = new Bot(token);

  // Register commands with Telegram Bot API
  registerTelegramBotCommands(token).catch((err) => {
    logger.error('Failed to set Telegram commands', { error: err instanceof Error ? err.message : String(err) });
  });

  // Handle /start (Step 1)
  telegramBot.command('start', async (ctx: Context) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    logger.info('Telegram /start command received', { userId });
    awaitingCodeUsers.set(userId, Date.now());

    // Invalidate any expired pending state
    const pending = pendingActivations.get(userId);
    if (pending && Date.now() - pending.timestamp > PENDING_ACTIVATION_TIMEOUT_MS) {
      pendingActivations.delete(userId);
    }

    await ctx.reply(`Welcome! 👋\n\nPlease enter your activation code.`);
  });

  // Handle /help
  telegramBot.command('help', async (ctx: Context) => {
    await ctx.reply(
      `ℹ️ Available Commands:\n\n` +
      `/start\nBegin activation\n\n` +
      `/activate\nComplete activation after entering your code\n\n` +
      `/status\nCheck your license status\n\n` +
      `/help\nShow help`
    );
  });

  // Handle /status
  telegramBot.command('status', async (ctx: Context) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    logger.info('Telegram /status command received', { userId });
    const info = await getLicenseByTelegramUser(userId);

    if (!info) {
      await ctx.reply(`⚠️ No active license found for your Telegram account.\n\nUse /start to begin activation.`);
      return;
    }

    const expiryStr = info.expiresAt ? new Date(info.expiresAt).toISOString().split('T')[0] : 'N/A';
    if (info.active) {
      await ctx.reply(
        `✅ Subscription Active\n\n` +
        `Customer: ${info.customerName}\n` +
        `Status: ${info.status}\n` +
        `Expires: ${expiryStr}`
      );
    } else {
      await ctx.reply(
        `❌ Subscription Inactive\n\n` +
        `Customer: ${info.customerName}\n` +
        `Status: ${info.status}\n` +
        `Expires: ${expiryStr}`
      );
    }
  });

  // Handle /activate (Step 3)
  telegramBot.command('activate', async (ctx: Context) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const pending = pendingActivations.get(userId);

    if (!pending || Date.now() - pending.timestamp > PENDING_ACTIVATION_TIMEOUT_MS) {
      if (pending) pendingActivations.delete(userId);
      await ctx.reply(`❌ No activation code is pending.\n\nPlease use /start first and enter your activation code.`);
      return;
    }

    const tgUsername = ctx.from?.username || pending.username;
    const firstName = ctx.from?.first_name || pending.firstName;

    logger.info('Telegram /activate command executing', { userId, tgUsername });
    const result = await activateLicense(pending.code, userId, tgUsername, firstName);

    // Clear pending activation upon completion
    pendingActivations.delete(userId);

    await ctx.reply(result.message);
  });

  // Handle Text Messages (Step 2: Activation Code Input)
  telegramBot.on('message:text', async (ctx: Context) => {
    const userId = ctx.from?.id;
    const text = ctx.message?.text?.trim();

    if (!userId || !text || text.startsWith('/')) return;

    const cleanCode = text.replace(/[`'"]/g, '').trim();

    logger.info('Telegram activation code input received', { userId });

    const eligibility = await verifyCodeEligibility(cleanCode, userId);

    if (!eligibility.eligible) {
      await ctx.reply(eligibility.message);
      return;
    }

    // Associate pending activation attempt with Telegram user ID
    pendingActivations.set(userId, {
      code: cleanCode,
      timestamp: Date.now(),
      username: ctx.from?.username,
      firstName: ctx.from?.first_name,
    });
    awaitingCodeUsers.delete(userId);

    await ctx.reply(`Activation code received.\n\nType /activate to complete activation.`);
  });

  return telegramBot;
}

/**
 * Handle direct update payload from Telegram Webhook API
 */
export async function handleTelegramWebhookUpdate(update: Record<string, unknown>): Promise<{ handled: boolean; message?: string }> {
  const message = update.message as {
    text?: string;
    from?: { id: number; username?: string; first_name?: string };
    chat?: { id: number };
  } | undefined;

  if (!message || !message.from || !message.text) {
    return { handled: false, message: 'Invalid Telegram payload' };
  }

  // Telegram User ID is extracted DIRECTLY from the official Telegram update payload context
  const userId = message.from.id;
  const chatId = message.chat?.id || userId;
  const text = message.text.trim();
  const username = message.from.username;
  const firstName = message.from.first_name;

  let responseMessage = '';

  // Step 1: /start
  if (text === '/start') {
    awaitingCodeUsers.set(userId, Date.now());
    const pending = pendingActivations.get(userId);
    if (pending && Date.now() - pending.timestamp > PENDING_ACTIVATION_TIMEOUT_MS) {
      pendingActivations.delete(userId);
    }
    responseMessage = `Welcome! 👋\n\nPlease enter your activation code.`;
  }
  // Help command
  else if (text === '/help') {
    responseMessage =
      `ℹ️ Available Commands:\n\n` +
      `/start\nBegin activation\n\n` +
      `/activate\nComplete activation after entering your code\n\n` +
      `/status\nCheck your license status\n\n` +
      `/help\nShow help`;
  }
  // Status command
  else if (text === '/status') {
    const info = await getLicenseByTelegramUser(userId);
    if (!info) {
      responseMessage = `⚠️ No active license found for your Telegram account.\n\nUse /start to begin activation.`;
    } else {
      const expiryStr = info.expiresAt ? new Date(info.expiresAt).toISOString().split('T')[0] : 'N/A';
      if (info.active) {
        responseMessage =
          `✅ Subscription Active\n\n` +
          `Customer: ${info.customerName}\n` +
          `Status: ${info.status}\n` +
          `Expires: ${expiryStr}`;
      } else {
        responseMessage =
          `❌ Subscription Inactive\n\n` +
          `Customer: ${info.customerName}\n` +
          `Status: ${info.status}\n` +
          `Expires: ${expiryStr}`;
      }
    }
  }
  // Step 3: /activate
  else if (text === '/activate' || text.startsWith('/activate')) {
    const pending = pendingActivations.get(userId);

    if (!pending || Date.now() - pending.timestamp > PENDING_ACTIVATION_TIMEOUT_MS) {
      if (pending) pendingActivations.delete(userId);
      responseMessage = `❌ No activation code is pending.\n\nPlease use /start first and enter your activation code.`;
    } else {
      const tgUsername = username || pending.username;
      const tgFirstName = firstName || pending.firstName;

      const res = await activateLicense(pending.code, userId, tgUsername, tgFirstName);
      pendingActivations.delete(userId);
      responseMessage = res.message;
    }
  }
  // Step 2: Normal Text Message as Activation Code
  else {
    const cleanCode = text.replace(/[`'"]/g, '').trim();
    const eligibility = await verifyCodeEligibility(cleanCode, userId);

    if (!eligibility.eligible) {
      responseMessage = eligibility.message;
    } else {
      pendingActivations.set(userId, {
        code: cleanCode,
        timestamp: Date.now(),
        username,
        firstName,
      });
      awaitingCodeUsers.delete(userId);
      responseMessage = `Activation code received.\n\nType /activate to complete activation.`;
    }
  }

  // Send message back to Telegram chat if valid chatId exists
  if (responseMessage && chatId) {
    await sendTelegramMessage(chatId, responseMessage);
  }

  return {
    handled: true,
    message: responseMessage,
  };
}
