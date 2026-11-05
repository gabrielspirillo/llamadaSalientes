import 'server-only';
import { sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { addDaysToKey, localDateKey } from '@/lib/tasks/tz';
import { sectionLabel } from '@/lib/usage/sections';

/**
 * El informe de uso de la plataforma para Futura (/dashboard/futura/uso).
 * Dos fuentes: el tiempo activo en el panel (`usage_minutes`, lo llena el
 * latido) y lo que cada clínica HACE, contado en las tablas de cada módulo
 * (no en el registro de auditoría, que sólo apunta una parte). Futura no
 * cuenta ni como tiempo ni como clínica.
 */

export interface ClinicUsage {
  tenantId: string;
  name: string;
  status: string;
  minutes: number;
  prevMinutes: number;
  activeDays: number;
  activeUsers: number;
  avgMinutesPerActiveDay: number;
  lastSeenDay: string | null;
  topSection: string | null;
  daily: number[];
  /** Minutos por sección (clave). */
  bySection: Record<string, number>;
  actions: Record<ActionKey, number>;
  risk: 'none' | 'inactive' | 'dropping' | 'never';
}

export type ActionKey =
  | 'appts_panel'
  | 'appts_agents'
  | 'appts_recovered'
  | 'notes'
  | 'wa_team'
  | 'wa_agent'
  | 'tasks'
  | 'invoices'
  | 'charges'
  | 'consents'
  | 'finance'
  | 'team_chat'
  | 'lessons';

export const ACTION_LABELS: Record<ActionKey, string> = {
  appts_panel: 'Citas dadas por recepción',
  appts_agents: 'Citas dadas por los asistentes',
  appts_recovered: 'Citas recuperadas (huecos y espera)',
  notes: 'Notas clínicas',
  wa_team: 'WhatsApp enviados por el equipo',
  wa_agent: 'WhatsApp respondidos por el asistente',
  tasks: 'Tareas creadas',
  invoices: 'Facturas emitidas',
  charges: 'Cobros registrados',
  consents: 'Consentimientos enviados',
  finance: 'Movimientos de finanzas',
  team_chat: 'Mensajes del chat interno',
  lessons: 'Enseñanzas al asistente',
};

/** Las que hace la persona; el resto lo hace la plataforma sola. */
export const MANUAL_ACTIONS: ActionKey[] = [
  'appts_panel',
  'notes',
  'wa_team',
  'tasks',
  'invoices',
  'charges',
  'consents',
  'finance',
  'team_chat',
  'lessons',
];
export const AUTOMATED_ACTIONS: ActionKey[] = ['appts_agents', 'appts_recovered', 'wa_agent'];

export interface UsageReport {
  fromDay: string;
  toDay: string;
  days: string[];
  clinics: ClinicUsage[];
  totals: {
    minutes: number;
    prevMinutes: number;
    activeClinics: number;
    totalClinics: number;
    activeUsers: number;
    avgDailyUsers: number;
    /** Usuarios activos de media al día / usuarios activos en el período. */
    stickiness: number;
    automatedShare: number;
  };
  sections: { key: string; label: string; minutes: number; clinics: number }[];
  actions: { key: ActionKey; label: string; total: number; clinics: number; automated: boolean }[];
}

type Row = Record<string, unknown>;
const rows = (r: unknown): Row[] =>
  Array.isArray(r) ? (r as Row[]) : ((r as { rows?: Row[] }).rows ?? []);
const num = (v: unknown) => Number(v ?? 0) || 0;

/** Conteos por clínica de cada acción en el período, en una sola consulta. */
async function actionCounts(
  from: string,
  to: string,
): Promise<Map<string, Record<ActionKey, number>>> {
  const q = sql`
    select tenant_id, 'appts_panel' k, count(*) as n from agenda_appointments
      where created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz and source = 'PANEL' group by 1
    union all
    select tenant_id, 'appts_agents', count(*) from agenda_appointments
      where created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz and source in ('WHATSAPP_AGENT','VOICE_AGENT') group by 1
    union all
    select tenant_id, 'appts_recovered', count(*) from agenda_appointments
      where created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz and source = 'WAITLIST' group by 1
    union all
    select tenant_id, 'appts_recovered', count(*) from advance_offers
      where created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz and status = 'ACCEPTED' and request_id is null group by 1
    union all
    select tenant_id, 'notes', count(*) from clinical_notes
      where created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz group by 1
    union all
    select tenant_id, 'wa_team', count(*) from whatsapp_messages
      where created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz and direction = 'OUTBOUND' and sender_type = 'HUMAN' group by 1
    union all
    select tenant_id, 'wa_agent', count(*) from whatsapp_messages
      where created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz and direction = 'OUTBOUND' and sender_type = 'AGENT' group by 1
    union all
    select tenant_id, 'tasks', count(*) from tasks
      where created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz and source = 'MANUAL' group by 1
    union all
    select tenant_id, 'invoices', count(*) from invoices
      where created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz group by 1
    union all
    select tenant_id, 'charges', count(*) from patient_charges
      where created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz and status = 'PAID' group by 1
    union all
    select tenant_id, 'consents', count(*) from patient_consents
      where created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz group by 1
    union all
    select tenant_id, 'finance', count(*) from finance_entries
      where created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz group by 1
    union all
    select tenant_id, 'team_chat', count(*) from im_messages
      where created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz group by 1
    union all
    select tenant_id, 'lessons', count(*) from agent_lessons
      where created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz group by 1
  `;
  const out = new Map<string, Record<ActionKey, number>>();
  for (const r of rows(await db.execute(q))) {
    const t = String(r.tenant_id);
    const k = String(r.k) as ActionKey;
    const cur = out.get(t) ?? ({} as Record<ActionKey, number>);
    cur[k] = (cur[k] ?? 0) + num(r.n);
    out.set(t, cur);
  }
  return out;
}

export async function getUsageReport(opts: {
  days: number;
  excludeTenantId: string;
  timezone?: string;
  now?: Date;
}): Promise<UsageReport> {
  const tz = opts.timezone ?? 'Europe/Madrid';
  const now = opts.now ?? new Date();
  const toDay = localDateKey(now, tz);
  const fromDay = addDaysToKey(toDay, -(opts.days - 1));
  const prevFrom = addDaysToKey(fromDay, -opts.days);
  const prevTo = addDaysToKey(fromDay, -1);
  const days: string[] = [];
  for (let d = fromDay; d <= toDay; d = addDaysToKey(d, 1)) days.push(d);
  const fromTs = `${fromDay}T00:00:00Z`;
  const toTs = new Date(now.getTime() + 60_000).toISOString();

  const [tenantRows, usageRows, prevRows, lastSeenRows, actions] = await Promise.all([
    db.execute(sql`
      select id, name, status from tenants
      where id <> ${opts.excludeTenantId} and status <> 'archived'
      order by name`),
    db.execute(sql`
      select tenant_id, user_id, day::text as day, section, minutes from usage_minutes
      where day between ${fromDay}::date and ${toDay}::date and tenant_id <> ${opts.excludeTenantId}`),
    db.execute(sql`
      select tenant_id, sum(minutes) m from usage_minutes
      where day between ${prevFrom}::date and ${prevTo}::date group by 1`),
    db.execute(sql`select tenant_id, max(day)::text d from usage_minutes group by 1`),
    actionCounts(fromTs, toTs),
  ]);

  const prev = new Map(rows(prevRows).map((r) => [String(r.tenant_id), num(r.m)]));
  const lastSeen = new Map(rows(lastSeenRows).map((r) => [String(r.tenant_id), String(r.d)]));
  const usage = rows(usageRows);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const recentFrom = addDaysToKey(toDay, -6);

  const clinics: ClinicUsage[] = rows(tenantRows).map((t) => {
    const id = String(t.id);
    const mine = usage.filter((u) => String(u.tenant_id) === id);
    const daily = days.map(() => 0);
    const bySection: Record<string, number> = {};
    const users = new Set<string>();
    const activeDays = new Set<string>();
    let minutes = 0;
    for (const u of mine) {
      const m = num(u.minutes);
      const d = String(u.day);
      minutes += m;
      users.add(String(u.user_id));
      activeDays.add(d);
      const i = dayIndex.get(d);
      if (i !== undefined) daily[i] = (daily[i] ?? 0) + m;
      const s = String(u.section);
      bySection[s] = (bySection[s] ?? 0) + m;
    }
    const top = Object.entries(bySection).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const prevMinutes = prev.get(id) ?? 0;
    const last = lastSeen.get(id) ?? null;
    const risk: ClinicUsage['risk'] = !last
      ? 'never'
      : last < recentFrom
        ? 'inactive'
        : prevMinutes >= 60 && minutes < prevMinutes * 0.5
          ? 'dropping'
          : 'none';
    return {
      tenantId: id,
      name: String(t.name),
      status: String(t.status),
      minutes,
      prevMinutes,
      activeDays: activeDays.size,
      activeUsers: users.size,
      avgMinutesPerActiveDay: activeDays.size ? Math.round(minutes / activeDays.size) : 0,
      lastSeenDay: last,
      topSection: top,
      daily,
      bySection,
      actions: actions.get(id) ?? ({} as Record<ActionKey, number>),
      risk,
    };
  });
  clinics.sort((a, b) => b.minutes - a.minutes);

  // Totales.
  const allUsers = new Set(usage.map((u) => `${u.tenant_id}:${u.user_id}`));
  const usersPerDay = new Map<string, Set<string>>();
  for (const u of usage) {
    const d = String(u.day);
    const set = usersPerDay.get(d) ?? new Set<string>();
    set.add(`${u.tenant_id}:${u.user_id}`);
    usersPerDay.set(d, set);
  }
  const avgDailyUsers =
    days.reduce((acc, d) => acc + (usersPerDay.get(d)?.size ?? 0), 0) / Math.max(1, days.length);

  const sectionTotals = new Map<string, { minutes: number; clinics: Set<string> }>();
  for (const u of usage) {
    const s = String(u.section);
    const cur = sectionTotals.get(s) ?? { minutes: 0, clinics: new Set<string>() };
    cur.minutes += num(u.minutes);
    cur.clinics.add(String(u.tenant_id));
    sectionTotals.set(s, cur);
  }

  const actionKeys = Object.keys(ACTION_LABELS) as ActionKey[];
  const actionList = actionKeys
    .map((k) => {
      let total = 0;
      let used = 0;
      for (const c of clinics) {
        const n = c.actions[k] ?? 0;
        total += n;
        if (n > 0) used += 1;
      }
      return {
        key: k,
        label: ACTION_LABELS[k],
        total,
        clinics: used,
        automated: AUTOMATED_ACTIONS.includes(k),
      };
    })
    .sort((a, b) => b.total - a.total);
  const autoTotal = actionList.filter((a) => a.automated).reduce((s, a) => s + a.total, 0);
  const allActions = actionList.reduce((s, a) => s + a.total, 0);

  return {
    fromDay,
    toDay,
    days,
    clinics,
    totals: {
      minutes: clinics.reduce((s, c) => s + c.minutes, 0),
      prevMinutes: clinics.reduce((s, c) => s + c.prevMinutes, 0),
      activeClinics: clinics.filter((c) => c.minutes > 0).length,
      totalClinics: clinics.length,
      activeUsers: allUsers.size,
      avgDailyUsers: Math.round(avgDailyUsers * 10) / 10,
      stickiness: allUsers.size ? avgDailyUsers / allUsers.size : 0,
      automatedShare: allActions ? autoTotal / allActions : 0,
    },
    sections: [...sectionTotals.entries()]
      .map(([key, v]) => ({
        key,
        label: sectionLabel(key),
        minutes: v.minutes,
        clinics: v.clinics.size,
      }))
      .sort((a, b) => b.minutes - a.minutes),
    actions: actionList,
  };
}

export function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
