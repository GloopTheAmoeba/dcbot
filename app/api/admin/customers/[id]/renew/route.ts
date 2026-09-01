import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAccess } from '@/lib/security/auth';
import { renewLicense } from '@/lib/repositories/license';
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
    const body = await req.json().catch(() => ({}));
    const months = typeof body.months === 'number' && body.months > 0 ? body.months : 1;

    const result = await renewLicense(customerId, months);

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, license: result.license });
  } catch (err) {
    logger.error('Error renewing customer license', err, { customerId });
    return NextResponse.json({ error: 'Failed to renew license' }, { status: 500 });
  }
}
