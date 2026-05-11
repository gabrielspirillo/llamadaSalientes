import { resolveRetellAgentId } from '@/lib/data/agent-config';
import { getRetellClient } from '@/lib/retell/client';
import { getCurrentTenant } from '@/lib/tenant';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Crea una llamada web (browser → Retell SIP) para que el usuario logueado
 * pueda probar el agente en vivo desde el dashboard. Retorna el access_token
 * que el SDK del cliente usa para conectarse vía WebRTC.
 *
 * Pasa dynamic variables al prompt para que `{{clinic_name}}`, `{{current_date}}`,
 * `{{direction}}`, `{{patient_name}}` queden sustituidos también en pruebas.
 */
export async function POST(_req: NextRequest) {
  let tenantId: string;
  let tenantName = 'la clínica';
  try {
    const ctx = await getCurrentTenant();
    tenantId = ctx.tenant.id;
    tenantName = ctx.tenant.name;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const agentId = await resolveRetellAgentId(tenantId);
  if (!agentId) {
    return NextResponse.json(
      {
        error:
          'No hay agente Retell configurado para este tenant. Andá a /dashboard/agent y guardá el Agent ID.',
      },
      { status: 400 },
    );
  }

  if (!process.env.RETELL_API_KEY) {
    return NextResponse.json({ error: 'RETELL_API_KEY no configurada' }, { status: 500 });
  }

  // Si el tenant.name es un nombre auto-generado de Clerk (e.g., "Gabriel's
  // Organization"), usamos "Futura Solutions" como marca por defecto.
  const clinicName = /['']s organization|^test|^demo/i.test(tenantName)
    ? 'Futura Solutions'
    : tenantName;

  const retell = getRetellClient();

  const webCall = await retell.call.createWebCall({
    agent_id: agentId,
    metadata: {
      tenant_id: tenantId,
      source: 'dashboard-test',
      direction: 'inbound',
    },
    retell_llm_dynamic_variables: {
      clinic_name: clinicName,
      patient_name: 'paciente',
      current_date: new Date().toISOString().slice(0, 10),
      direction: 'inbound',
      lead_source: 'dashboard-test',
    },
  });

  return NextResponse.json({
    accessToken: webCall.access_token,
    callId: webCall.call_id,
    agentId,
  });
}
