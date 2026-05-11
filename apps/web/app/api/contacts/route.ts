import { listContacts } from '@/lib/ghl/contacts';
import { getCurrentTenant } from '@/lib/tenant';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  let tenantId: string;
  try {
    const ctx = await getCurrentTenant();
    tenantId = ctx.tenant.id;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get('q') ?? undefined;
  const page = Number(req.nextUrl.searchParams.get('page') ?? 1) || 1;
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 50) || 50, 100);

  const data = await listContacts(tenantId, { query: q, page, limit });
  return NextResponse.json(data);
}
