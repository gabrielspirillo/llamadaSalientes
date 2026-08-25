import 'server-only';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema';
import { ensureTenantForOrg } from '@/lib/provision-tenant';
import { eq } from 'drizzle-orm';

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'clinica'
  );
}

/**
 * Crea una clínica "pendiente de activar" desde el wizard público de link único
 * (sin cuenta previa: la clínica solo pone su nombre y datos).
 *
 * Reusa `ensureTenantForOrg` (la misma lógica que el webhook de Clerk) para
 * crear tenant + clinic_settings + seeds. Como todavía no hay organización de
 * Clerk real, se genera un `clerkOrganizationId` sintético con prefijo
 * `pending:` — sirve de marcador para que el equipo la reconcilie/active al
 * crear la cuenta real. El slug se garantiza único (tenants.slug es UNIQUE).
 */
export async function createPendingClinic(name: string): Promise<{ id: string; slug: string }> {
  const base = slugify(name);
  let slug = base;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const clash = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);
    if (!clash[0]) break;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const clerkOrgId = `pending:${slug}:${Date.now()}`;
  const tenant = await ensureTenantForOrg({ clerkOrgId, name, slug });
  return { id: tenant.id, slug };
}
