import { normalizePatientPhone } from '@/lib/agenda/patients';
import { denyUnlessRole } from '@/lib/auth/api-guard';
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
  // Un correo mal escrito en una fila del CSV no puede tumbar la campaña entera.
  email: z.string().email().optional().nullable().catch(null),
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
    const denied = await denyUnlessRole('operator');
    if (denied) return denied;
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
    const denied = await denyUnlessRole('admin');
    if (denied) return denied;
    const { tenant, userId: clerkUserId } = await getCurrentTenant();
    tenantId = tenant.id;
    userId = clerkUserId;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Revisa los datos de la campaña.', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  // Teléfonos normalizados (un móvil sin prefijo es español), sin inválidos
  // ni repetidos: llamar dos veces al mismo paciente es lo peor que puede hacer.
  const seen = new Set<string>();
  const targets: typeof parsed.data.targets = [];
  for (const t of parsed.data.targets) {
    const toNumber = normalizePatientPhone(t.toNumber);
    if (!toNumber || seen.has(toNumber)) continue;
    seen.add(toNumber);
    targets.push({ ...t, toNumber });
  }
  if (targets.length === 0) {
    return NextResponse.json({ error: 'Ningún teléfono de la lista es válido.' }, { status: 422 });
  }
  const skipped = parsed.data.targets.length - targets.length;

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
    targets,
  });

  return NextResponse.json({ ...result, skipped }, { status: 201 });
}
