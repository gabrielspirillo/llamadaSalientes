import 'server-only';
import { and, asc, desc, eq, gte, inArray, ne } from 'drizzle-orm';

import type { AgendaContext } from '@/lib/agenda/auth';
import { patientKeyFor } from '@/lib/agenda/patients';
import { type AvailabilityResult, getAvailability, getClinicTimezone } from '@/lib/agenda/queries';
import { type AppointmentInput, createAppointment } from '@/lib/agenda/service';
import { BUSY_STATUSES } from '@/lib/agenda/shared';
import { db } from '@/lib/db/client';
import {
  agendaAppointments,
  clinicalNotes,
  professionalTreatments,
  professionals,
  treatments,
} from '@/lib/db/schema';
import { addDaysToKey, localDateKey } from '@/lib/tasks/tz';

/**
 * Puente entre la agenda interna y los agentes virtuales (voz y WhatsApp).
 *
 * Los agentes no tienen sesión: entran por webhook. Por eso trabajan con un
 * contexto de sistema — pueden escribir en la agenda de la clínica que atienden
 * y de ninguna otra, porque el `tenantId` sale del número/instancia por el que
 * llegó la conversación y no de nada que diga el interlocutor.
 */
export function systemAgendaContext(tenantId: string): AgendaContext {
  return {
    tenantId,
    clerkOrganizationId: '',
    userId: null,
    clerkUserId: 'system:agent',
    role: 'operator',
    isSuperAdmin: false,
    impersonating: false,
    professional: null,
    scope: 'ALL',
    canManageProfessionals: false,
    canWriteAppointments: true,
    canWriteClinicalNotes: false,
    agendaOnly: false,
  };
}

// ─── Normalización de nombres ────────────────────────────────────────────────

