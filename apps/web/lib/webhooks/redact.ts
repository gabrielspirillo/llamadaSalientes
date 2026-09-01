import 'server-only';

/**
 * Quita del payload los campos que no deben quedar en claro en `webhook_logs`.
 *
 * La transcripción de una llamada se guarda cifrada en `calls.transcript_enc`
 * precisamente porque es un dato de salud. Volcarla sin cifrar en el log de
 * auditoría (que además no lleva tenant_id y se escribe ANTES de validar la
 * firma) anulaba ese cifrado y dejaba la conversación entera en una tabla que
 * nadie purga.
 *
 * Se conserva el resto del payload, que es lo que sirve para auditar: ids,
 * timestamps, estados y errores.
 */
const REDACTED_KEYS = new Set([
  'transcript',
  'transcript_object',
  'transcript_with_tool_calls',
  'recording_url',
  'public_log_url',
  'call_analysis',
]);

const MAX_DEPTH = 6;

export function redactWebhookPayload(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((v) => redactWebhookPayload(v, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACTED_KEYS.has(k)) {
      out[k] = typeof v === 'string' ? `[redactado ${v.length} chars]` : '[redactado]';
      continue;
    }
    out[k] = redactWebhookPayload(v, depth + 1);
  }
  return out;
}
