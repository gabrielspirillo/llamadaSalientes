import 'server-only';
import { and, desc, eq, gte } from 'drizzle-orm';

import type { AgendaContext } from '@/lib/agenda/auth';
import { normalizePatientPhone } from '@/lib/agenda/patients';
import { AgendaValidationError } from '@/lib/agenda/service';
import { db } from '@/lib/db/client';
import { professionals, slotPriorityRequests } from '@/lib/db/schema';
import { getPatientPerson } from '@/lib/patients/persons';

/**
 * "Si se libera un hueco, que sea para este paciente". La clínica lo pide
 * desde la ficha; el motor de ofertas (`lib/agenda/advance-offers.ts`) se lo
 * ofrece el primero cuando se libera un hueco en esos días.
 */

export interface PriorityRequestView {
  id: string;
  fromDay: string;
  untilDay: string;
  professionalId: string | null;
  professionalName: string | null;
  note: string | null;
  status: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function createPriorityRequest(
  ctx: AgendaContext,
  input: {
    patientId: string;
    fromDay: string;
    untilDay: string;
    professionalId?: string | null;
    note?: string | null;
  },
): Promise<{ id: string }> {
  if (!DAY.test(input.fromDay) || !DAY.test(input.untilDay) || input.untilDay < input.fromDay) {
    throw new AgendaValidationError('Las fechas no son válidas.');
  }
  const person = await getPatientPerson(ctx.tenantId, input.patientId);
  if (!person) throw new AgendaValidationError('Ese paciente no existe.');
  const holder = person.guardians.find((g) => g.primary && g.phone)?.phone;
  const phone = normalizePatientPhone(holder || person.contactPhone || '');
  if (!phone) {
    throw new AgendaValidationError(
      'El paciente no tiene teléfono: hace falta para avisar a la familia por WhatsApp.',
    );
  }
  if (input.professionalId) {
    const [p] = await db
      .select({ id: professionals.id })
      .from(professionals)
      .where(
        and(eq(professionals.tenantId, ctx.tenantId), eq(professionals.id, input.professionalId)),
      )
      .limit(1);
    if (!p) throw new AgendaValidationError('Ese profesional no existe.');
  }
  // Una sola petición viva por paciente: la nueva sustituye a la anterior.
  await db
    .update(slotPriorityRequests)
    .set({ status: 'CANCELLED', updatedAt: new Date() })
    .where(
      and(
        eq(slotPriorityRequests.tenantId, ctx.tenantId),
        eq(slotPriorityRequests.patientId, person.id),
        eq(slotPriorityRequests.status, 'ACTIVE'),
      ),
    );
  const [row] = await db
    .insert(slotPriorityRequests)
    .values({
      tenantId: ctx.tenantId,
      patientId: person.id,
      patientKey: `pat:${person.id}`,
      patientName: person.fullName,
      phoneE164: phone,
      professionalId: input.professionalId || null,
      fromDay: input.fromDay,
      untilDay: input.untilDay,
      note: input.note?.trim().slice(0, 300) || null,
      createdByUserId: ctx.userId,
    })
    .returning({ id: slotPriorityRequests.id });
  if (!row) throw new AgendaValidationError('No se pudo guardar.');
  return row;
}

export async function cancelPriorityRequest(ctx: AgendaContext, id: string): Promise<void> {
  await db
    .update(slotPriorityRequests)
    .set({ status: 'CANCELLED', updatedAt: new Date() })
    .where(and(eq(slotPriorityRequests.tenantId, ctx.tenantId), eq(slotPriorityRequests.id, id)));
}

/** La petición viva (o la última reservada) de este paciente, para la ficha. */
export async function getPriorityRequestForPatient(
  tenantId: string,
  patientId: string,
  todayKey: string,
): Promise<PriorityRequestView | null> {
  const [row] = await db
    .select({
      id: slotPriorityRequests.id,
      fromDay: slotPriorityRequests.fromDay,
      untilDay: slotPriorityRequests.untilDay,
      professionalId: slotPriorityRequests.professionalId,
      professionalName: professionals.fullName,
      note: slotPriorityRequests.note,
      status: slotPriorityRequests.status,
    })
    .from(slotPriorityRequests)
    .leftJoin(professionals, eq(professionals.id, slotPriorityRequests.professionalId))
    .where(
      and(
        eq(slotPriorityRequests.tenantId, tenantId),
        eq(slotPriorityRequests.patientId, patientId),
        eq(slotPriorityRequests.status, 'ACTIVE'),
        gte(slotPriorityRequests.untilDay, todayKey),
      ),
    )
    .orderBy(desc(slotPriorityRequests.createdAt))
    .limit(1);
  return row ?? null;
}
