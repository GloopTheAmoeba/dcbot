import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAccess } from '@/lib/security/auth';
import { registerGuild, updateGuildChannel } from '@/lib/repositories/discord';
import { logger } from '@/lib/logger';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const isAuthorized = await verifyAdminAccess(req);
  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: customerId } = await params;

  try {
    const body = await req.json();
    const { action, guildId, guildName, channelId, enabled } = body;

    if (action === 'register') {
      if (!guildId || !guildName) {
        return NextResponse.json({ error: 'guildId and guildName are required' }, { status: 400 });
      }

      const res = await registerGuild(customerId, guildId.trim(), guildName.trim());
      if (!res.success) {
        return NextResponse.json({ error: res.message }, { status: 400 });
      }

      return NextResponse.json(res);
    }

    if (action === 'updateChannel') {
      if (!guildId) {
        return NextResponse.json({ error: 'guildId is required' }, { status: 400 });
      }

      const updated = await updateGuildChannel(
        customerId,
        guildId,
        channelId ? channelId.trim() : null,
        enabled !== false
      );

      if (!updated) {
        return NextResponse.json({ error: 'Guild not found or tenant ownership mismatch' }, { status: 403 });
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action parameter' }, { status: 400 });
  } catch (err) {
    logger.error('Error managing customer guilds', err, { customerId });
    return NextResponse.json({ error: 'Failed to update guild' }, { status: 500 });
  }
}
