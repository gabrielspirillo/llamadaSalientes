import 'server-only';
import { db } from '@/lib/db/client';
import { callEvents, calls } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';

export type UpsertCallInput = {
  tenantId: string;
  retellCallId: string;
  fromNumber?: string | null;
  toNumber?: string | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
  durationSeconds?: number | null;
  status?: string | null;
  intent?: string | null;
  sentiment?: string | null;
  transferred?: boolean;
  transcriptEnc?: string | null;
  summary?: string | null;
  ghlContactId?: string | null;
};

/**
 * Upsert *parcial*: solo escribe las columnas que vengan definidas en `input`.
 *
 * ⚠️ Importante: Retell manda 3 eventos por llamada (call_started → call_ended →
 * call_analyzed) y cada uno trae un subconjunto de datos. Si acá construyéramos
 * el objeto con `?? null`, el último evento pisaría con NULL todo lo que no
 * mande (from/to number, started_at, ended_at, duration, ghl_contact_id...).
 * Eso es exactamente lo que dejaba la tabla de /dashboard/calls vacía.
 *
 * Por eso: `undefined` = "no tocar esta columna"; `null` = "borrar el valor".
 */
export async function upsertCall(input: UpsertCallInput) {
  // Solo las claves explícitamente presentes en el input.
  const patch: Partial<typeof calls.$inferInsert> = {};
  const assign = <K extends keyof typeof calls.$inferInsert>(
    key: K,
    value: (typeof calls.$inferInsert)[K] | undefined,
  ) => {
    if (value !== undefined) patch[key] = value;
  };

  assign('fromNumber', input.fromNumber);
  assign('toNumber', input.toNumber);
  assign('startedAt', input.startedAt);
  assign('endedAt', input.endedAt);
  assign('durationSeconds', input.durationSeconds);
  assign('status', input.status);
  assign('intent', input.intent);
  assign('sentiment', input.sentiment);
  assign('transferred', input.transferred);
  assign('transcriptEnc', input.transcriptEnc);
  assign('summary', input.summary);
  assign('ghlContactId', input.ghlContactId);

  const values = {
    ...patch,
    tenantId: input.tenantId,
    retellCallId: input.retellCallId,
    transferred: input.transferred ?? false,
  };

  // INSERT ... ON CONFLICT: atómico. Dos eventos de la misma llamada pueden
  // llegar casi a la vez (call_started y call_ended en llamadas cortas); con
  // select-then-insert los dos veían "no existe" y el segundo reventaba contra
  // el unique de retell_call_id.
  const insert = db.insert(calls).values(values);
  const [row] =
    Object.keys(patch).length === 0
      ? await insert.onConflictDoNothing({ target: calls.retellCallId }).returning()
      : await insert.onConflictDoUpdate({ target: calls.retellCallId, set: patch }).returning();

  if (row) return row;

  // onConflictDoNothing sin cambios: devolvemos la fila existente.
  const [existing] = await db
    .select()
    .from(calls)
    .where(eq(calls.retellCallId, input.retellCallId))
    .limit(1);
  return existing;
}

export async function getCallByRetellId(retellCallId: string) {
  const rows = await db.select().from(calls).where(eq(calls.retellCallId, retellCallId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Merge parcial sobre customData (jsonb) sin sobrescribir campos existentes.
 * Útil para que tools (register_patient, book_appointment) escriban
 * { patient_name, ghl_contact_id, ghl_appointment_id } durante la llamada.
 */
export async function patchCallCustomData(
  retellCallId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await db
    .update(calls)
    .set({
      customData: sql`COALESCE(${calls.customData}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
    })
    .where(eq(calls.retellCallId, retellCallId));
}

/**
 * Helper específico: setea ghl_contact_id en la columna dedicada y
 * también lo guarda en customData para auditoria.
 */
export async function setCallGhlContact(
  retellCallId: string,
  contactId: string,
  patientName?: string,
): Promise<void> {
  const setObj: Record<string, unknown> = { ghlContactId: contactId };
  await db.update(calls).set(setObj).where(eq(calls.retellCallId, retellCallId));

  await patchCallCustomData(retellCallId, {
    ghl_contact_id: contactId,
    ...(patientName ? { patient_name: patientName } : {}),
  });
}

export async function logCallEvent(input: {
  tenantId: string;
  callId: string;
  event: string;
  payload: unknown;
}) {
  // ON CONFLICT DO NOTHING: el unique (callId, event) evita duplicados si Retell reintenta
  await db
    .insert(callEvents)
    .values({
      tenantId: input.tenantId,
      callId: input.callId,
      event: input.event,
      payload: input.payload as Record<string, unknown>,
    })
    .onConflictDoNothing();
}
