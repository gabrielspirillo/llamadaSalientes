import 'server-only';
import { sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import type { AnalyticsRange } from './inbound';
import { daysAgo, startOfToday } from './shared';

// ─────────────────────────────────────────────────────────────────────────────
// Analytics del módulo Mensajes — la pestaña "Equipo" (§8.7 del plan).
//
// Todas estas métricas apuntan al mismo número: cuánto tarda el equipo en
// TOMAR algo que aparece. El chat es el instrumento; esto es el termómetro.
//
// Nota de robustez: si la migración 0019 todavía no corrió, estas consultas
// tiran `relation "im_messages" does not exist`. El caller (la pestaña) las
// envuelve en try/catch y muestra un EmptyState — Analytics no se rompe.
// ─────────────────────────────────────────────────────────────────────────────

/** Un mensaje humano cuenta como reacción si llega dentro de esta ventana. */
const REACTION_WINDOW_HOURS = 4;

/**
 * Techo de la muestra de tiempo de reacción. Alguien que contesta la tarjeta
 * tres días después no "reaccionó": ese caso ya lo cuenta `eventsIgnored`, y
 * dejarlo dentro de la muestra rompería la mediana y el p90.
 */
const REACTION_SAMPLE_CAP_HOURS = 24;

export type ReactionTime = {
  /** Mediana en segundos. `null` cuando no hubo ninguna reacción medible. */
  medianSeconds: number | null;
  /** Percentil 90 en segundos: la cola, que es donde duele. */
  p90Seconds: number | null;
  /** Cuántos eventos entraron en la muestra. */
  samples: number;
};

export type OpenMentionsByPerson = {
  userId: string;
  name: string;
  email: string;
  open: number;
  unread: number;
  /** ISO de la mención abierta más antigua. */
  oldestAt: string | null;
};

export type HourBin = {
  hour: number;
  messages: number;
};

export type MessagingAnalytics = {
  range: AnalyticsRange;
  timezone: string;
  reaction: ReactionTime;
  /** Tarjetas de evento publicadas en el rango. */
  eventsTotal: number;
  /** Tarjetas sin ningún mensaje humano detrás ni tarea asociada. */
  eventsIgnored: number;
  totalMessages: number;
  humanMessages: number;
  tasksFromMessages: number;
  /** 0–1: cuánta conversación se convierte en acción. */
  messageToTaskRatio: number;
  openMentions: number;
  mentionsByPerson: OpenMentionsByPerson[];
  byHour: HourBin[];
};

export async function getMessagingAnalytics(
  tenantId: string,
  range: AnalyticsRange,
): Promise<MessagingAnalytics> {
  const start = rangeStart(range);
  const timezone = await getTimezone(tenantId);

  const [reaction, events, volume, tasksLinked, mentionsByPerson, byHour] = await Promise.all([
    queryReactionTime(tenantId, start),
    queryEvents(tenantId, start),
    queryVolume(tenantId, start),
    queryTasksFromMessages(tenantId, start),
    queryMentionsByPerson(tenantId, start),
    queryByHour(tenantId, start, timezone),
  ]);

  const openMentions = mentionsByPerson.reduce((acc, m) => acc + m.open, 0);

  return {
    range,
    timezone,
    reaction,
    eventsTotal: events.total,
    eventsIgnored: events.ignored,
    totalMessages: volume.total,
    humanMessages: volume.human,
    tasksFromMessages: tasksLinked,
    messageToTaskRatio: volume.total === 0 ? 0 : tasksLinked / volume.total,
    openMentions,
    mentionsByPerson,
    byHour,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Consultas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tiempo entre una tarjeta de evento y el primer mensaje humano posterior EN EL
 * MISMO CANAL. El `join lateral … limit 1` deja que Postgres corte en cuanto
 * encuentra la primera fila usando `im_messages_channel_created_idx`, en vez de
 * materializar todas las respuestas de cada evento.
 */
async function queryReactionTime(tenantId: string, start: Date): Promise<ReactionTime> {
  const rows = await db.execute<{
    p50: number | string | null;
    p90: number | string | null;
    samples: number;
  }>(sql`
    select
      percentile_cont(0.5) within group (order by s.secs) as p50,
      percentile_cont(0.9) within group (order by s.secs) as p90,
      count(*)::int as samples
    from (
      select extract(epoch from (h.created_at - e.created_at)) as secs
      from im_messages e
      join lateral (
        select m.created_at
        from im_messages m
        where m.channel_id = e.channel_id
          and m.sender_kind = 'USER'
          and m.deleted_at is null
          and m.created_at > e.created_at
          and m.created_at <= e.created_at + ${sql.raw(`interval '${REACTION_SAMPLE_CAP_HOURS} hours'`)}
        order by m.created_at asc
        limit 1
      ) h on true
      where e.tenant_id = ${tenantId}::uuid
        and e.kind = 'EVENT'
        and e.deleted_at is null
        and e.created_at >= ${start.toISOString()}::timestamptz
    ) s
  `);

  const row = firstRow(rows);
  return {
    medianSeconds: toSeconds(row?.p50),
    p90Seconds: toSeconds(row?.p90),
    samples: row?.samples ?? 0,
  };
}

/**
 * Eventos totales y eventos que se cayeron por el agujero: sin mensaje humano
 * dentro de la ventana y sin tarea creada desde la tarjeta.
 *
 * Sólo se evalúan los eventos que ya cumplieron la ventana — una tarjeta
 * publicada hace diez minutos no está ignorada, está fresca.
 */
async function queryEvents(
  tenantId: string,
  start: Date,
): Promise<{ total: number; ignored: number }> {
  const window = sql.raw(`interval '${REACTION_WINDOW_HOURS} hours'`);
  const rows = await db.execute<{ total: number; ignored: number }>(sql`
    select
      count(*)::int as total,
      count(*) filter (
        where e.created_at < now() - ${window}
          and not exists (
            select 1 from im_messages m
            where m.channel_id = e.channel_id
              and m.sender_kind = 'USER'
              and m.deleted_at is null
              and m.created_at > e.created_at
              and m.created_at <= e.created_at + ${window}
          )
          and not exists (
            select 1 from tasks t
            where t.tenant_id = e.tenant_id and t.im_message_id = e.id
          )
      )::int as ignored
    from im_messages e
    where e.tenant_id = ${tenantId}::uuid
      and e.kind = 'EVENT'
      and e.deleted_at is null
      and e.created_at >= ${start.toISOString()}::timestamptz
  `);

  const row = firstRow(rows);
  return { total: row?.total ?? 0, ignored: row?.ignored ?? 0 };
}

async function queryVolume(
  tenantId: string,
  start: Date,
): Promise<{ total: number; human: number }> {
  const rows = await db.execute<{ total: number; human: number }>(sql`
    select
      count(*)::int as total,
      count(*) filter (where sender_kind = 'USER')::int as human
    from im_messages
    where tenant_id = ${tenantId}::uuid
      and deleted_at is null
      and created_at >= ${start.toISOString()}::timestamptz
  `);
  const row = firstRow(rows);
  return { total: row?.total ?? 0, human: row?.human ?? 0 };
}

/** Tareas nacidas de un mensaje: el puente `tasks.im_message_id`. */
async function queryTasksFromMessages(tenantId: string, start: Date): Promise<number> {
  const rows = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
    from tasks
    where tenant_id = ${tenantId}::uuid
      and im_message_id is not null
      and created_at >= ${start.toISOString()}::timestamptz
  `);
  return firstRow(rows)?.count ?? 0;
}

/**
 * Menciones abiertas por persona. Es el indicador de sobrecarga individual: si
 * una sola persona acumula veinte, el cuello de botella tiene nombre.
 */
async function queryMentionsByPerson(
  tenantId: string,
  start: Date,
): Promise<OpenMentionsByPerson[]> {
  const rows = await db.execute<{
    userId: string;
    email: string;
    open: number;
    unread: number;
    oldestAt: unknown;
  }>(sql`
    select
      u.id as "userId",
      u.email as "email",
      count(*)::int as "open",
      count(*) filter (where mn.read_at is null)::int as "unread",
      min(mn.created_at) as "oldestAt"
    from im_mentions mn
    join users u on u.id = mn.user_id
    where mn.tenant_id = ${tenantId}::uuid
      and mn.resolved_at is null
      and mn.created_at >= ${start.toISOString()}::timestamptz
    group by u.id, u.email
    order by "open" desc, u.email asc
    limit 25
  `);

  return toArray(rows).map((r) => ({
    userId: r.userId,
    email: r.email,
    name: displayName(r.email),
    open: r.open,
    unread: r.unread,
    oldestAt: toIsoOrNull(r.oldestAt),
  }));
}

/**
 * Histograma de 24 bins. La hora se calcula en la timezone de la clínica, no
 * en la del servidor: el objetivo de la métrica es decidir turnos.
 */
async function queryByHour(tenantId: string, start: Date, timezone: string): Promise<HourBin[]> {
  const rows = await db.execute<{ hour: number; messages: number }>(sql`
    select
      extract(hour from (created_at at time zone ${timezone}))::int as hour,
      count(*)::int as messages
    from im_messages
    where tenant_id = ${tenantId}::uuid
      and deleted_at is null
      and created_at >= ${start.toISOString()}::timestamptz
    group by 1
  `);

  const bins: HourBin[] = Array.from({ length: 24 }, (_, hour) => ({ hour, messages: 0 }));
  for (const r of toArray(rows)) {
    const h = Number(r.hour);
    if (Number.isInteger(h) && h >= 0 && h < 24) bins[h]!.messages = Number(r.messages) || 0;
  }
  return bins;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Mismo criterio de ventana que el resto de Analytics (ver `inbound.ts`). */
function rangeStart(range: AnalyticsRange): Date {
  if (range === 'today') return startOfToday();
  return daysAgo(range === '7d' ? 7 : 30);
}

async function getTimezone(tenantId: string): Promise<string> {
  try {
    const rows = await db.execute<{ timezone: string | null }>(sql`
      select timezone from clinic_settings where tenant_id = ${tenantId}::uuid limit 1
    `);
    return firstRow(rows)?.timezone || 'Europe/Madrid';
  } catch {
    return 'Europe/Madrid';
  }
}

/** `ana.perez@clinica.es` → `Ana Perez`. Es lo único que hay: users no guarda nombre. */
function displayName(email: string): string {
  const local = (email ?? '').split('@')[0] ?? '';
  if (!local) return email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** `percentile_cont` vuelve como numeric: postgres-js lo entrega en string. */
function toSeconds(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toIsoOrNull(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value) return value;
  return null;
}

function toArray<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

function firstRow<T>(result: unknown): T | undefined {
  return toArray<T>(result)[0];
}
