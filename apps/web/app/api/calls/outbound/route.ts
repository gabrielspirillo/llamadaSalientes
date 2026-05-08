import { getCurrentTenant } from '@/lib/tenant';
import { getRetellClient } from '@/lib/retell/client';
import { db } from '@/lib/db/client';
import { agentConfigs, phoneNumbers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  toNumber: z.string().min(7, 'Número de destino requerido'),
  patientName: z.string().optional(),
  ghlContactId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let tenantId: string;
  try {
    const { tenant } = await getCurrentTenant();
    tenantId = tenant.id;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }
  const { toNumber, patientName, ghlContactId } = parsed.data;

  // Buscar número activo del tenant
  const [phone] = await db
    .select()
    .from(phoneNumbers)
    .where(eq(phoneNumbers.tenantId, tenantId))
    .limit(1);

  if (!phone) {
    return NextResponse.json({ error: 'No hay número de teléfono configurado para este tenant' }, { status: 400 });
  }

  // Buscar agente configurado del tenant
  const [agentConfig] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.tenantId, tenantId))
    .limit(1);

  if (!agentConfig?.retellAgentId) {
    return NextResponse.json({ error: 'No hay agente Retell configurado para este tenant' }, { status: 400 });
  }

  const retell = getRetellClient();

  // metadata.tenant_id es lo que el webhook/tools usan para identificar al tenant
  const call = await retell.call.createPhoneCall({
    from_number: phone.e164,
    to_number: toNumber,
    override_agent_id: agentConfig.retellAgentId,
    metadata: {
      tenant_id: tenantId,
      patient_name: patientName ?? null,
      ghl_contact_id: ghlContactId ?? null,
    },
  });

  return NextResponse.json({ callId: call.call_id, status: call.call_status });
}
