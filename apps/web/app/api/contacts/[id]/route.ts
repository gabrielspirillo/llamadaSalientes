import { db } from '@/lib/db/client';
import { calls, leadMemory, tasks, whatsappContacts, whatsappConversations } from '@/lib/db/schema';
import { ghlFetch } from '@/lib/ghl/client';
import { getContact } from '@/lib/ghl/contacts';
import { getCurrentTenant } from '@/lib/tenant';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Expediente del paciente: junta en una sola respuesta todo lo que vive
 * disperso por los módulos —datos de GHL, llamadas con su resumen, próximas
 * citas, tareas abiertas, el hilo de WhatsApp y el resumen con IA (lead
 * memory)—. La ficha del front lo pinta como una historia clínica sin obligar
 * a saltar de pantalla.
 *
 * Llaves de cruce reales del modelo: `ghl_contact_id` (llamadas, tareas,
 * memoria) y `phone_e164` (memoria, WhatsApp). Se usan las dos porque ningún
 * dato las trae siempre ambas.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let tenantId: string;
  try {
    const ctx = await getCurrentTenant();
    tenantId = ctx.tenant.id;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const contact = await getContact(tenantId, id);
  if (!contact) {
    return NextResponse.json({ error: 'Contacto no encontrado' }, { status: 404 });
  }

  const phone = contact.phone?.trim() || null;

  // Todo lo local se pide en paralelo: es una sola pantalla, no vale encadenar.
  const [contactCalls, patientTasks, memoryRow, waConversation] = await Promise.all([
    // Llamadas del contacto (por ghl_contact_id)
    db
      .select({
        id: calls.id,
        retellCallId: calls.retellCallId,
        fromNumber: calls.fromNumber,
        toNumber: calls.toNumber,
        startedAt: calls.startedAt,
        durationSeconds: calls.durationSeconds,
        intent: calls.intent,
        sentiment: calls.sentiment,
        summary: calls.summary,
        transferred: calls.transferred,
        hasRecording: calls.recordingR2Key,
      })
      .from(calls)
      .where(and(eq(calls.tenantId, tenantId), eq(calls.ghlContactId, id)))
      .orderBy(desc(calls.startedAt))
      .limit(20),

    // Tareas del paciente, abiertas primero
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueAt: tasks.dueAt,
        completedAt: tasks.completedAt,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.tenantId, tenantId),
          eq(tasks.patientGhlContactId, id),
          isNull(tasks.archivedAt),
        ),
      )
      .orderBy(desc(tasks.createdAt))
      .limit(20),

    // Resumen con IA (lead memory): por teléfono o por ghl_contact_id
    db
      .select({
        summary: leadMemory.profileSummary,
        facts: leadMemory.facts,
        lastInteractionAt: leadMemory.lastInteractionAt,
      })
      .from(leadMemory)
      .where(
        and(
          eq(leadMemory.tenantId, tenantId),
          phone
            ? or(eq(leadMemory.phoneE164, phone), eq(leadMemory.ghlContactId, id))
            : eq(leadMemory.ghlContactId, id),
        ),
      )
      .limit(1),

    // Conversación de WhatsApp más reciente del contacto (por teléfono)
    phone
      ? db
          .select({
            id: whatsappConversations.id,
            unreadCount: whatsappConversations.unreadCount,
            lastMsgAt: whatsappConversations.lastMsgAt,
            status: whatsappConversations.status,
          })
          .from(whatsappConversations)
          .innerJoin(whatsappContacts, eq(whatsappConversations.contactId, whatsappContacts.id))
          .where(
            and(
              eq(whatsappConversations.tenantId, tenantId),
              eq(whatsappContacts.phoneE164, phone),
            ),
          )
          .orderBy(desc(whatsappConversations.lastMsgAt))
          .limit(1)
      : Promise.resolve([]),
  ]);

  // Citas del contacto desde GHL (en vivo; best-effort)
  type RawAppt = {
    id: string;
    calendarId?: string;
    startTime?: string;
    endTime?: string;
    appointmentStatus?: string;
    status?: string;
    title?: string;
  };
  let appointments: Array<{
    id: string;
    startTime: string;
    endTime?: string | null;
    status: string | null;
    title: string | null;
  }> = [];
  try {
    const data = await ghlFetch<{ events?: RawAppt[]; appointments?: RawAppt[] }>({
      tenantId,
      path: `/contacts/${id}/appointments`,
    });
    const items = data.events ?? data.appointments ?? [];
    appointments = items.map((a) => ({
      id: a.id,
      startTime: a.startTime ?? '',
      endTime: a.endTime ?? null,
      status: a.appointmentStatus ?? a.status ?? null,
      title: a.title ?? null,
    }));
  } catch (err) {
    console.error('[contact detail] GHL appointments fallo:', err);
  }

  const memory = memoryRow[0] ?? null;

  return NextResponse.json({
    contact,
    calls: contactCalls.map((c) => ({ ...c, hasRecording: !!c.hasRecording })),
    appointments,
    tasks: patientTasks,
    memory: memory
      ? {
          summary: memory.summary ?? null,
          facts: memory.facts ?? {},
          lastInteractionAt: memory.lastInteractionAt,
        }
      : null,
    whatsapp: waConversation[0] ?? null,
  });
}
