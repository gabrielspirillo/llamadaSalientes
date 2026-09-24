import 'server-only';

import { db } from '@/lib/db/client';
import { agentLessons, agentTrainingMessages } from '@/lib/db/schema';
import { and, desc, eq, isNotNull } from 'drizzle-orm';

import {
  type LessonKind,
  type LessonLine,
  type LessonProposal,
  type LessonSource,
  type LessonStatus,
  MAX_LESSONS_IN_PROMPT,
  isLessonKind,
} from './model';

export interface AgentLesson {
  id: string;
  kind: LessonKind;
  title: string;
  situation: string | null;
  instruction: string;
  status: LessonStatus;
  source: LessonSource;
  questId: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toLesson(row: typeof agentLessons.$inferSelect): AgentLesson {
  return {
    id: row.id,
    // Una fila con un tipo que ya no existe (o que alguien metió a mano) no
    // puede romper la página: cae al genérico.
    kind: isLessonKind(row.kind) ? row.kind : 'RULE',
    title: row.title,
    situation: row.situation,
    instruction: row.instruction,
    status: row.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE',
    source: row.source === 'MANUAL' ? 'MANUAL' : 'COACH',
    questId: row.questId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Todas las enseñanzas de la clínica, activas y en pausa. Para el panel. */
export async function listLessons(tenantId: string): Promise<AgentLesson[]> {
  const rows = await db
    .select()
    .from(agentLessons)
    .where(eq(agentLessons.tenantId, tenantId))
    .orderBy(desc(agentLessons.createdAt))
    .limit(300);
  return rows.map(toLesson);
}

/**
 * Lo que entra en el prompt del asistente: sólo lo activo, y con tope.
 *
 * El tope no es decorativo: cada enseñanza son tokens en TODAS las ráfagas de
 * TODAS las conversaciones, y una clínica que entrena mucho acabaría pagando
 * un prompt de diez páginas. Entran las más recientes.
 */
export async function listLessonLines(tenantId: string): Promise<LessonLine[]> {
  const rows = await db
    .select({
      kind: agentLessons.kind,
      title: agentLessons.title,
      situation: agentLessons.situation,
      instruction: agentLessons.instruction,
    })
    .from(agentLessons)
    .where(and(eq(agentLessons.tenantId, tenantId), eq(agentLessons.status, 'ACTIVE')))
    .orderBy(desc(agentLessons.createdAt))
    .limit(MAX_LESSONS_IN_PROMPT);
  return rows.map((r) => ({
    kind: isLessonKind(r.kind) ? r.kind : 'RULE',
    title: r.title,
    situation: r.situation,
    instruction: r.instruction,
  }));
}

export async function getLessonById(tenantId: string, id: string): Promise<AgentLesson | null> {
  const rows = await db
    .select()
    .from(agentLessons)
    .where(and(eq(agentLessons.tenantId, tenantId), eq(agentLessons.id, id)))
    .limit(1);
  const row = rows[0];
  return row ? toLesson(row) : null;
}

export async function createLesson(input: {
  tenantId: string;
  kind: LessonKind;
  title: string;
  situation: string | null;
  instruction: string;
  source: LessonSource;
  questId?: string | null;
  createdBy: string | null;
}): Promise<AgentLesson> {
  const [row] = await db
    .insert(agentLessons)
    .values({
      tenantId: input.tenantId,
      kind: input.kind,
      title: input.title,
      situation: input.situation,
      instruction: input.instruction,
      source: input.source,
      questId: input.questId ?? null,
      createdBy: input.createdBy,
    })
    .returning();
  // El insert acaba de correr: si no devolvió fila, la base está rota y no hay
  // nada sensato que devolver.
  if (!row) throw new Error('No se ha podido guardar la enseñanza');
  return toLesson(row);
}

export async function updateLesson(
  tenantId: string,
  id: string,
  patch: {
    kind?: LessonKind;
    title?: string;
    situation?: string | null;
    instruction?: string;
    status?: LessonStatus;
  },
): Promise<AgentLesson | null> {
  const [row] = await db
    .update(agentLessons)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(agentLessons.tenantId, tenantId), eq(agentLessons.id, id)))
    .returning();
  return row ? toLesson(row) : null;
}

export async function deleteLesson(tenantId: string, id: string): Promise<void> {
  await db
    .delete(agentLessons)
    .where(and(eq(agentLessons.tenantId, tenantId), eq(agentLessons.id, id)));
}

/**
 * Los retos que esta clínica ya aplicó, activos o en pausa.
 *
 * Cuentan también los pausados: la clínica decidió que ese consejo no le vale,
 * y volvérselo a recomendar es no escucharla.
 */
export async function listAppliedQuestIds(tenantId: string): Promise<string[]> {
  const rows = await db
    .select({ questId: agentLessons.questId })
    .from(agentLessons)
    .where(and(eq(agentLessons.tenantId, tenantId), isNotNull(agentLessons.questId)))
    .limit(200);
  return rows.map((r) => r.questId).filter((id): id is string => Boolean(id));
}

export async function countActiveLessons(tenantId: string): Promise<number> {
  const rows = await db
    .select({ id: agentLessons.id })
    .from(agentLessons)
    .where(and(eq(agentLessons.tenantId, tenantId), eq(agentLessons.status, 'ACTIVE')))
    .limit(MAX_LESSONS_IN_PROMPT + 1);
  return rows.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversación con el entrenador
// ─────────────────────────────────────────────────────────────────────────────

export interface TrainingMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  proposals: LessonProposal[];
  authorName: string | null;
  createdAt: Date;
}

/** Cuántos turnos se le reenvían al entrenador como contexto. */
export const TRAINING_HISTORY_TURNS = 16;

function toTrainingMessage(row: typeof agentTrainingMessages.$inferSelect): TrainingMessage {
  const raw = row.proposals;
  return {
    id: row.id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    proposals: Array.isArray(raw) ? (raw as LessonProposal[]) : [],
    authorName: row.authorName,
    createdAt: row.createdAt,
  };
}

export async function listTrainingMessages(
  tenantId: string,
  limit = 80,
): Promise<TrainingMessage[]> {
  const rows = await db
    .select()
    .from(agentTrainingMessages)
    .where(eq(agentTrainingMessages.tenantId, tenantId))
    .orderBy(desc(agentTrainingMessages.createdAt))
    .limit(limit);
  // Se piden los últimos y se devuelven en orden de lectura.
  return rows.reverse().map(toTrainingMessage);
}

/** Los últimos turnos, en orden cronológico, para el contexto del entrenador. */
export async function listRecentTrainingTurns(
  tenantId: string,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const rows = await db
    .select({ role: agentTrainingMessages.role, content: agentTrainingMessages.content })
    .from(agentTrainingMessages)
    .where(eq(agentTrainingMessages.tenantId, tenantId))
    .orderBy(desc(agentTrainingMessages.createdAt))
    .limit(TRAINING_HISTORY_TURNS);
  return rows.reverse().map((r) => ({
    role: r.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: r.content,
  }));
}

export async function appendTrainingMessage(input: {
  tenantId: string;
  role: 'user' | 'assistant';
  content: string;
  proposals?: LessonProposal[];
  authorName?: string | null;
}): Promise<TrainingMessage> {
  const [row] = await db
    .insert(agentTrainingMessages)
    .values({
      tenantId: input.tenantId,
      role: input.role,
      content: input.content,
      proposals: input.proposals?.length ? input.proposals : null,
      authorName: input.authorName ?? null,
    })
    .returning();
  if (!row) throw new Error('No se ha podido guardar el mensaje');
  return toTrainingMessage(row);
}

/**
 * Marca una propuesta como resuelta (aplicada o descartada) dentro del turno
 * donde se propuso.
 *
 * Sin esto, recargar la página devolvía la tarjeta a "pendiente" y la misma
 * enseñanza se aprobaba dos veces.
 */
export async function markProposalResolved(input: {
  tenantId: string;
  messageId: string;
  ref: string;
  lessonId?: string | null;
  dismissed?: boolean;
}): Promise<void> {
  const rows = await db
    .select({ proposals: agentTrainingMessages.proposals })
    .from(agentTrainingMessages)
    .where(
      and(
        eq(agentTrainingMessages.tenantId, input.tenantId),
        eq(agentTrainingMessages.id, input.messageId),
      ),
    )
    .limit(1);
  const current = rows[0]?.proposals;
  if (!Array.isArray(current)) return;
  const next = (current as LessonProposal[]).map((p) =>
    p.ref === input.ref
      ? { ...p, lessonId: input.lessonId ?? null, dismissed: input.dismissed ?? false }
      : p,
  );
  await db
    .update(agentTrainingMessages)
    .set({ proposals: next })
    .where(
      and(
        eq(agentTrainingMessages.tenantId, input.tenantId),
        eq(agentTrainingMessages.id, input.messageId),
      ),
    );
}

export async function clearTrainingMessages(tenantId: string): Promise<void> {
  await db.delete(agentTrainingMessages).where(eq(agentTrainingMessages.tenantId, tenantId));
}
