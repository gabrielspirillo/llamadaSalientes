// Parseo y resolución de @menciones.
//
// Las funciones de parseo son PURAS y no tocan la base: se testean directo,
// igual que `lib/tasks/quick-parse.ts`. Por eso el archivo NO lleva
// 'server-only' y la lectura de miembros se importa dinámicamente sólo dentro
// de `resolveMentions()`.
//
// Regla no obvia: las menciones dentro de código (`backticks` o bloques ```)
// NO cuentan. Pegar un stack trace con un `@decorator` no puede disparar
// notificaciones a media clínica.

/** Alias que mencionan a todo el canal. */
const EVERYONE_TOKENS = new Set([
  'todos',
  'todas',
  'canal',
  'equipo',
  'everyone',
  'channel',
  'all',
  'here',
  'aqui',
]);

/** Minúsculas y sin acentos: "María" y "maria" son la misma persona. */
export function normalizeMentionKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '') // quitar diacríticos combinantes
    .toLowerCase()
    .trim();
}

/**
 * Quita bloques y tramos de código del cuerpo para que el parser no vea
 * menciones que en realidad son sintaxis.
 */
export function stripCodeSpans(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, ' ') // bloques cerrados
    .replace(/```[\s\S]*$/g, ' ') // bloque abierto sin cerrar
    .replace(/`[^`\n]*`/g, ' ') // tramos en línea cerrados
    .replace(/`[^\n]*/g, ' '); // backtick abierto: hasta fin de línea
}

/**
 * Extrae los tokens `@algo` del cuerpo. Devuelve los tokens normalizados (sin
 * repetir, sin la arroba) y si se mencionó a todo el canal.
 */
export function extractMentionTokens(body: string): {
  tokens: string[];
  everyone: boolean;
} {
  const clean = stripCodeSpans(body ?? '');
  // La arroba tiene que abrir palabra: "mail@dominio.com" no es una mención.
  const re = /(^|[^\p{L}\p{N}_@])@([\p{L}\p{N}][\p{L}\p{N}._-]*)/gu;

  const tokens: string[] = [];
  const seen = new Set<string>();
  let everyone = false;

  for (const match of clean.matchAll(re)) {
    const raw = (match[2] ?? '').replace(/[._-]+$/, '');
    if (!raw) continue;
    const key = normalizeMentionKey(raw);
    if (!key) continue;
    if (EVERYONE_TOKENS.has(key)) {
      everyone = true;
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(key);
  }

  return { tokens, everyone };
}

/**
 * Con qué claves se puede mencionar a una persona: el nombre completo sin
 * espacios, cada palabra suelta del nombre y el local part del email (entero y
 * partido por `.`/`_`/`-`).
 */
export function mentionKeysFor(person: {
  name: string;
  email: string;
}): string[] {
  const keys = new Set<string>();
  const name = normalizeMentionKey(person.name ?? '');
  if (name) {
    keys.add(name.replace(/\s+/g, ''));
    for (const word of name.split(/\s+/)) if (word) keys.add(word);
  }
  const local = normalizeMentionKey((person.email ?? '').split('@')[0] ?? '');
  if (local) {
    keys.add(local);
    keys.add(local.replace(/[._-]+/g, ''));
    for (const word of local.split(/[._-]+/)) if (word.length > 1) keys.add(word);
  }
  return [...keys];
}

/**
 * Resuelve los `@` del cuerpo contra los miembros del tenant.
 *
 * Un token ambiguo (dos "ana") se resuelve a todas las coincidencias: es
 * preferible avisar de más que dejar a alguien sin enterarse.
 */
export async function resolveMentions(
  tenantId: string,
  clerkOrgId: string,
  body: string,
): Promise<{ userIds: string[]; everyone: boolean }> {
  const { tokens, everyone } = extractMentionTokens(body ?? '');
  if (tokens.length === 0 && !everyone) return { userIds: [], everyone: false };

  let members: Array<{
    userId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  }> = [];
  try {
    const { listTenantMembersSynced } = await import('@/lib/tenant-members');
    members = await listTenantMembersSynced(tenantId, clerkOrgId);
  } catch (err) {
    console.warn('[messaging] resolveMentions: no se pudieron leer los miembros', {
      err: (err as Error).message,
    });
    return { userIds: [], everyone };
  }

  if (everyone) {
    return {
      userIds: [...new Set(members.map((m) => m.userId))],
      everyone: true,
    };
  }

  const wanted = new Set(tokens);
  const hits = new Set<string>();

  for (const m of members) {
    const name = [m.firstName, m.lastName].filter(Boolean).join(' ').trim() || m.email;
    for (const key of mentionKeysFor({ name, email: m.email })) {
      if (wanted.has(key)) {
        hits.add(m.userId);
        break;
      }
    }
  }

  return { userIds: [...hits], everyone: false };
}
