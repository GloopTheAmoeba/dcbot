import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAccess, createAdminAccessSession } from '@/lib/security/auth';

export async function GET(req: NextRequest) {
  const isAuthorized = await verifyAdminAccess(req);
  if (!isAuthorized) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({ authenticated: true });
}

export async function POST(req: NextRequest) {
  const isAuthorized = await verifyAdminAccess(req);
  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const res = NextResponse.json({ success: true, authenticated: true });
  await createAdminAccessSession(res, req);
  return res;
}
