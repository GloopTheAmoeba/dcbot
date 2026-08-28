import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAccess } from '@/lib/security/auth';
import { getRecentBotEvents } from '@/lib/db/repositories/event-log';
import { logger } from '@/lib/logger';

export async function GET(req: NextRequest) {
  const isAuthorized = await verifyAdminAccess(req);
  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const guildId = searchParams.get('guildId') || undefined;

    const events = await getRecentBotEvents(limit, guildId);
    return NextResponse.json({ events });
  } catch (err) {
    logger.error('Error fetching bot logs', err);
    return NextResponse.json({ error: 'Failed to retrieve logs' }, { status: 500 });
  }
}
