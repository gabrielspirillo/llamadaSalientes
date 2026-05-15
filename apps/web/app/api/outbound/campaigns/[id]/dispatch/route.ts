import { getCampaign } from '@/lib/data/outbound-campaigns';
import { dispatchCampaign } from '@/lib/outbound/dispatch-batch';
import { getCurrentTenant } from '@/lib/tenant';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  const result = await dispatchCampaign(tenantId, campaign);
  if (!result.ok) {
    const status = result.reason === 'no_targets' ? 422 : 400;
    return NextResponse.json({ error: result.error, reason: result.reason }, { status });
  }

  return NextResponse.json({
    batchCallId: result.batchCallId,
    taskCount: result.taskCount,
  });
}
