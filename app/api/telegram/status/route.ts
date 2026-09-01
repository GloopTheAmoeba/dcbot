import { NextRequest, NextResponse } from 'next/server';
import { getTelegramWebhookInfo, registerTelegramWebhook } from '@/lib/telegram/bot';
import { verifyAdminAccess } from '@/lib/security/auth';
import { logger } from '@/lib/logger';

export async function GET(req: NextRequest) {
  try {
    const info = await getTelegramWebhookInfo();
    return NextResponse.json({
      success: true,
      webhook: info,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Error retrieving Telegram webhook status', err);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // Require admin session/key to manually trigger registration endpoint
  const isAuthorized = await verifyAdminAccess(req);
  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await registerTelegramWebhook();
    return NextResponse.json({
      success: result.success,
      message: result.message,
      webhookUrl: result.webhookUrl,
    });
  } catch (err) {
    logger.error('Error triggering Telegram webhook registration', err);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
