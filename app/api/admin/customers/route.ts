import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAccess } from '@/lib/security/auth';
import { createCustomer, getCustomers } from '@/lib/db/repositories/customer';
import { logger } from '@/lib/logger';

export async function GET(req: NextRequest) {
  if (!(await verifyAdminAccess(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || undefined;

    const customers = await getCustomers(search);
    return NextResponse.json({ customers });
  } catch (err) {
    logger.error('Error listing customers', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await verifyAdminAccess(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, notes } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Customer name is required' }, { status: 400 });
    }

    const { customer, code } = await createCustomer(name.trim(), notes?.trim());

    return NextResponse.json({
      success: true,
      customer,
      activationCode: code,
    });
  } catch (err) {
    logger.error('Error creating customer', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
