/**
 * Guardrails del agente de WhatsApp.
 *
 * Capa de seguridad determinística (sin LLM, barata y testeable) que se aplica
 * dentro de `runWhatsappAgent`:
 *
 *  - INPUT: detección de inyección de prompts / jailbreak (OWASP LLM01). Si se
 *    dispara, el orquestador corta a handoff sin llamar al LLM.
 *  - OUTPUT: redacción de PII (teléfonos/emails) y detección de diagnóstico
 *    clínico en la respuesta. Si hay diagnóstico, se reemplaza por handoff.
 *
 * Reglas conservadoras a propósito: preferimos pocos falsos positivos. No es
 * una defensa infalible (OWASP advierte que no existe), es defensa en capas.
 */

// ─── Input: inyección de prompts / jailbreak ─────────────────────────────────

const INJECTION_PATTERNS: RegExp[] = [
  // Español
  /ignor[ae]\s+(todas?\s+)?(tus|las|mis)?\s*(instruccion|reglas|[oó]rdenes|indicaciones|directrices)/i,
  /olvid[ae]\s+(todo\s+)?(lo anterior|tus|las)?\s*(instruccion|reglas)?/i,
  /(mu[eé]stra|dime|repite|revela|cu[aá]l es|imprim[ei])\s+.{0,24}(system\s*prompt|prompt del sistema|tus instrucciones|tu prompt|tus reglas)/i,
  /a partir de ahora\s+(eres|act[uú]a|ignora)/i,
  /eres ahora\b/i,
  /sin\s+(ninguna\s+)?(restricci|l[ií]mites|filtros?|censura)/i,
  // Inglés
  /ignore\s+(all\s+)?(your|the|previous)?\s*(instructions|rules|prompt)/i,
  /disregard\s+(the|your|all|previous)\s+(instructions|rules)/i,
  /you are now\b/i,
  /reveal\s+(your\s+)?(system\s+)?prompt/i,
  // Genéricos
  /system\s*prompt/i,
  /developer\s*mode/i,
  /jailbreak/i,
  /\bDAN\b/,
];

export interface InjectionResult {
  tripped: boolean;
  matched?: string;
}

/** Detecta intentos obvios de inyección/jailbreak en texto de usuario. */
export function detectInjection(text: string): InjectionResult {
  const t = text ?? '';
  for (const re of INJECTION_PATTERNS) {
    const m = re.exec(t);
    if (m) return { tripped: true, matched: m[0].slice(0, 60) };
  }
  return { tripped: false };
}

// ─── Output: redacción de PII ─────────────────────────────────────────────────

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
// Secuencias tipo teléfono: dígitos con separadores comunes. Filtramos luego
// por cantidad de dígitos (>=9) para no tocar precios/horas/fechas.
const PHONE_LIKE_RE = /\+?\d[\d\s().-]{7,}\d/g;

export interface RedactResult {
  text: string;
  count: number;
}

/**
 * Redacta PII en la respuesta saliente: emails y números tipo teléfono
 * (>=9 dígitos). Deja los últimos 3 dígitos del teléfono para que el operador
 * pueda referenciarlo. No toca precios (2-4 díg.), horas (10:00) ni años.
 */
export function redactPii(text: string): RedactResult {
  let count = 0;
  let out = (text ?? '').replace(EMAIL_RE, () => {
    count += 1;
    return '[email oculto]';
  });
  out = out.replace(PHONE_LIKE_RE, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 9) return match; // no es teléfono (precio/hora/fecha)
    count += 1;
    return `***${digits.slice(-3)}`;
  });
  return { text: out, count };
}

// ─── Output: diagnóstico clínico ──────────────────────────────────────────────

const DIAGNOSIS_PATTERNS: RegExp[] = [
  /\btienes\s+(una?\s+)?(caries|absceso|infecci[oó]n|gingivitis|periodontitis|flem[oó]n|fractura|fisura|sarro)/i,
  /\bes\s+(una?\s+)?(caries|absceso|infecci[oó]n|gingivitis|periodontitis|flem[oó]n)\b/i,
  /\bpadeces\b/i,
  /\b(tu|el)\s+diagn[oó]stico\s+es\b/i,
  /\bprobablemente\s+(sea|tengas|tienes)\b/i,
  /\bseguramente\s+(sea|tengas|tienes|es)\b/i,
];

export interface DiagnosisResult {
  tripped: boolean;
  matched?: string;
}

/** Detecta una afirmación de diagnóstico clínico en la respuesta del agente. */
export function detectDiagnosis(text: string): DiagnosisResult {
  const t = text ?? '';
  for (const re of DIAGNOSIS_PATTERNS) {
    const m = re.exec(t);
    if (m) return { tripped: true, matched: m[0].slice(0, 60) };
  }
  return { tripped: false };
}
