import { NextRequest, NextResponse } from 'next/server';
import { getCookieOptions, SESSION_COOKIE_NAME } from '@/lib/security/auth';

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ success: true, message: 'Logged out successfully' });
  const options = getCookieOptions(req);
  res.cookies.set(SESSION_COOKIE_NAME, '', {
    ...options,
    maxAge: 0,
  });
  return res;
}
