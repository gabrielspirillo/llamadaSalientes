// Contador de avisos en el título de la pestaña («(3) Agenda | Futura»). Puro,
// con tests (tests/unit/titulo-pestana.test.ts): lo usa un MutationObserver que
// escribe en lo que observa, así que escribir algo que el navegador devuelva
// distinto (p. ej. con un espacio al final) es un bucle infinito.

/** El título sin el contador «(3) » delante, sin espacios sobrantes. */
export function titleBase(title: string): string {
  return title.replace(/^\s*\(\d+\+?\)\s*/, '').trim();
}

/** «(3) Agenda | Futura»; sin avisos, el título tal cual. Nunca con espacios al final. */
export function withUnread(base: string, unread: number): string {
  const clean = base.trim();
  if (unread <= 0) return clean;
  return `(${unread > 9 ? '9+' : unread}) ${clean}`;
}
