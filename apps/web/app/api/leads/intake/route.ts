import { triggerCallback } from '@/lib/calls/trigger-callback';
import { verifyIntakeKey } from '@/lib/auth/intake-key';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  phone: z.string().min(7),
  name: z.string().optional(),
  email: z.string().email().optional(),
  source: z.string().optional(),
});

/**
 * Endpoint público para que formularios externos / landing pages disparen
 * un callback inmediato cuando un lead deja su número.
 *
 * Auth:
 *   - Header: Authorization: Bearer <intake_key>
 *   - O query: ?key=<intake_key>
 *   - intake_key = HMAC-SHA256("intake:{tenantId}", ENCRYPTION_KEY).hex
 *   - El tenant_id se identifica por tenant slug en la URL (path param).
 *
 * Ejemplo desde un form:
 *   POST /api/leads/intake?tenant=clinica-dental-nobel
 *   Authorization: Bearer abc123...
 *   { "phone": "+34900000000", "name": "Juan Pérez", "email": "...", "source": "landing-web" }
 */
export async function POST(req: NextRequest) {
  const tenantSlug = req.nextUrl.searchParams.get('tenant');
  if (!tenantSlug) {
    return NextResponse.json(
      { error: 'Falta query param "tenant" (slug de la clínica)' },
      { status: 400 },
    );
  }

  const [tenant] = await db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.slug, tenantSlug))
    .limit(1);

  if (!tenant) {
    return NextResponse.json({ error: 'Clínica no encontrada' }, { status: 404 });
  }

  const auth = req.headers.get('authorization') ?? '';
  const fromHeader = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const fromQuery = req.nextUrl.searchParams.get('key');
  const providedKey = fromHeader ?? fromQuery;

  if (!verifyIntakeKey(tenant.id, providedKey)) {
    return NextResponse.json({ error: 'Intake key inválida' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const result = await triggerCallback({
    tenantId: tenant.id,
    toNumber: parsed.data.phone,
    patientName: parsed.data.name ?? null,
    email: parsed.data.email ?? null,
    source: parsed.data.source ?? 'lead_intake',
  });

  if (!result.ok) {
    const status =
      result.reason === 'invalid_input' ? 422 : 400;
    return NextResponse.json({ error: result.error, reason: result.reason }, { status });
  }

  return NextResponse.json({
    ok: true,
    callId: result.callId,
    status: result.status,
    contactId: result.contactId,
  });
}
