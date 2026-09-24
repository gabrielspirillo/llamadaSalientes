'use server';

import {
  createLesson,
  deleteLesson,
  getLessonById,
  markProposalResolved,
  updateLesson,
} from '@/lib/agent-training/lessons';
import { clearTrainingMessages } from '@/lib/agent-training/lessons';
import {
  LESSON_KINDS,
  MAX_LESSON_INSTRUCTION,
  MAX_LESSON_SITUATION,
  MAX_LESSON_TITLE,
} from '@/lib/agent-training/model';
import { recordAudit } from '@/lib/audit';
import { requireTaskRole } from '@/lib/tasks/auth';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

export type ActionResult = { ok: true } | { ok: false; error: string };

const RUTA = '/dashboard/entrenamiento';

const lessonSchema = z.object({
  kind: z.enum(LESSON_KINDS),
  title: z.string().trim().min(3, 'Ponle un título').max(MAX_LESSON_TITLE),
  situation: z.string().trim().max(MAX_LESSON_SITUATION).optional().nullable(),
  instruction: z
    .string()
    .trim()
    .min(5, 'Escribe qué tiene que hacer el asistente')
    .max(MAX_LESSON_INSTRUCTION),
});

/**
 * Quién puede entrenar al asistente: `operator` en adelante.
 *
 * Es el mismo listón que el banco de pruebas y que cargar tratamientos o
 * FAQs: quien atiende a los pacientes es quien ve al asistente equivocarse, y
 * hacerle pedir permiso a un admin para corregir una frase garantiza que
 * nadie lo corrija. Un `viewer` y un profesional con acceso sólo a su agenda
 * quedan fuera (lo cierra `requireTaskRole`).
 */
async function guard() {
  // `requireTaskRole` ya resuelve el tenant en curso (el impersonado, si
  // Futura está dentro de una clínica) y devuelve el id INTERNO del usuario,
  // que es lo que referencia `audit_logs.actor_user_id`.
  return requireTaskRole('operator');
}

function fail(err: unknown): ActionResult {
  const message = err instanceof Error ? err.message : 'No se ha podido completar';
  return { ok: false, error: message };
}

/** Aplica una propuesta del entrenador: la convierte en enseñanza activa. */
export async function applyProposalAction(input: {
  messageId: string;
  ref: string;
  kind: string;
  title: string;
  situation: string | null;
  instruction: string;
}): Promise<ActionResult> {
  try {
    const { tenantId, userId } = await guard();
    const parsed = lessonSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
    }

    const created = await createLesson({
      tenantId,
      kind: parsed.data.kind,
      title: parsed.data.title,
      situation: parsed.data.situation?.trim() || null,
      instruction: parsed.data.instruction,
      source: 'COACH',
      createdBy: userId,
    });

    await markProposalResolved({
      tenantId,
      messageId: input.messageId,
      ref: input.ref,
      lessonId: created.id,
    });

    await recordAudit({
      tenantId,
      actorUserId: userId,
      action: 'create',
      entity: 'agent_lesson',
      entityId: created.id,
      after: created,
    });

    revalidatePath(RUTA);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Descarta una propuesta. No crea nada; deja la tarjeta marcada. */
export async function dismissProposalAction(input: {
  messageId: string;
  ref: string;
}): Promise<ActionResult> {
  try {
    const { tenantId } = await guard();
    await markProposalResolved({
      tenantId,
      messageId: input.messageId,
      ref: input.ref,
      dismissed: true,
    });
    revalidatePath(RUTA);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Alta a mano, desde "Lo aprendido". */
export async function createLessonAction(formData: FormData): Promise<ActionResult> {
  try {
    const { tenantId, userId } = await guard();
    const parsed = lessonSchema.safeParse({
      kind: formData.get('kind'),
      title: formData.get('title'),
      situation: formData.get('situation'),
      instruction: formData.get('instruction'),
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
    }

    const created = await createLesson({
      tenantId,
      kind: parsed.data.kind,
      title: parsed.data.title,
      situation: parsed.data.situation?.trim() || null,
      instruction: parsed.data.instruction,
      source: 'MANUAL',
      createdBy: userId,
    });

    await recordAudit({
      tenantId,
      actorUserId: userId,
      action: 'create',
      entity: 'agent_lesson',
      entityId: created.id,
      after: created,
    });

    revalidatePath(RUTA);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function updateLessonAction(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const { tenantId, userId } = await guard();
    const parsed = lessonSchema.safeParse({
      kind: formData.get('kind'),
      title: formData.get('title'),
      situation: formData.get('situation'),
      instruction: formData.get('instruction'),
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
    }

    const before = await getLessonById(tenantId, id);
    if (!before) return { ok: false, error: 'Esa enseñanza ya no existe' };

    const after = await updateLesson(tenantId, id, {
      kind: parsed.data.kind,
      title: parsed.data.title,
      situation: parsed.data.situation?.trim() || null,
      instruction: parsed.data.instruction,
    });

    await recordAudit({
      tenantId,
      actorUserId: userId,
      action: 'update',
      entity: 'agent_lesson',
      entityId: id,
      before,
      after,
    });

    revalidatePath(RUTA);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Pausa o reactiva. Pausada sigue guardada pero el asistente no la ve. */
export async function toggleLessonAction(id: string): Promise<ActionResult> {
  try {
    const { tenantId, userId } = await guard();
    const before = await getLessonById(tenantId, id);
    if (!before) return { ok: false, error: 'Esa enseñanza ya no existe' };

    const after = await updateLesson(tenantId, id, {
      status: before.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
    });

    await recordAudit({
      tenantId,
      actorUserId: userId,
      action: 'update',
      entity: 'agent_lesson',
      entityId: id,
      before,
      after,
    });

    revalidatePath(RUTA);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteLessonAction(id: string): Promise<ActionResult> {
  try {
    const { tenantId, userId } = await guard();
    const before = await getLessonById(tenantId, id);
    if (!before) return { ok: false, error: 'Esa enseñanza ya no existe' };

    await deleteLesson(tenantId, id);

    await recordAudit({
      tenantId,
      actorUserId: userId,
      action: 'delete',
      entity: 'agent_lesson',
      entityId: id,
      before,
    });

    revalidatePath(RUTA);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Vacía la conversación con el entrenador. Las enseñanzas ya aplicadas NO se
 * tocan: son dos cosas distintas y borrar la charla no puede deshacer lo que
 * el asistente ya aprendió.
 */
export async function clearTrainingChatAction(): Promise<ActionResult> {
  try {
    const { tenantId } = await guard();
    await clearTrainingMessages(tenantId);
    revalidatePath(RUTA);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
