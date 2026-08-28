import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAccess } from '@/lib/security/auth';
import { renewLicense } from '@/lib/db/repositories/license';
import { logger } from '@/lib/logger';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const isAuthorized = await verifyAdminAccess(req);
  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const result = await renewLicense(id, 1);
    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    logger.info('Customer license renewed via Admin Dashboard', { customerId: id });
    return NextResponse.json(result);
  } catch (err) {
    logger.error('Error renewing license', err, { customerId: id });
    return NextResponse.json({ error: 'Failed to renew license' }, { status: 500 });
  }
}
