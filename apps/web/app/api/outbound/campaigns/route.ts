import { USE_CASES, createCampaignWithTargets, listCampaigns } from '@/lib/data/outbound-campaigns';
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const targetSchema = z.object({
  toNumber: z.string().min(7),
  patientName: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  ghlContactId: z.string().optional().nullable(),
  dynamicVars: z.record(z.string()).optional(),
});

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  useCase: z.enum(USE_CASES),
  fromPhoneId: z.string().uuid().optional().nullable(),
  scheduledAt: z.string().datetime().optional().nullable(),
  callWindow: z
    .object({
      startMinutes: z.number().int().min(0).max(1440),
      endMinutes: z.number().int().min(0).max(1440),
      timezone: z.string(),
    })
    .optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  retryDelayMinutes: z.number().int().min(5).max(720).optional(),
  sharedDynamicVars: z.record(z.string()).optional(),
  notes: z.string().optional().nullable(),
  targets: z.array(targetSchema).min(1).max(5000),
});

export async function GET() {
  let tenantId: string;
  try {
    const { tenant } = await getCurrentTenant();
    tenantId = tenant.id;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const campaigns = await listCampaigns(tenantId);
  return NextResponse.json({ campaigns });
}

export async function POST(req: NextRequest) {
  let tenantId: string;
  let userId: string;
  try {
    const { tenant, userId: clerkUserId } = await getCurrentTenant();
    tenantId = tenant.id;
    userId = clerkUserId;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  // Resolver user.id local (UUID) desde el clerkUserId
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkUserId, userId))
    .limit(1);

  const result = await createCampaignWithTargets({
    tenantId,
    createdBy: user?.id ?? null,
    name: parsed.data.name,
    useCase: parsed.data.useCase,
    fromPhoneId: parsed.data.fromPhoneId ?? null,
    scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
    callWindowStart: parsed.data.callWindow?.startMinutes ?? null,
    callWindowEnd: parsed.data.callWindow?.endMinutes ?? null,
    timezone: parsed.data.callWindow?.timezone ?? null,
    maxRetries: parsed.data.maxRetries ?? 0,
    retryDelayMinutes: parsed.data.retryDelayMinutes ?? 60,
    sharedDynamicVars: parsed.data.sharedDynamicVars ?? {},
    notes: parsed.data.notes ?? null,
    targets: parsed.data.targets,
  });

  return NextResponse.json(result, { status: 201 });
}
