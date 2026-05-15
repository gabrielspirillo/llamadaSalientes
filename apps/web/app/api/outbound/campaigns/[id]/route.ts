import { getCampaign, getCampaignTargets } from '@/lib/data/outbound-campaigns';
import { getCurrentTenant } from '@/lib/tenant';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let tenantId: string;
  try {
    const { tenant } = await getCurrentTenant();
    tenantId = tenant.id;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const campaign = await getCampaign(tenantId, id);
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const targets = await getCampaignTargets(tenantId, id);
  return NextResponse.json({ campaign, targets });
}
