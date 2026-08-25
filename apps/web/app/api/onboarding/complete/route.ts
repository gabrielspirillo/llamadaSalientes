import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema';
import { buildSummary, notifyInternalTeam } from '@/lib/onboarding/notify';
import { persistOnboarding } from '@/lib/onboarding/persist';
import { payloadSchema } from '@/lib/onboarding/schema';
import { getCurrentTenant } from '@/lib/tenant';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Endpoint AUTENTICADO del onboarding. Lo consume el wizard cuando la clínica
 * ya tiene sesión (flujo: registro → onboarding → dashboard). Guarda sobre el
 * tenant de la sesión — no hay tenant/key en la URL, la identidad la da Clerk.
 *
 * Al terminar marca la clínica como `status: 'pending'` (pendiente de activar
 * por un admin) y adopta el nombre cargado en el wizard.
 */
export async function POST(req: NextRequest) {
  let tenantId: string;
  try {
    const { tenant } = await getCurrentTenant();
    tenantId = tenant.id;
  } catch {
    return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Datos inválidos.', issues: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    await persistOnboarding(tenantId, parsed.data);

    // Clínica lista para revisión: pendiente de activar. Adoptamos el nombre
    // que cargó la clínica en el wizard como nombre del tenant.
    await db
      .update(tenants)
      .set({ status: 'pending', name: parsed.data.clinic.name })
      .where(eq(tenants.id, tenantId));

    const summary = buildSummary(parsed.data);
    await notifyInternalTeam(summary);

    return NextResponse.json({
      ok: true,
      message: `¡Listo! Recibimos los datos de ${parsed.data.clinic.name}.`,
      summary,
    });
  } catch (err) {
    console.error('[onboarding/complete] error:', err);
    return NextResponse.json(
      { error: 'No pudimos guardar el onboarding. Reintentá en un momento.' },
      { status: 500 },
    );
  }
}
