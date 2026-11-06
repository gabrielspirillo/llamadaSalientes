/**
 * Revisión automática de cada respuesta del asistente de WhatsApp. Puro, sin
 * base: se aplica sobre lo que ya guarda `whatsapp_agent_runs` (lo que entró,
 * lo que salió, las herramientas con su resultado, los guardrails) y señala
 * lo que un humano miraría primero. Es lo que Futura ve en
 * /dashboard/futura/asistente para encontrar los fallos sin leer cada chat.
 *
 * Cada aviso es una heurística con nombre: ni diagnostica ni juzga, sólo
 * apunta. Un aviso que se dispara mucho sin ser un fallo se afina aquí.
 */

export type ReviewLevel = 'ok' | 'warn' | 'error';

export interface ReviewFlag {
  code: string;
  label: string;
  level: 'info' | 'warn' | 'error';
  detail?: string;
}

export interface ReviewInput {
  userText: string | null;
  responseText: string | null;
  tools: { name: string; ok: boolean; result?: string | null; error?: string | null }[];
  errorText: string | null;
  /** `intent_reasoning` del run: "guardrail: a; b". */
  intentReasoning: string | null;
  latencyMs: number;
  handoff: boolean;
  fallbackUsed: boolean;
}

export interface ReviewResult {
  level: ReviewLevel;
  flags: ReviewFlag[];
}

const SLOW_MS = 20_000;
const LONG_CHARS = 900;

/** Herramienta que no hizo lo que se le pidió (resultado que empieza en negación). */
const TOOL_REFUSED =
  /^(no\b|no se pudo|no entiendo|no encontr|no hay|no tengo|no te la|nadie|falta|faltan|esa (hora|fecha)|la clínica no abre|la clinica no abre)/i;

/** Guardrails que son señal de fallo o de ataque, no de guion aplicado. */
const GUARDRAIL_LEVEL: Record<string, 'warn' | 'info'> = {
  input_injection: 'warn',
  output_diagnosis: 'warn',
  first_visit_forced: 'warn',
  sibling_forced: 'warn',
  birth_date_from_text: 'warn',
  admin_only: 'info',
};

export function parseGuardrails(intentReasoning: string | null): string[] {
  const m = /^guardrail:\s*(.+)$/s.exec((intentReasoning ?? '').trim());
  if (!m) return [];
  return (m[1] ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function reviewRun(input: ReviewInput): ReviewResult {
  const flags: ReviewFlag[] = [];
  const response = (input.responseText ?? '').trim();
  const user = (input.userText ?? '').trim();

  if (input.errorText) {
    flags.push({
      code: 'error',
      label: 'Falló la respuesta',
      level: 'error',
      detail: input.errorText,
    });
  }
  if (!response && !input.handoff && !input.errorText) {
    flags.push({ code: 'empty', label: 'Sin respuesta', level: 'error' });
  }
  for (const t of input.tools) {
    if (!t.ok) {
      flags.push({
        code: `tool_error:${t.name}`,
        label: `${t.name} falló`,
        level: 'error',
        detail: t.error ?? undefined,
      });
      continue;
    }
    const r = (t.result ?? '').trim();
    if (TOOL_REFUSED.test(r)) {
      flags.push({
        code: `tool_refused:${t.name}`,
        label: `${t.name}: no se pudo`,
        level: 'warn',
        detail: r.slice(0, 160),
      });
    }
  }
  for (const g of parseGuardrails(input.intentReasoning)) {
    const key = g.split(':')[0] ?? g;
    const level = GUARDRAIL_LEVEL[key] ?? 'info';
    flags.push({ code: `guardrail:${key}`, label: g, level });
  }
  if (input.latencyMs > SLOW_MS) {
    flags.push({
      code: 'slow',
      label: `Lenta (${Math.round(input.latencyMs / 1000)} s)`,
      level: 'warn',
    });
  }
  if (input.fallbackUsed) {
    flags.push({ code: 'fallback', label: 'Modelo de respaldo', level: 'info' });
  }
  if (input.handoff) {
    flags.push({ code: 'handoff', label: 'Pasa a recepción', level: 'info' });
  }
  if (
    /\b(tienes|tenéis|tenés) razón\b|\bperdona\b|\bdisculpa\b|\blo siento\b|\bme he equivocado\b/i.test(
      response,
    )
  ) {
    flags.push({ code: 'apology', label: 'Pide perdón o da la razón', level: 'warn' });
  }
  if (
    /\bno me queda nada\b/i.test(response) &&
    /no abre|no abrimos|cerrad/i.test(toolsText(input))
  ) {
    flags.push({ code: 'closed_day', label: '"No me queda nada" en día cerrado', level: 'warn' });
  }
  if (/\b(s[aá]bado|domingo)\b/i.test(response) && /no abre|cerrad/i.test(toolsText(input))) {
    flags.push({ code: 'mentions_closed', label: 'Menciona un día cerrado', level: 'warn' });
  }
  if ((response.match(/\?/g) ?? []).length >= 3) {
    flags.push({ code: 'many_questions', label: 'Tres o más preguntas', level: 'warn' });
  }
  if (response.length > LONG_CHARS) {
    flags.push({ code: 'long', label: `Muy larga (${response.length} caracteres)`, level: 'warn' });
  }
  if (
    /\bno entiendo\b|\bno es eso\b|\bte he dicho\b|\bya te (he )?dicho\b|\bno me refiero\b|\bno,? no\b|\bte lo he dicho\b/i.test(
      user,
    )
  ) {
    flags.push({ code: 'complaint', label: 'La familia se queja o corrige', level: 'warn' });
  }
  if (/https?:\/\/|www\./i.test(response)) {
    flags.push({ code: 'web', label: 'Manda a la web', level: 'info' });
  }

  const level: ReviewLevel = flags.some((f) => f.level === 'error')
    ? 'error'
    : flags.some((f) => f.level === 'warn')
      ? 'warn'
      : 'ok';
  return { level, flags };
}

function toolsText(input: ReviewInput): string {
  return input.tools.map((t) => t.result ?? '').join('\n');
}
