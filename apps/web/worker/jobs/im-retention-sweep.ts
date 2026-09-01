import 'server-only';
import { sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import type { StepRunner } from '@/lib/queue/step';

/**
 * Barrido de retención del módulo Mensajes.
 *
 * Borrado **duro** de los mensajes que superaron la ventana de retención del
 * tenant. Es la pata operativa de la postura RGPD del módulo (§10 del plan):
 * en el chat interno de una clínica hay datos de salud, y "los guardamos para
 * siempre" no es una política defendible.
 *
 * Se borra sólo `im_messages`: reacciones, menciones, pines y guardados cuelgan
 * de él con FK `on delete cascade`, así que el borrado del mensaje se lleva
 * todo lo derivado. Los canales quedan (un canal vacío no es dato personal).
 *
 * Por lotes de 1000 y con `order by created_at`: un `delete` de medio millón de
 * filas mantiene el lock demasiado tiempo y el resto del producto lo nota.
 */

const BATCH_SIZE = 1000;

/** Techo de seguridad por tenant y corrida: 200 lotes = 200 000 filas. */
const MAX_BATCHES = 200;

/** Defecto de la columna `im_user_settings.retention_months`. */
const DEFAULT_RETENTION_MONTHS = 24;

/** Ninguna clínica puede configurar menos de un mes ni más de diez años. */
const MIN_RETENTION_MONTHS = 1;
const MAX_RETENTION_MONTHS = 120;

export async function processImRetentionSweepJob(
  _data: Record<string, never>,
  step: StepRunner,
): Promise<{ tenants: number; deleted: number; failed: number }> {
  const tenantIds = await step.run('list-tenants', async () => listAllTenantIds());

  let deleted = 0;
  let failed = 0;

  for (const tenantId of tenantIds) {
    try {
      const res = await sweepTenant(tenantId);
      deleted += res.deleted;
      if (res.deleted > 0) {
        console.log('[im-retention-sweep] tenant barrido', {
          tenantId,
          months: res.months,
          deleted: res.deleted,
        });
      }
    } catch (err) {
      failed += 1;
      console.error('[im-retention-sweep] tenant failed', {
        tenantId,
        err: (err as Error).message,
      });
    }
  }

  return { tenants: tenantIds.length, deleted, failed };
}

/**
 * Barre un tenant. Devuelve cuántas filas borró y con qué ventana.
 * Exportada para poder correrla a mano sobre una clínica concreta.
 */
export async function sweepTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<{ deleted: number; months: number }> {
  const months = await resolveRetentionMonths(tenantId);
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);

  let deleted = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const rows = await db.execute<{ id: string }>(sql`
      delete from im_messages
      where id in (
        select id
        from im_messages
        where tenant_id = ${tenantId}::uuid
          and created_at < ${cutoff.toISOString()}::timestamptz
        order by created_at
        limit ${BATCH_SIZE}
      )
      returning id
    `);

    const count = rowCount(rows);
    deleted += count;
    if (count < BATCH_SIZE) break;
  }

  return { deleted, months };
}

/**
 * La retención es una política DE TENANT, pero la migración la guarda en
 * `im_user_settings`, que tiene una fila por usuario. Se toma la más estricta
 * configurada en la clínica: si alguien con permiso de admin bajó la ventana,
 * respetarla es lo defendible; quedarse con la más laxa sería ignorar una
 * decisión ya tomada. Sin filas, el defecto de la columna.
 */
async function resolveRetentionMonths(tenantId: string): Promise<number> {
  const rows = await db.execute<{ months: number | null }>(sql`
    select min(retention_months)::int as months
    from im_user_settings
    where tenant_id = ${tenantId}::uuid
  `);
  const raw = firstRow(rows)?.months ?? null;
  const months = raw == null || !Number.isFinite(raw) ? DEFAULT_RETENTION_MONTHS : raw;
  return Math.min(MAX_RETENTION_MONTHS, Math.max(MIN_RETENTION_MONTHS, months));
}

/**
 * Todos los tenants, incluidos los suspendidos: la obligación de borrar no se
 * suspende junto con la suscripción.
 */
async function listAllTenantIds(): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`select id from tenants`);
  return toArray(rows).map((r) => r.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Export para el derecho de acceso del paciente (RGPD art. 15)
// ─────────────────────────────────────────────────────────────────────────────

export type PatientMessageExportRow = {
  messageId: string;
  channelId: string;
  channelName: string | null;
  channelSlug: string | null;
  senderKind: string;
  senderUserId: string | null;
  senderEmail: string | null;
  kind: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
};

/**
 * Todos los mensajes del chat interno que hablan de un paciente concreto —
 * los que llevan contexto `PATIENT` con su `ghlContactId`.
 *
 * Incluye los borrados blandos: un mensaje que sigue en la tabla sigue siendo
 * dato personal y entra en el derecho de acceso. `deletedAt` viene en la fila
 * para poder marcarlo en el informe.
 */
export async function exportMessagesForPatient(
  tenantId: string,
  ghlContactId: string,
): Promise<PatientMessageExportRow[]> {
  const rows = await db.execute<PatientMessageExportRow>(sql`
    select
      m.id            as "messageId",
      m.channel_id    as "channelId",
      c.name          as "channelName",
      c.slug          as "channelSlug",
      m.sender_kind   as "senderKind",
      m.sender_user_id as "senderUserId",
      u.email         as "senderEmail",
      m.kind          as "kind",
      m.body          as "body",
      m.created_at    as "createdAt",
      m.edited_at     as "editedAt",
      m.deleted_at    as "deletedAt"
    from im_messages m
    join im_channels c on c.id = m.channel_id
    left join users u on u.id = m.sender_user_id
    where m.tenant_id = ${tenantId}::uuid
      and m.context_type = 'PATIENT'
      and m.context_id = ${ghlContactId}
    order by m.created_at asc
  `);

  return toArray(rows).map((r) => ({
    ...r,
    createdAt: toIso(r.createdAt),
    editedAt: r.editedAt ? toIso(r.editedAt) : null,
    deletedAt: r.deletedAt ? toIso(r.deletedAt) : null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de resultado crudo
//
// `db.execute` devuelve el RowList de postgres-js (un array con metadatos).
// Estos tres helpers evitan repetir el casteo en cada consulta.
// ─────────────────────────────────────────────────────────────────────────────

function toArray<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

function firstRow<T>(result: unknown): T | undefined {
  return toArray<T>(result)[0];
}

function rowCount(result: unknown): number {
  return toArray(result).length;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
