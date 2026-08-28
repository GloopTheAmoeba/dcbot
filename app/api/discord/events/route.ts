import { NextRequest, NextResponse } from 'next/server';
import { processMemberJoinEvent, ChannelMessageSender } from '@/lib/discord/join-handler';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    if (!payload.guild_id || !payload.user?.id) {
      return NextResponse.json({ error: 'Invalid Discord event payload' }, { status: 400 });
    }

    logger.info('Discord event API endpoint called', { guildId: payload.guild_id, userId: payload.user.id });

    // Mock/HTTP channel sender for test & webhook compatibility
    const sender: ChannelMessageSender = {
      sendMessage: async (channelId, embed) => {
        logger.info(`Sending Discord Embed to channel ${channelId}`, { title: embed.title });
        return { success: true };
      },
    };

    const result = await processMemberJoinEvent(payload, sender);
    return NextResponse.json(result);
  } catch (err) {
    logger.error('Error processing Discord event endpoint', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
