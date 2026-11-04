import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  advanceOffers,
  appointmentReminders,
  professionalTimeOff,
  tenants,
  waitlistOffers,
} from '@/lib/db/schema';
import { isSuperAdminTenant } from '@/lib/modules';

/**
 * Archivar una clínica la deja fuera de servicio sin perder nada: sus datos
 * siguen en la base y Futura la puede restaurar. Mientras está archivada nadie
 * de la clínica entra al panel y la plataforma no le escribe a sus pacientes
 * (asistente de WhatsApp, recordatorios, ofertas de huecos, confirmación del
 * día, rutinas).
 *
 * Eliminar es otra cosa y sólo se puede con una clínica ya archivada: borra la
 * fila de `tenants` y, por las FK en cascada, TODO lo suyo.
 */

export const ARCHIVED_STATUS = 'archived';

export class TenantArchiveError extends Error {}

const cache = new Map<string, { at: number; archived: boolean }>();
const TTL_MS = 60_000;

/** ¿Está archivada? Cacheado un minuto por proceso: lo consultan los jobs en cada vuelta. */
export async function isTenantArchived(tenantId: string): Promise<boolean> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.archived;
  const [row] = await db
    .select({ status: tenants.status })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  // Sin fila = la clínica ya no existe: tampoco se le escribe a nadie.
  const archived = !row || row.status === ARCHIVED_STATUS;
  cache.set(tenantId, { at: Date.now(), archived });
  return archived;
}

export async function archiveTenant(tenantId: string): Promise<void> {
  if (isSuperAdminTenant(tenantId)) {
    throw new TenantArchiveError('La organización de Futura no se puede archivar.');
  }
  const [row] = await db
    .update(tenants)
    .set({ status: ARCHIVED_STATUS })
    .where(eq(tenants.id, tenantId))
    .returning({ id: tenants.id });
  if (!row) throw new TenantArchiveError('Esa clínica no existe.');
  cache.set(tenantId, { at: Date.now(), archived: true });

  // Lo que estaba en cola para salir hacia los pacientes, fuera.
  await db
    .update(appointmentReminders)
    .set({ status: 'CANCELLED' })
    .where(
      and(
        eq(appointmentReminders.tenantId, tenantId),
        eq(appointmentReminders.status, 'SCHEDULED'),
      ),
    );
  await db
    .update(waitlistOffers)
    .set({ status: 'CANCELLED' })
    .where(
      and(
        eq(waitlistOffers.tenantId, tenantId),
        inArray(waitlistOffers.status, ['PENDING', 'SENT']),
      ),
    );
  const held = await db
    .update(advanceOffers)
    .set({ status: 'CANCELLED', answeredAt: new Date() })
    .where(and(eq(advanceOffers.tenantId, tenantId), eq(advanceOffers.status, 'SENT')))
    .returning({ holdBlockId: advanceOffers.holdBlockId });
  const blockIds = held.map((h) => h.holdBlockId).filter((id): id is string => Boolean(id));
  if (blockIds.length) {
    await db
      .delete(professionalTimeOff)
      .where(
        and(eq(professionalTimeOff.tenantId, tenantId), inArray(professionalTimeOff.id, blockIds)),
      );
  }
}

export async function restoreTenant(tenantId: string): Promise<void> {
  const [row] = await db
    .update(tenants)
    .set({ status: 'active' })
    .where(and(eq(tenants.id, tenantId), eq(tenants.status, ARCHIVED_STATUS)))
    .returning({ id: tenants.id });
  if (!row) throw new TenantArchiveError('Esa clínica no está archivada.');
  cache.set(tenantId, { at: Date.now(), archived: false });
}

/**
 * Borra la clínica y todo lo suyo. Sólo una archivada, y sólo si quien lo pide
 * escribió su nombre exacto: se compara aquí, en el servidor, no en el cliente.
 * Devuelve la organización de Clerk para que quien llama la borre después.
 */
export async function deleteArchivedTenant(
  tenantId: string,
  confirmName: string,
): Promise<{ clerkOrganizationId: string; name: string }> {
  if (isSuperAdminTenant(tenantId)) {
    throw new TenantArchiveError('La organización de Futura no se puede eliminar.');
  }
  const [row] = await db
    .select({
      name: tenants.name,
      status: tenants.status,
      clerkOrganizationId: tenants.clerkOrganizationId,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!row) throw new TenantArchiveError('Esa clínica no existe.');
  if (row.status !== ARCHIVED_STATUS) {
    throw new TenantArchiveError('Primero hay que archivar la clínica.');
  }
  if (confirmName.trim() !== row.name.trim()) {
    throw new TenantArchiveError('El nombre no coincide. Escríbelo tal cual aparece.');
  }
  await db
    .delete(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.status, ARCHIVED_STATUS)));
  cache.set(tenantId, { at: Date.now(), archived: true });
  return { clerkOrganizationId: row.clerkOrganizationId, name: row.name };
}
