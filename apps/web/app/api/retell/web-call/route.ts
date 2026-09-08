import { denyUnlessRole } from '@/lib/auth/api-guard';
import { resolveRetellAgentId } from '@/lib/data/agent-config';
import { getRetellClient } from '@/lib/retell/client';
import { buildClinicContextVars } from '@/lib/retell/clinic-context';
import { describeRetellError } from '@/lib/retell/errors';
import { getCurrentTenant } from '@/lib/tenant';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Crea una llamada web (browser → Retell SIP) para que el usuario logueado
 * pueda probar el agente en vivo desde el dashboard. Retorna el access_token
 * que el SDK del cliente usa para conectarse vía WebRTC.
 *
 * Sirve para los DOS sentidos, porque no son el mismo agente ni el mismo
 * prompt: el entrante atiende a quien llama a la clínica y el saliente llama
 * al paciente. Probar el entrante y dar por bueno el saliente era la forma
 * fácil de desplegar un agente saliente que nadie había oído nunca.
 */
const bodySchema = z.object({
  role: z.enum(['inbound', 'outbound']).default('inbound'),
  /** Con quién cree el agente que habla. Sólo lo usa el saliente. */
  patientName: z.string().trim().max(120).optional(),
});

export async function POST(req: NextRequest) {
  // Una llamada de prueba gasta minutos de Retell: no la lanza quien sólo mira.
  const denied = await denyUnlessRole('operator');
  if (denied) return denied;

  let tenantId: string;
  try {
    const ctx = await getCurrentTenant();
    tenantId = ctx.tenant.id;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // El body es opcional: sin él se prueba el entrante, que es como se
  // comportaba este endpoint antes de existir la pestaña de salientes.
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 });
  }
  const { role } = parsed.data;
  const patientName = parsed.data.patientName || 'paciente';

  const agentId = await resolveRetellAgentId(tenantId, role);
  if (!agentId) {
    return NextResponse.json(
      {
        error:
          role === 'outbound'
            ? 'No hay ningún agente de llamadas salientes configurado para esta clínica.'
            : 'No hay ningún agente de voz configurado para esta clínica. Ve a Asistente y guarda el Agent ID.',
      },
      { status: 400 },
    );
  }

  if (!process.env.RETELL_API_KEY) {
    return NextResponse.json({ error: 'RETELL_API_KEY no configurada' }, { status: 500 });
  }

  // Todo lo que sigue puede fallar por causas ajenas al código —la cuenta de
  // Retell sin crédito, un agente borrado desde su panel, la BD caída— y antes
  // esas excepciones subían sin capturar: el navegador recibía un 500 vacío y
  // en pantalla solo se leía "Error 500". Quien lleva la clínica no puede
  // actuar sobre eso.
  try {
    const clinicVars = await buildClinicContextVars(tenantId);
    const retell = getRetellClient();

    const webCall = await retell.call.createWebCall({
      agent_id: agentId,
      metadata: {
        tenant_id: tenantId,
        source: 'dashboard-test',
        direction: role,
      },
      retell_llm_dynamic_variables: {
        ...clinicVars,
        patient_name: patientName,
        current_date: new Date().toISOString().slice(0, 10),
        direction: role,
        lead_source: 'dashboard-test',
        // El prompt saliente se apoya en el motivo de la llamada; sin esto el
        // agente arranca sin saber a qué llama y se inventa uno.
        ...(role === 'outbound'
          ? { use_case: 'prueba', campaign_name: 'Prueba desde el panel' }
          : {}),
      },
    });

    return NextResponse.json({
      accessToken: webCall.access_token,
      callId: webCall.call_id,
      agentId,
    });
  } catch (err) {
    const { status, message, detail } = describeRetellError(err);
    console.error('[retell:web-call] fallo al crear la llamada de prueba', {
      tenantId,
      agentId,
      role,
      status,
      detail,
    });
    return NextResponse.json({ error: message }, { status });
  }
}
