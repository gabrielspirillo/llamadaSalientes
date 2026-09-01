import 'server-only';
import { type SQL, and, eq, gte, isNull, lt, ne, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { appointmentsCache, calls, tasks, waitlistOffers } from '@/lib/db/schema';
import { postSystemEvent } from '@/lib/messaging/bot';
import type { StepRunner } from '@/lib/queue/step';
import { getTenantTimezone, listActiveTenantIds } from '@/lib/tasks/materialize';
import { addDaysToKey, localDateKey, localParts, parseDateKey, zonedToUtc } from '@/lib/tasks/tz';

/**
 * Resumen diario del equipo publicado como tarjeta del bot en `#general`.
 *
 * Corre cada 30 minutos y no hace nada para la mayoría de las clínicas: sólo
 * publica en las que, EN SU PROPIA TIMEZONE, acaban de dar las 08:00. Es el
 * mismo patrón de `task-routines-tick` — un solo cron cubre Madrid, Ciudad de
 * México y Bogotá sin registrar un repeatable por zona.
 *
 * Idempotencia: el `dedupeKey` lleva el día local, así que los dos ticks que
 * caen dentro de la ventana publican una sola tarjeta.
 *
 * Best-effort de punta a punta: un tenant que falla no frena a los demás y el
 * job nunca tira el proceso.
 */

/** Ancho de la ventana de disparo, en minutos. Igual al período del cron. */
const WINDOW_MINUTES = 30;

/** Hora local de publicación: la apertura de la clínica. */
const DIGEST_HOUR = 8;

/**
 * Una llamada cuenta como perdida con el mismo criterio que usa el módulo
 * Tareas para el trigger MISSED_CALL (`lib/tasks/hooks.ts`): cortó con error o
 * duró menos de 20 segundos. Mantener un único criterio evita que el resumen
 * diga una cosa y el tablero otra.
 */
const MISSED_SECONDS = 20;

export interface DigestNumbers {
  callsAnswered: number;
  callsMissed: number;
  appointmentsBooked: number;
  appointmentsCancelled: number;
  appointmentsNoShow: number;
  waitlistRescued: number;
  tasksOverdue: number;
}

export async function processImDigestJob(
  _data: Record<string, never>,
  step: StepRunner,
): Promise<{ tenants: number; published: number; alerts: number; failed: number }> {
  const tenantIds = await step.run('list-tenants', async () => listActiveTenantIds());

  let published = 0;
  let alerts = 0;
  let failed = 0;

  for (const tenantId of tenantIds) {
    try {
      const res = await runDigestForTenant(tenantId);
      if (res.published) published += 1;
      if (res.alerted) alerts += 1;
    } catch (err) {
      failed += 1;
      console.error('[im-digest] tenant failed', {
        tenantId,
        err: (err as Error).message,
      });
    }
  }

  return { tenants: tenantIds.length, published, alerts, failed };
}

/**
 * Publica el resumen de un tenant si le toca. Exportada para poder dispararla
 * a mano desde un script sin esperar al cron.
 */
export async function runDigestForTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<{ published: boolean; alerted: boolean; skipped?: string }> {
  const tz = await getTenantTimezone(tenantId);
  const parts = localParts(now, tz);

  // Ventana de media hora a partir de las 08:00 locales. Las zonas con offset
  // de :30 o :45 (India, Nepal) caen igual dentro porque miramos el minuto
  // local, no el del reloj UTC del worker.
  if (parts.hour !== DIGEST_HOUR || parts.minute >= WINDOW_MINUTES) {
    return { published: false, alerted: false, skipped: 'fuera-de-ventana' };
  }

  const todayKey = localDateKey(now, tz);
  const yesterdayKey = addDaysToKey(todayKey, -1);
  const dayStart = startOfLocalDay(yesterdayKey, tz);
  const dayEnd = startOfLocalDay(todayKey, tz);
  if (!dayStart || !dayEnd) return { published: false, alerted: false, skipped: 'fecha-invalida' };

  const numbers = await collectDigestNumbers(tenantId, dayStart, dayEnd);

  await postSystemEvent({
    tenantId,
    event: 'analytics.daily_digest',
    title: `Resumen de ayer · ${formatDayLabel(yesterdayKey)}`,
    body: renderDigestBody(numbers),
    channel: { slug: 'general' },
    actions: [
      {
        id: 'ver-analytics',
        label: 'Ver Analytics',
        tone: 'secondary',
        href: '/dashboard/analytics?tab=inbound&range=7d',
      },
    ],
    dedupeKey: `evt:analytics.daily_digest:${tenantId}:${yesterdayKey}`,
  });

  const alerted = await maybePostThresholdAlert({
    tenantId,
    tz,
    yesterdayKey,
    dayStart,
    dayEnd,
    missedYesterday: numbers.callsMissed,
  });

  return { published: true, alerted };
}

// ─────────────────────────────────────────────────────────────────────────────
// Números
//
// Se calculan acá y no reutilizando `lib/data/analytics/*` porque aquellas
// funciones fijan la ventana con `startOfToday()` — hora local DEL SERVIDOR, no
// de la clínica. Para un resumen que se publica a las 08:00 de Madrid eso daría
// el día equivocado. El criterio de cada métrica sí es el mismo que el que ya
// usan Analytics y el módulo Tareas.
// ─────────────────────────────────────────────────────────────────────────────

/** `started_at` puede faltar; `created_at` es el fallback (ver calls-list.ts). */
const callOccurredAt = sql<Date>`COALESCE(${calls.startedAt}, ${calls.createdAt})`;

const missedCallPredicate = sql`(${calls.status} = 'error' OR COALESCE(${calls.durationSeconds}, 0) < ${MISSED_SECONDS})`;

export async function collectDigestNumbers(
  tenantId: string,
  dayStart: Date,
  dayEnd: Date,
): Promise<DigestNumbers> {
  const [callRow] = await db
    .select({
      total: sql<number>`count(*)::int`,
      missed: sql<number>`count(*) filter (where ${missedCallPredicate})::int`,
    })
    .from(calls)
    .where(and(eq(calls.tenantId, tenantId), inWindow(callOccurredAt, dayStart, dayEnd)));

  const [apptRow] = await db
    .select({
      booked: sql<number>`count(*) filter (where ${appointmentsCache.status} in ('scheduled','confirmed','completed'))::int`,
      cancelled: sql<number>`count(*) filter (where ${appointmentsCache.status} = 'cancelled')::int`,
      noShow: sql<number>`count(*) filter (where ${appointmentsCache.status} = 'no_show')::int`,
    })
    .from(appointmentsCache)
    .where(
      and(
        eq(appointmentsCache.tenantId, tenantId),
        gte(appointmentsCache.startTime, dayStart),
        lt(appointmentsCache.startTime, dayEnd),
      ),
    );

  const [rescuedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(waitlistOffers)
    .where(
      and(
        eq(waitlistOffers.tenantId, tenantId),
        eq(waitlistOffers.status, 'ACCEPTED'),
        gte(waitlistOffers.respondedAt, dayStart),
        lt(waitlistOffers.respondedAt, dayEnd),
      ),
    );

  // Vencidas al momento del resumen: lo que ya debería estar hecho y sigue
  // abierto. Se mide contra el corte del día, no contra `now`.
  const [overdueRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.tenantId, tenantId),
        ne(tasks.status, 'DONE'),
        isNull(tasks.archivedAt),
        lt(tasks.dueAt, dayEnd),
      ),
    );

  const total = callRow?.total ?? 0;
  const missed = callRow?.missed ?? 0;

  return {
    callsAnswered: Math.max(0, total - missed),
    callsMissed: missed,
    appointmentsBooked: apptRow?.booked ?? 0,
    appointmentsCancelled: apptRow?.cancelled ?? 0,
    appointmentsNoShow: apptRow?.noShow ?? 0,
    waitlistRescued: rescuedRow?.count ?? 0,
    tasksOverdue: overdueRow?.count ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Alerta por umbral
// ─────────────────────────────────────────────────────────────────────────────

/** Cuánto tiene que superar la media para que valga la pena avisar. */
const ALERT_RATIO = 1.5;

/**
 * Piso absoluto: con medias de 0,4 llamadas perdidas cualquier día normal
 * "supera un 50 %". Sin este piso el canal se llena de ruido y el equipo
 * silencia las alertas — que es la forma de perderlas todas.
 */
const ALERT_MIN_MISSED = 3;

async function maybePostThresholdAlert(a: {
  tenantId: string;
  tz: string;
  yesterdayKey: string;
  dayStart: Date;
  dayEnd: Date;
  missedYesterday: number;
}): Promise<boolean> {
  if (a.missedYesterday < ALERT_MIN_MISSED) return false;

  // Los 7 días previos a ayer: [ayer-7, ayer).
  const baselineStart = startOfLocalDay(addDaysToKey(a.yesterdayKey, -7), a.tz);
  if (!baselineStart) return false;

  const [row] = await db
    .select({ missed: sql<number>`count(*) filter (where ${missedCallPredicate})::int` })
    .from(calls)
    .where(and(eq(calls.tenantId, a.tenantId), inWindow(callOccurredAt, baselineStart, a.dayStart)));

  const baselineTotal = row?.missed ?? 0;
  const average = baselineTotal / 7;
  if (average <= 0 || a.missedYesterday <= average * ALERT_RATIO) return false;

  const deltaPct = Math.round((a.missedYesterday / average - 1) * 100);

  await postSystemEvent({
    tenantId: a.tenantId,
    event: 'analytics.threshold_alert',
    title: `Llamadas perdidas ${deltaPct} % por encima de lo habitual`,
    body: [
      `Ayer se perdieron ${a.missedYesterday} llamadas.`,
      `La media de los 7 días previos es ${average.toFixed(1)}.`,
      'Vale la pena mirar si hubo un hueco de cobertura o un pico de tráfico.',
    ].join(' '),
    channel: { slug: 'general' },
    actions: [
      {
        id: 'ver-llamadas',
        label: 'Ver llamadas',
        tone: 'primary',
        href: '/dashboard/analytics?tab=inbound&range=7d',
      },
    ],
    dedupeKey: `evt:analytics.threshold_alert:${a.tenantId}:${a.yesterdayKey}:missed_calls`,
  });

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function inWindow(column: SQL<Date>, start: Date, end: Date): SQL {
  return sql`${column} >= ${start.toISOString()}::timestamptz AND ${column} < ${end.toISOString()}::timestamptz`;
}

/** 'YYYY-MM-DD' → instante UTC de las 00:00 locales de ese día. */
function startOfLocalDay(key: string, tz: string): Date | null {
  const p = parseDateKey(key);
  if (!p) return null;
  return zonedToUtc(p.year, p.month, p.day, 0, 0, tz);
}

function formatDayLabel(key: string): string {
  const p = parseDateKey(key);
  if (!p) return key;
  try {
    return new Intl.DateTimeFormat('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(p.year, p.month - 1, p.day)));
  } catch {
    return key;
  }
}

/** Sólo las líneas con contenido: un resumen de ceros no lo lee nadie. */
export function renderDigestBody(n: DigestNumbers): string {
  const lines: string[] = [
    `📞 ${n.callsAnswered} ${plural(n.callsAnswered, 'llamada atendida', 'llamadas atendidas')} · ${n.callsMissed} ${plural(n.callsMissed, 'perdida', 'perdidas')}`,
    `📅 ${n.appointmentsBooked} ${plural(n.appointmentsBooked, 'cita', 'citas')} en agenda · ${n.appointmentsCancelled} ${plural(n.appointmentsCancelled, 'cancelada', 'canceladas')} · ${n.appointmentsNoShow} sin asistir`,
  ];

  if (n.waitlistRescued > 0) {
    lines.push(
      `♻️ ${n.waitlistRescued} ${plural(n.waitlistRescued, 'hueco rescatado', 'huecos rescatados')} por la lista de espera`,
    );
  }

  if (n.tasksOverdue > 0) {
    lines.push(
      `⏰ ${n.tasksOverdue} ${plural(n.tasksOverdue, 'tarea vencida', 'tareas vencidas')} sin cerrar`,
    );
  } else {
    lines.push('✅ Ninguna tarea vencida');
  }

  return lines.join('\n');
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
