import { NextRequest, NextResponse } from 'next/server';
import { handleTelegramWebhookUpdate, registerTelegramWebhook } from '@/lib/telegram/bot';
import { logger } from '@/lib/logger';

let initialRegistrationTriggered = false;

export async function POST(req: NextRequest) {
  // Optional Webhook Secret Token Verification
  const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secretToken) {
    const incomingSecret = req.headers.get('x-telegram-bot-api-secret-token');
    if (incomingSecret !== secretToken) {
      logger.warn('Unauthorized Telegram webhook attempt - secret token mismatch');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Auto-trigger idempotent registration once on initial webhook ping if not yet done
  if (!initialRegistrationTriggered && process.env.APP_URL) {
    initialRegistrationTriggered = true;
    registerTelegramWebhook().catch((err) => {
      logger.error('Error during automatic webhook registration trigger', err);
    });
  }

  try {
    const update = await req.json();
    logger.info('Telegram webhook update received');

    const result = await handleTelegramWebhookUpdate(update);
    return NextResponse.json(result);
  } catch (err) {
    logger.error('Error handling Telegram webhook payload', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
