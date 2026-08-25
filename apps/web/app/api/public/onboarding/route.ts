import { verifyOnboardingKey } from '@/lib/auth/onboarding-key';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema';
import { buildSummary, notifyInternalTeam } from '@/lib/onboarding/notify';
import { persistOnboarding } from '@/lib/onboarding/persist';
import { payloadSchema } from '@/lib/onboarding/schema';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Endpoint PÚBLICO del wizard de onboarding (sin login). Lo consume la página
 * /onboarding/clinica. Ya es público por middleware vía el matcher
 * `/api/public/(.*)` — no requiere tocar middleware.
 *
 * Identificación del tenant: query param `?tenant=<slug>` (mismo mecanismo que
 * /api/leads/intake). Autorización de escritura: onboarding key firmada en el
 * link (`?key=<key>`), verificada con lib/auth/onboarding-key. Para dev/demo
 * se puede desactivar seteando ONBOARDING_PUBLIC_NO_KEY=true.
 */
export async function POST(req: NextRequest) {
  const tenantSlug = req.nextUrl.searchParams.get('tenant');

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

  // Flujo por-clínica con key firmada, sobre una clínica que YA existe.
  // (El alta de clínicas nuevas es el flujo autenticado registro → onboarding.)
  if (!tenantSlug) {
    return NextResponse.json({ error: 'Falta el parámetro "tenant" en el link.' }, { status: 400 });
  }

  const [tenant] = await db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.slug, tenantSlug))
    .limit(1);

  if (!tenant) {
    return NextResponse.json({ error: 'Clínica no encontrada.' }, { status: 404 });
  }

  // Autorización: onboarding key firmada (salvo bypass explícito de dev/demo).
  const bypass = process.env.ONBOARDING_PUBLIC_NO_KEY === 'true';
  if (!bypass) {
    const providedKey = req.nextUrl.searchParams.get('key');
    if (!verifyOnboardingKey(tenant.id, providedKey)) {
      return NextResponse.json(
        { error: 'Este link de onboarding no es válido o expiró. Pedinos uno nuevo.' },
        { status: 401 },
      );
    }
  }

  // El slug del body debe coincidir con el de la URL (evita cargar a otra
  // clínica por accidente).
  if (parsed.data.tenant && parsed.data.tenant !== tenantSlug) {
    return NextResponse.json(
      { error: 'El identificador de la clínica no coincide con el link.' },
      { status: 400 },
    );
  }

  const tenantId = tenant.id;

  try {
    // 1. Persistir reusando los servicios existentes.
    await persistOnboarding(tenantId, parsed.data);

    // 2. Aviso interno (stub — punto de integración preparado).
    const summary = buildSummary(parsed.data);
    await notifyInternalTeam(summary);

    // 3. Confirmación a la clínica.
    return NextResponse.json({
      ok: true,
      message: `¡Listo! Recibimos los datos de ${parsed.data.clinic.name}.`,
      summary,
    });
  } catch (err) {
    console.error('[onboarding] error persistiendo onboarding:', err);
    return NextResponse.json(
      {
        error:
          'No pudimos guardar el onboarding. Tus datos no se perdieron: reintentá en un momento.',
      },
      { status: 500 },
    );
  }
}
