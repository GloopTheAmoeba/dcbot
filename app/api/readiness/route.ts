import { NextResponse } from 'next/server';
import { query, isUsingMemoryDb } from '@/lib/db/client';
import { runMigrations } from '@/lib/db/migrations';
import { registerTelegramWebhook } from '@/lib/telegram/bot';

export async function GET() {
  try {
    await runMigrations();
    const { rows } = await query('SELECT 1 as alive');
    const dbReady = rows.length > 0;

    // Trigger background webhook registration if APP_URL is present
    if (process.env.APP_URL && !process.env.APP_URL.includes('localhost')) {
      registerTelegramWebhook().catch(() => {});
    }

    return NextResponse.json({
      ready: dbReady,
      mode: isUsingMemoryDb() ? 'memory' : 'postgres',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { ready: false, error: 'Readiness check failed' },
      { status: 503 }
    );
  }
}
