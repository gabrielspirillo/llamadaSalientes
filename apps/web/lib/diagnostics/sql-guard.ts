/**
 * Qué consultas acepta la puerta de diagnóstico (`/api/internal/diagnostico`).
 * Puro, con tests. La primera defensa es la transacción de solo lectura del
 * endpoint; esto cierra lo que una transacción de solo lectura no cierra:
 * varias sentencias (un "commit; delete…" saldría de la transacción) y las
 * funciones de administración que funcionan aunque no se escriba nada.
 */

const FORBIDDEN =
  /\b(pg_terminate_backend|pg_cancel_backend|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|pg_sleep|pg_reload_conf|pg_rotate_logfile|set_config|lo_import|lo_export|lo_get|dblink\w*|copy|pg_advisory_\w*|pg_notify)\b/i;

export type SqlGuardResult = { ok: true; query: string } | { ok: false; reason: string };

export function guardDiagnosticQuery(raw: unknown): SqlGuardResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'Falta "query" (texto).' };
  // Fuera comentarios: un "--" o "/* */" puede esconder una segunda sentencia.
  const query = raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim()
    .replace(/;\s*$/, '')
    .trim();
  if (!query) return { ok: false, reason: 'La consulta está vacía.' };
  if (query.length > 20_000) return { ok: false, reason: 'La consulta es demasiado larga.' };
  if (!/^(select|with)\b/i.test(query)) {
    return { ok: false, reason: 'Sólo se aceptan consultas SELECT (o WITH … SELECT).' };
  }
  if (query.includes(';')) return { ok: false, reason: 'Una sola sentencia, sin ";".' };
  const banned = FORBIDDEN.exec(query);
  if (banned) return { ok: false, reason: `Función no permitida: ${banned[1]}.` };
  return { ok: true, query };
}
