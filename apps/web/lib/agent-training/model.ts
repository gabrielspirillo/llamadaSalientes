/**
 * Modelo puro de las enseñanzas del asistente.
 *
 * Sin base de datos ni `server-only`: esto es lo que se testea y lo que
 * comparten el panel (que las pinta), el entrenador (que las propone) y el
 * prompt del asistente (que las obedece).
 */

/** Qué tipo de cosa le enseñó la clínica. */
export const LESSON_KINDS = ['ANSWER', 'RULE', 'STYLE', 'BOUNDARY'] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

export const LESSON_STATUSES = ['ACTIVE', 'PAUSED'] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export const LESSON_SOURCES = ['COACH', 'MANUAL'] as const;
export type LessonSource = (typeof LESSON_SOURCES)[number];

export function isLessonKind(v: unknown): v is LessonKind {
  return typeof v === 'string' && (LESSON_KINDS as readonly string[]).includes(v);
}

/** Etiquetas del panel. En la UI nadie lee "BOUNDARY". */
export const LESSON_KIND_LABEL: Record<LessonKind, string> = {
  ANSWER: 'Qué responder',
  RULE: 'Cómo actuar',
  STYLE: 'Tono y trato',
  BOUNDARY: 'Lo que no debe hacer',
};

export const LESSON_KIND_HINT: Record<LessonKind, string> = {
  ANSWER: 'La respuesta a una pregunta concreta de un paciente o un interesado.',
  RULE: 'Qué hacer en una situación: cuándo ofrecer una valoración, cuándo pasar a recepción.',
  STYLE: 'Cómo habla: más cercano, más breve, cómo se presenta.',
  BOUNDARY: 'Lo que nunca debe decir ni prometer.',
};

/** Color del chip por tipo, dentro de la paleta Aurora. */
export const LESSON_KIND_TONE: Record<LessonKind, 'info' | 'success' | 'warn' | 'danger'> = {
  ANSWER: 'info',
  RULE: 'success',
  STYLE: 'warn',
  BOUNDARY: 'danger',
};

/** Lo mínimo que el prompt del asistente necesita de una enseñanza. */
export interface LessonLine {
  kind: LessonKind;
  title: string;
  situation: string | null;
  instruction: string;
}

/** Una enseñanza propuesta por el entrenador y todavía sin aprobar. */
export interface LessonProposal extends LessonLine {
  /** Id local del turno: identifica la tarjeta hasta que se aprueba. */
  ref: string;
  /** Id de la enseñanza ya creada, si la clínica la aprobó. */
  lessonId?: string | null;
  /** La clínica la descartó. Se deja visible, tachada, pero no vuelve a ofrecerse. */
  dismissed?: boolean;
}

export const MAX_LESSON_TITLE = 120;
export const MAX_LESSON_INSTRUCTION = 800;
export const MAX_LESSON_SITUATION = 200;

/** Cuántas enseñanzas activas entran en el prompt del asistente. */
export const MAX_LESSONS_IN_PROMPT = 60;

function trimTo(value: string, max: number): string {
  const v = value.replace(/\s+/g, ' ').trim();
  return v.length > max ? `${v.slice(0, max - 1).trimEnd()}…` : v;
}

/**
 * Normaliza lo que devuelve el LLM entrenador. El modelo se salta el esquema
 * de vez en cuando (manda un tipo que no existe, un título de tres líneas, un
 * array vacío), y eso no puede llegar ni a la base ni a la pantalla.
 */
export function parseProposals(raw: unknown, refPrefix: string): LessonProposal[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: LessonProposal[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const instruction = typeof o.instruction === 'string' ? o.instruction.trim() : '';
    if (instruction.length < 5) continue;
    const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : instruction;
    const situation = typeof o.situation === 'string' && o.situation.trim() ? o.situation : null;
    out.push({
      ref: `${refPrefix}-${out.length}`,
      kind: isLessonKind(o.kind) ? o.kind : 'RULE',
      title: trimTo(title, MAX_LESSON_TITLE),
      situation: situation ? trimTo(situation, MAX_LESSON_SITUATION) : null,
      instruction: trimTo(instruction, MAX_LESSON_INSTRUCTION),
      lessonId: null,
      dismissed: false,
    });
    // Un turno propone un puñado de cosas, no veinte: aprobar de a una deja de
    // tener sentido si la lista no cabe en pantalla.
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * La sección del system prompt del asistente con lo que le enseñó la clínica.
 *
 * Devuelve cadena vacía cuando no hay nada: una clínica que no entrenó a su
 * asistente tiene exactamente el prompt de siempre.
 */
export function formatLessonsForPrompt(lessons: readonly LessonLine[]): string {
  if (lessons.length === 0) return '';
  const byKind = (kind: LessonKind) => lessons.filter((l) => l.kind === kind);
  const bloque = (kind: LessonKind, encabezado: string): string => {
    const rows = byKind(kind);
    if (rows.length === 0) return '';
    const lines = rows
      .slice(0, MAX_LESSONS_IN_PROMPT)
      .map((l) => `- ${l.situation ? `Cuando ${l.situation}: ` : ''}${l.instruction}`)
      .join('\n');
    return `\n${encabezado}\n${lines}`;
  };

  return `

# LO QUE TE HA ENSEÑADO LA CLÍNICA — manda sobre todo lo anterior
Esto lo ha escrito el equipo de la clínica corrigiéndote. Es lo último que lees
y es la última palabra sobre CÓMO te comportas: si algo de aquí cambia lo que
dicen las secciones de arriba —el saludo, las frases de ejemplo, el orden en que
preguntas, qué ofreces o cómo cierras—, haz lo que dice aquí y NO lo de arriba.
Una frase de ejemplo de más arriba no es una orden: estas instrucciones sí.
Sólo tres cosas siguen por encima de esto: los DATOS OFICIALES (precios,
horarios, agenda, tratamientos y profesionales, que se consultan, no se
inventan), el protocolo de urgencias y el paso a recepción, y no diagnosticar
ni prometer resultados.${bloque('ANSWER', 'Qué responder:')}${bloque(
    'RULE',
    'Cómo actuar:',
  )}${bloque('STYLE', 'Tono y trato:')}${bloque('BOUNDARY', 'Lo que NO debes hacer ni decir:')}`;
}
