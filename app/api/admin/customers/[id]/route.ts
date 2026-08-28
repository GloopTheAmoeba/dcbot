import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAccess } from '@/lib/security/auth';
import { getCustomerById, updateCustomer } from '@/lib/db/repositories/customer';
import { getCustomerGuilds } from '@/lib/db/repositories/discord';
import { getLicenseEvents } from '@/lib/db/repositories/event-log';
import { logger } from '@/lib/logger';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const isAuthorized = await verifyAdminAccess(req);
  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const customer = await getCustomerById(id);
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const guilds = await getCustomerGuilds(id);
    const events = customer.license_id ? await getLicenseEvents(customer.license_id) : [];

    return NextResponse.json({
      customer,
      guilds,
      events,
    });
  } catch (err) {
    logger.error('Error fetching customer details', err, { customerId: id });
    return NextResponse.json({ error: 'Failed to retrieve customer details' }, { status: 500 });
  }
}

export async function PUT(
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
    const { name, notes } = body;

    if (!name || name.trim() === '') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const updated = await updateCustomer(id, name.trim(), notes);
    if (!updated) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('Error updating customer', err, { customerId: id });
    return NextResponse.json({ error: 'Failed to update customer' }, { status: 500 });
  }
}