/** Sin tildes, sin puntuación y en minúsculas. Lo que dicta el habla del agente. */
export function normalizeName(raw: string | null | undefined): string {
  return (
    (raw ?? '')
      .normalize('NFD')
      // Tildes del castellano y poco más: acento, diéresis, virgulilla y cedilla.
      .replace(/\u0301|\u0300|\u0302|\u0303|\u0308|\u0327/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Empareja lo que dijo el paciente con un nombre del catálogo.
 *
 * Deliberadamente simple y explicable: igualdad, luego inclusión, luego
 * solapamiento de palabras. El agente dice "una limpieza" y la clínica lo tiene
 * como "Limpieza dental (higiene)".
 */
export function matchByName<T>(
  spoken: string,
  candidates: T[],
  nameOf: (item: T) => string,
): T | null {
  const q = normalizeName(spoken);
  if (!q || candidates.length === 0) return null;

  const normalized = candidates.map((c) => ({ item: c, name: normalizeName(nameOf(c)) }));

  const exact = normalized.find((c) => c.name === q);
  if (exact) return exact.item;

  const contains = normalized.find((c) => c.name.includes(q) || q.includes(c.name));
  if (contains) return contains.item;

  const qWords = q.split(' ').filter((w) => w.length > 3);
  let best: { item: T; score: number } | null = null;
  for (const c of normalized) {
    const words = new Set(c.name.split(' '));
    const score = qWords.filter((w) => words.has(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { item: c.item, score };
  }
  return best?.item ?? null;
}

// ─── Lo que los agentes leen ─────────────────────────────────────────────────

export interface AgentProfessional {
  id: string;
  fullName: string;
  specialty: string | null;
  acceptsOnlineBooking: boolean;
  treatments: { id: string; name: string; durationMinutes: number }[];
}

/**
 * Profesionales con agenda encendida y lo que hace cada uno. Es la foto que
 * necesitan todos los agentes virtuales para hablar de la agenda con criterio.
 */
export async function listAgentProfessionals(tenantId: string): Promise<AgentProfessional[]> {
  const rows = await db
    .select({
      id: professionals.id,
      fullName: professionals.fullName,
      specialty: professionals.specialty,
      acceptsOnlineBooking: professionals.acceptsOnlineBooking,
    })
    .from(professionals)
    .where(
      and(
        eq(professionals.tenantId, tenantId),
        eq(professionals.active, true),
        eq(professionals.agendaEnabled, true),
      ),
    )
    .orderBy(asc(professionals.fullName));

  if (rows.length === 0) return [];

  const links = await db
    .select({
      professionalId: professionalTreatments.professionalId,
      id: treatments.id,
      name: treatments.name,
      base: treatments.durationMinutes,
      override: professionalTreatments.durationOverrideMinutes,
    })
    .from(professionalTreatments)
    .innerJoin(treatments, eq(treatments.id, professionalTreatments.treatmentId))
    .where(
      and(
        eq(professionalTreatments.tenantId, tenantId),
        inArray(
          professionalTreatments.professionalId,
          rows.map((r) => r.id),
        ),
      ),
    );

  return rows.map((r) => ({
    ...r,
    treatments: links
      .filter((l) => l.professionalId === r.id)
      .map((l) => ({ id: l.id, name: l.name, durationMinutes: l.override ?? l.base })),
  }));
}

export interface AgentSlotSearch {
  /** Lo que dijo el paciente. Puede venir vacío. */
  treatmentName?: string | null;
  professionalName?: string | null;
  /** 'YYYY-MM-DD'. Si no viene, desde hoy. */
  preferredDate?: string | null;
  /** Cuántos días mirar hacia delante desde la fecha preferida. */
  days?: number;
  limitPerProfessional?: number;
  now?: Date;
}

export interface AgentSlotOption {
  professionalId: string;
  professionalName: string;
  treatmentId: string | null;
  treatmentName: string | null;
  durationMinutes: number;
  start: Date;
  end: Date;
}

export interface AgentSlotSearchResult {
  timezone: string;
  options: AgentSlotOption[];
  matchedTreatment: { id: string; name: string } | null;
  matchedProfessional: { id: string; fullName: string } | null;
  /** Por qué no hay opciones, cuando la causa es de configuración. */
  reason: 'OK' | 'NO_AGENDA' | 'NO_PROFESSIONAL_FOR_TREATMENT' | 'NO_SLOTS';
}

/**
 * Huecos que un agente puede ofrecer.
 *
 * Si el paciente pidió profesional concreto se mira sólo el suyo; si pidió
 * tratamiento, los que lo realizan; y si no dijo nada, todos los que tengan la
 * agenda encendida. Se devuelven intercalados por hora para que el agente
 * ofrezca "lo antes posible" y no la agenda entera del primero de la lista.
 */
export async function findAgentSlots(
  tenantId: string,
  params: AgentSlotSearch,
): Promise<AgentSlotSearchResult> {
  const timezone = await getClinicTimezone(tenantId);
  const now = params.now ?? new Date();
  const todayKey = localDateKey(now, timezone);
  const requested = params.preferredDate?.trim();
  const fromKey =
    requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && requested >= todayKey
      ? requested
      : todayKey;
  const toKey = addDaysToKey(fromKey, Math.max(0, params.days ?? 6));

  const catalog = await listAgentProfessionals(tenantId);
  if (catalog.length === 0) {
    return {
      timezone,
      options: [],
      matchedTreatment: null,
      matchedProfessional: null,
      reason: 'NO_AGENDA',
    };
  }

  // Tratamiento: primero contra lo que realmente realiza alguien; si no
  // aparece, contra el catálogo entero (para poder decir que nadie lo hace).
  const offered = dedupeTreatments(catalog);
  let matchedTreatment = params.treatmentName
    ? matchByName(params.treatmentName, offered, (t) => t.name)
    : null;
  if (!matchedTreatment && params.treatmentName) {
    const all = await db
      .select({
        id: treatments.id,
        name: treatments.name,
        durationMinutes: treatments.durationMinutes,
      })
      .from(treatments)
      .where(and(eq(treatments.tenantId, tenantId), eq(treatments.active, true)));
    matchedTreatment = matchByName(params.treatmentName, all, (t) => t.name);
  }

  const matchedProfessional = params.professionalName
    ? matchByName(params.professionalName, catalog, (p) => p.fullName)
    : null;

  let pool = catalog;
  if (matchedProfessional) {
    pool = [matchedProfessional];
  } else if (matchedTreatment) {
    const doIt = catalog.filter((p) => p.treatments.some((t) => t.id === matchedTreatment.id));
    // Si nadie lo tiene asignado explícitamente, no se esconde la agenda: se
    // ofrece con todos. Una clínica que aún no asignó tratamientos seguiría
    // pudiendo dar cita, que es lo que le importa.
    pool = doIt.length > 0 ? doIt : catalog;
  }

  const bookable = pool.filter((p) => p.acceptsOnlineBooking);
  if (bookable.length === 0) {
    return {
      timezone,
      options: [],
      matchedTreatment: matchedTreatment
        ? { id: matchedTreatment.id, name: matchedTreatment.name }
        : null,
      matchedProfessional: matchedProfessional
        ? { id: matchedProfessional.id, fullName: matchedProfessional.fullName }
        : null,
      reason: 'NO_PROFESSIONAL_FOR_TREATMENT',
    };
  }

  const perProfessional = params.limitPerProfessional ?? 4;
  const results = await Promise.all(
    bookable.map(async (p) => {
      const duration =
        p.treatments.find((t) => t.id === matchedTreatment?.id)?.durationMinutes ??
        matchedTreatment?.durationMinutes ??
        30;
      const availability: AvailabilityResult = await getAvailability(tenantId, {
        professionalId: p.id,
        fromDateKey: fromKey,
        toDateKey: toKey,
        durationMinutes: duration,
        limit: perProfessional,
        now,
      });
      return availability.slots.map<AgentSlotOption>((s) => ({
        professionalId: p.id,
        professionalName: p.fullName,
        treatmentId: matchedTreatment?.id ?? null,
        treatmentName: matchedTreatment?.name ?? null,
        durationMinutes: duration,
        start: s.start,
        end: s.end,
      }));
    }),
  );

  const options = results.flat().sort((a, b) => a.start.getTime() - b.start.getTime());

  return {
    timezone,
    options,
    matchedTreatment: matchedTreatment
      ? { id: matchedTreatment.id, name: matchedTreatment.name }
      : null,
    matchedProfessional: matchedProfessional
      ? { id: matchedProfessional.id, fullName: matchedProfessional.fullName }
      : null,
    reason: options.length > 0 ? 'OK' : 'NO_SLOTS',
  };
}

function dedupeTreatments(
  catalog: AgentProfessional[],
): { id: string; name: string; durationMinutes: number }[] {
  const map = new Map<string, { id: string; name: string; durationMinutes: number }>();
  for (const p of catalog) for (const t of p.treatments) if (!map.has(t.id)) map.set(t.id, t);
  return [...map.values()];
}

/** Reserva desde un agente virtual. Idempotente si se le pasa `dedupeKey`. */
export async function bookAgentAppointment(
  tenantId: string,
  input: Omit<AppointmentInput, 'source'> & {
    source: 'VOICE_AGENT' | 'WHATSAPP_AGENT' | 'WAITLIST';
  },
) {
  return createAppointment(systemAgendaContext(tenantId), input);
}

// ─── Contexto de paciente para los agentes ───────────────────────────────────

export interface AgentPatientContext {
  patientKey: string;
  patientName: string | null;
  nextAppointment: {
    id: string;
    startsAt: Date;
    professionalName: string;
    treatmentName: string | null;
    status: string;
  } | null;
  lastVisitAt: Date | null;
  lastProfessionalName: string | null;
  /** Indicaciones de la última nota clínica NO privada. */
  pendingFollowUp: string | null;
}

/**
 * Lo que un agente virtual puede saber de un paciente por su teléfono.
 *
 * Las notas privadas quedan fuera a propósito: son la valoración personal del
 * profesional, no material para que un agente se lo lea a nadie por teléfono.
 */
export async function getAgentPatientContext(
  tenantId: string,
  identity: { phone?: string | null; ghlContactId?: string | null },
): Promise<AgentPatientContext | null> {
  const patientKey = patientKeyFor({ phone: identity.phone, ghlContactId: identity.ghlContactId });
  if (patientKey.startsWith('anon:')) return null;

  const [upcoming, past] = await Promise.all([
    db
      .select({
        id: agendaAppointments.id,
        startsAt: agendaAppointments.startsAt,
        status: agendaAppointments.status,
        professionalName: professionals.fullName,
        treatmentName: treatments.name,
        patientName: agendaAppointments.patientName,
      })
      .from(agendaAppointments)
      .innerJoin(professionals, eq(professionals.id, agendaAppointments.professionalId))
      .leftJoin(treatments, eq(treatments.id, agendaAppointments.treatmentId))
      .where(
        and(
          eq(agendaAppointments.tenantId, tenantId),
          eq(agendaAppointments.patientKey, patientKey),
          gte(agendaAppointments.startsAt, new Date()),
          ne(agendaAppointments.status, 'CANCELLED'),
        ),
      )
      .orderBy(asc(agendaAppointments.startsAt))
      .limit(1),
    db
      .select({
        startsAt: agendaAppointments.startsAt,
        professionalName: professionals.fullName,
        patientName: agendaAppointments.patientName,
      })
      .from(agendaAppointments)
      .innerJoin(professionals, eq(professionals.id, agendaAppointments.professionalId))
      .where(
        and(
          eq(agendaAppointments.tenantId, tenantId),
          eq(agendaAppointments.patientKey, patientKey),
          inArray(agendaAppointments.status, BUSY_STATUSES),
        ),
      )
      .orderBy(desc(agendaAppointments.startsAt))
      .limit(1),
  ]);

  if (upcoming.length === 0 && past.length === 0) return null;

  const [note] = await db
    .select({ nextSteps: clinicalNotes.nextSteps })
    .from(clinicalNotes)
    .where(
      and(
        eq(clinicalNotes.tenantId, tenantId),
        eq(clinicalNotes.patientKey, patientKey),
        eq(clinicalNotes.private, false),
      ),
    )
    .orderBy(desc(clinicalNotes.createdAt))
    .limit(1);

  return {
    patientKey,
    patientName: upcoming[0]?.patientName ?? past[0]?.patientName ?? null,
    nextAppointment: upcoming[0]
      ? {
          id: upcoming[0].id,
          startsAt: upcoming[0].startsAt,
          professionalName: upcoming[0].professionalName,
          treatmentName: upcoming[0].treatmentName ?? null,
          status: upcoming[0].status,
        }
      : null,
    lastVisitAt: past[0]?.startsAt ?? null,
    lastProfessionalName: past[0]?.professionalName ?? null,
    pendingFollowUp: note?.nextSteps ?? null,
  };
}

/** Texto compacto de la agenda para meterlo en el prompt de un agente. */
export async function describeAgendaForPrompt(tenantId: string): Promise<string> {
  const catalog = await listAgentProfessionals(tenantId);
  if (catalog.length === 0) return '';
  const lines = catalog.map((p) => {
    const what =
      p.treatments.length > 0
        ? p.treatments
            .map((t) => t.name)
            .slice(0, 8)
            .join(', ')
        : 'todos los tratamientos';
    const booking = p.acceptsOnlineBooking ? '' : ' (no reservar: sólo recepción)';
    return `- ${p.fullName}${p.specialty ? ` (${p.specialty})` : ''}: ${what}${booking}`;
  });
  return `Profesionales con agenda en la clínica:\n${lines.join('\n')}`;
}
