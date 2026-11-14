import 'server-only';
import { sql } from 'drizzle-orm';

import { listNotifications } from '@/lib/data/notifications';
import { db } from '@/lib/db/client';
import {
  type EventRow,
  NOTICE_EVENTS,
  type Notice,
  duplicateGroups,
  duplicatesNotice,
  eventToNotice,
  sortNotices,
  tasksNotice,
} from '@/lib/notifications/model';
import { getTenantTimezone } from '@/lib/tasks/materialize';
import { localDateKey, parseDateKey, zonedToUtc } from '@/lib/tasks/tz';

/**
 * Lo que sale en la campana para una persona: las tarjetas del chat interno
 * que piden algo (llamar, atender un WhatsApp, una cita anulada…), las
 * llamadas del asistente, las fichas duplicadas (sólo admin) y sus tareas del
 * día. Cada fuente es best-effort: si una falla, la campana sigue con el resto.
 */
export async function buildNoticeFeed(args: {
  tenantId: string;
  userId: string | null;
  isAdmin: boolean;
}): Promise<Notice[]> {
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const tz = await getTenantTimezone(args.tenantId).catch(() => 'Europe/Madrid');
  const todayKey = localDateKey(now, tz);
  const p = parseDateKey(todayKey);
  const endToday = p
    ? new Date(zonedToUtc(p.year, p.month, p.day, 0, 0, tz).getTime() + 86_400_000)
    : now;

  const [events, calls, dupes, tasks, dismissed] = await Promise.all([
    db
      .execute<{
        id: string;
        event_key: string;
        body: string;
        context_payload: Record<string, unknown>;
        actions: EventRow['actions'];
        created_at: string;
      }>(sql`
        select id, event_key, body, context_payload, actions, created_at
        from im_messages
        where tenant_id = ${args.tenantId}::uuid
          and kind = 'EVENT'
          and deleted_at is null
          and created_at >= ${since}::timestamptz
          and event_key in (${sql.join(
            NOTICE_EVENTS.map((e) => sql`${e}`),
            sql`, `,
          )})
        order by created_at desc
        limit 60
      `)
      .catch(() => []),
    listNotifications(args.tenantId, 15).catch(() => []),
    args.isAdmin
      ? db
          .execute<{ id: string; name: string }>(sql`
            select id::text as id, trim(first_name || ' ' || coalesce(last_name, '')) as name
            from patients
            where tenant_id = ${args.tenantId}::uuid
            limit 5000
          `)
          .catch(() => [])
      : Promise.resolve([]),
    args.userId
      ? db
          .execute<{ today: number; overdue: number }>(sql`
            select
              count(*) filter (where t.due_at >= ${now.toISOString()}::timestamptz)::int as today,
              count(*) filter (where t.due_at < ${now.toISOString()}::timestamptz)::int as overdue
            from tasks t
            join task_assignees a on a.task_id = t.id and a.tenant_id = t.tenant_id
            where t.tenant_id = ${args.tenantId}::uuid
              and a.user_id = ${args.userId}::uuid
              and t.archived_at is null
              and t.status::text not in ('DONE', 'CANCELLED')
              and t.due_at < ${endToday.toISOString()}::timestamptz
          `)
          .catch(() => [])
      : Promise.resolve([]),
    args.userId ? dismissedRefs(args.tenantId, args.userId) : Promise.resolve(new Set<string>()),
  ]);

  const items: Notice[] = [];
  for (const e of events) {
    const n = eventToNotice({
      id: e.id,
      eventKey: e.event_key,
      body: e.body,
      contextPayload: e.context_payload ?? {},
      actions: e.actions ?? [],
      createdAt: e.created_at,
    });
    if (n) items.push(n);
  }
  for (const c of calls) {
    items.push({
      ref: `call:${c.id}`,
      category: 'voice',
      title: c.title,
      detail: c.detail,
      createdAt: c.createdAt.toISOString(),
      href: `/dashboard/calls/${c.callId}`,
      actions: [],
    });
  }
  const dup = duplicatesNotice(duplicateGroups(dupes), now);
  if (dup) items.push(dup);
  const t = tasks[0];
  const tn = t ? tasksNotice({ today: t.today, overdue: t.overdue }, todayKey, now) : null;
  if (tn) items.push(tn);

  return sortNotices(items.filter((n) => !dismissed.has(n.ref)));
}

async function dismissedRefs(tenantId: string, userId: string): Promise<Set<string>> {
  const rows = await db
    .execute<{ ref: string }>(sql`
      select ref from notification_dismissals
      where tenant_id = ${tenantId}::uuid and user_id = ${userId}::uuid
        and dismissed_at > now() - interval '30 days'
    `)
    .catch(() => []);
  return new Set(rows.map((r) => r.ref));
}

/** Descartar es por persona: a la compañera le sigue saliendo. */
export async function dismissNotices(
  tenantId: string,
  userId: string,
  refs: string[],
): Promise<void> {
  const unique = [...new Set(refs)].filter((r) => r.length > 0 && r.length <= 200).slice(0, 200);
  if (unique.length === 0) return;
  await db.execute(sql`
    insert into notification_dismissals (tenant_id, user_id, ref)
    values ${sql.join(
      unique.map((r) => sql`(${tenantId}::uuid, ${userId}::uuid, ${r})`),
      sql`, `,
    )}
    on conflict (tenant_id, user_id, ref) do update set dismissed_at = now()
  `);
  // Lo descartado hace más de un mes ya no está en ninguna fuente.
  await db
    .execute(sql`
      delete from notification_dismissals
      where tenant_id = ${tenantId}::uuid and user_id = ${userId}::uuid
        and dismissed_at < now() - interval '30 days'
    `)
    .catch(() => undefined);
}
