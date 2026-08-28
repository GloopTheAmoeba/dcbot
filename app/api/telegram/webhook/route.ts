import { NextRequest, NextResponse } from 'next/server';
import { handleTelegramWebhookUpdate } from '@/lib/telegram/bot';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
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
