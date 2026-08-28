import { NextResponse } from 'next/server';
import { query, isUsingMemoryDb } from '@/lib/db/client';
import { runMigrations } from '@/lib/db/migrations';

export async function GET() {
  try {
    await runMigrations();
    const { rows } = await query('SELECT 1 as alive');
    const dbReady = rows.length > 0;

    return NextResponse.json({
      ready: dbReady,
      mode: isUsingMemoryDb() ? 'memory' : 'postgres',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { ready: false, error: String(err) },
      { status: 503 }
    );
  }
}
