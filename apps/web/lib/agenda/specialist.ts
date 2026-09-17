import 'server-only';
import { and, eq, inArray, ne } from 'drizzle-orm';

import { contactRefsFor } from '@/lib/agenda/patients';
import { db } from '@/lib/db/client';
import {
  agendaAppointments,
  professionals,
  tenants,
  whatsappContacts,
  whatsappConversations,
} from '@/lib/db/schema';

/**
 * La derivación al especialista está limitada a los tenants de esta lista: el
 * resto sigue exactamente como antes (el handoff no asigna ni menciona a nadie).
 * Se identifican por `slug` o por `clerk_organization_id`. La lista por defecto
 * es la única clínica que la pidió; se puede ampliar por env sin tocar código.
 */
const DEFAULT_SPECIALIST_ROUTING_TENANTS = ['juanfran-s-organization-1788202447676614548'];

function specialistRoutingAllowlist(): Set<string> {
  const raw = process.env.SPECIALIST_ROUTING_TENANTS;
  const list = raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_SPECIALIST_ROUTING_TENANTS;
  return new Set(list);
}

/** ¿Este tenant tiene activada la derivación al especialista? */
async function specialistRoutingEnabled(tenantId: string): Promise<boolean> {
  const allow = specialistRoutingAllowlist();
  if (allow.size === 0) return false;
  const [t] = await db
    .select({ slug: tenants.slug, clerkOrganizationId: tenants.clerkOrganizationId })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!t) return false;
  return allow.has(t.slug) || allow.has(t.clerkOrganizationId);
}

/**
 * El especialista al que le corresponde un contacto.
 *
 * La app no tiene una relación paciente↔profesional explícita: la fuente de
 * verdad es la agenda. Un paciente "es de" el profesional con el que tiene cita.
 * Con eso, cuando escribe por WhatsApp, además de que el agente lo atienda,
 * derivamos el hilo a ese profesional para que pueda entrar o quedar enterado.
 */
export interface ContactSpecialist {
  professionalId: string;
  /** Null = el profesional no entra al panel; no se le puede asignar ni mencionar. */
  userId: string | null;
  fullName: string;
  specialty: string | null;
  /** Cita futura más próxima o, si no hay, la pasada más reciente. */
  refStartsAt: Date;
  upcoming: boolean;
}

/**
 * Resuelve los profesionales de un contacto a partir de sus citas.
 *
 * Prioriza al profesional con cita futura más próxima; si el paciente no tiene
 * ninguna futura, cae a la pasada más reciente. Devuelve la lista ordenada por
 * relevancia (futuras primero, la más próxima delante) y deduplicada por
 * profesional: un paciente puede seguir tratamientos con varios especialistas y
 * "cada especialista correspondiente" tiene que enterarse.
 *
 * Las citas canceladas no cuentan: un especialista al que le cancelaron ya no
 * es el que corresponde.
 */
export async function resolveContactSpecialists(
  tenantId: string,
  contact: { ghlContactId?: string | null; phone?: string | null; email?: string | null },
): Promise<ContactSpecialist[]> {
  if (!(await specialistRoutingEnabled(tenantId))) return [];
  const refs = contactRefsFor(contact);
  if (refs.length === 0) return [];

  const rows = await db
    .select({
      professionalId: professionals.id,
      userId: professionals.userId,
      fullName: professionals.fullName,
      specialty: professionals.specialty,
      startsAt: agendaAppointments.startsAt,
    })
    .from(agendaAppointments)
    .innerJoin(professionals, eq(professionals.id, agendaAppointments.professionalId))
    .where(
      and(
        eq(agendaAppointments.tenantId, tenantId),
        inArray(agendaAppointments.patientKey, refs),
        eq(professionals.active, true),
        ne(agendaAppointments.status, 'CANCELLED'),
      ),
    );

  if (rows.length === 0) return [];

  const now = Date.now();
  const byProfessional = new Map<string, ContactSpecialist>();
  for (const r of rows) {
    const upcoming = r.startsAt.getTime() >= now;
    const prev = byProfessional.get(r.professionalId);
    if (prev && !isBetterRef(r.startsAt, upcoming, prev)) continue;
    byProfessional.set(r.professionalId, {
      professionalId: r.professionalId,
      userId: r.userId,
      fullName: r.fullName,
      specialty: r.specialty,
      refStartsAt: r.startsAt,
      upcoming,
    });
  }

  return [...byProfessional.values()].sort(compareByRelevance);
}

/** Igual que `resolveContactSpecialists`, partiendo del id de la conversación. */
export async function resolveConversationSpecialists(
  tenantId: string,
  conversationId: string,
): Promise<ContactSpecialist[]> {
  if (!(await specialistRoutingEnabled(tenantId))) return [];
  const [contact] = await db
    .select({
      phone: whatsappContacts.phoneE164,
      email: whatsappContacts.email,
      ghlContactId: whatsappContacts.ghlContactId,
    })
    .from(whatsappConversations)
    .innerJoin(whatsappContacts, eq(whatsappContacts.id, whatsappConversations.contactId))
    .where(
      and(
        eq(whatsappConversations.tenantId, tenantId),
        eq(whatsappConversations.id, conversationId),
      ),
    )
    .limit(1);
  if (!contact) return [];
  return resolveContactSpecialists(tenantId, contact);
}

/** ¿La cita nueva es mejor referencia que la que ya teníamos del profesional? */
function isBetterRef(startsAt: Date, upcoming: boolean, prev: ContactSpecialist): boolean {
  if (upcoming !== prev.upcoming) return upcoming; // una futura siempre gana a una pasada
  if (upcoming) return startsAt.getTime() < prev.refStartsAt.getTime(); // futura más próxima
  return startsAt.getTime() > prev.refStartsAt.getTime(); // pasada más reciente
}

function compareByRelevance(a: ContactSpecialist, b: ContactSpecialist): number {
  if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1;
  const at = a.refStartsAt.getTime();
  const bt = b.refStartsAt.getTime();
  return a.upcoming ? at - bt : bt - at;
}
