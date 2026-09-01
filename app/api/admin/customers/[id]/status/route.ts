import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAccess } from '@/lib/security/auth';
import { updateLicenseStatus } from '@/lib/repositories/license';
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
    const body = await req.json();
    const { status } = body;

    if (!['SUSPENDED', 'ACTIVE', 'REVOKED'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status parameter' }, { status: 400 });
    }

    const updated = await updateLicenseStatus(id, status);
    if (!updated) {
      return NextResponse.json({ error: 'License not found' }, { status: 404 });
    }

    logger.info(`Customer license status set to ${status}`, { customerId: id });
    return NextResponse.json({ success: true, status });
  } catch (err) {
    logger.error('Error updating license status', err, { customerId: id });
    return NextResponse.json({ error: 'Failed to update license status' }, { status: 500 });
  }
}
