import 'server-only';
import { db } from '@/lib/db/client';
import { clinicSettings, faqs, tenants, treatments } from '@/lib/db/schema';
import { SEED_FAQS, SEED_TREATMENTS } from '@/lib/seed-data';
import { eq } from 'drizzle-orm';

const DEFAULT_RECORDING_CONSENT =
  'Esta llamada se está grabando para mejorar la calidad del servicio. Si no querés que se grabe, podés colgar y nuestra recepción te llamará de vuelta.';

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}+/gu, '') // strip combining diacritics
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || `tenant-${Date.now()}`
  );
}

// Crea (idempotente) el tenant + clinic_settings + seeds para una organización
// de Clerk. Es la MISMA lógica que corre el webhook `organization.created`
// (ver app/api/webhooks/clerk/route.ts → handleOrgCreated), extraída acá para
// poder reutilizarla en auto-provisión on-demand cuando el webhook no corrió
// (org creada antes del webhook, webhook mal configurado, o cutover de
// instancia de Clerk sin re-setear el endpoint). Devuelve el id del tenant.
export async function ensureTenantForOrg(input: {
  clerkOrgId: string;
  name: string;
  slug: string | null;
}): Promise<{ id: string }> {
  const existing = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.clerkOrganizationId, input.clerkOrgId))
    .limit(1);
  if (existing[0]) return existing[0];

  const slug = input.slug ?? slugify(input.name);

  const inserted = await db
    .insert(tenants)
    .values({
      name: input.name,
      slug,
      clerkOrganizationId: input.clerkOrgId,
      plan: 'starter',
      status: 'trial',
    })
    // clerk_organization_id es UNIQUE → si dos requests concurrentes provisionan
    // a la vez, uno gana y el otro no rompe.
    .onConflictDoNothing({ target: tenants.clerkOrganizationId })
    .returning({ id: tenants.id });

  const tenant = inserted[0];
  if (!tenant) {
    // Perdimos la carrera: el tenant ya lo creó otro request. Re-seleccionar.
    const again = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.clerkOrganizationId, input.clerkOrgId))
      .limit(1);
    if (again[0]) return again[0];
    throw new Error('no se pudo provisionar el tenant');
  }

  // Defaults sensatos + auto-seed (8 tratamientos + 7 FAQs) para que el
  // dashboard arranque vivo. Solo en creación fresca del tenant.
  await db.insert(clinicSettings).values({
    tenantId: tenant.id,
    timezone: 'America/Mexico_City',
    defaultLanguage: 'es',
    recordingConsentText: DEFAULT_RECORDING_CONSENT,
    workingHours: {
      monday: { open: '09:00', close: '19:00' },
      tuesday: { open: '09:00', close: '19:00' },
      wednesday: { open: '09:00', close: '19:00' },
      thursday: { open: '09:00', close: '19:00' },
      friday: { open: '09:00', close: '19:00' },
      saturday: { open: '10:00', close: '14:00' },
      sunday: null,
    },
  });

  await db
    .insert(treatments)
    .values(SEED_TREATMENTS.map((t) => ({ tenantId: tenant.id, ...t, currency: 'EUR' })));
  await db.insert(faqs).values(SEED_FAQS.map((f) => ({ tenantId: tenant.id, ...f })));

  return tenant;
}
