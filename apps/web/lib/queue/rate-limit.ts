import 'server-only';

import { getRedis } from '@/lib/queue/connection';

/**
 * Contador con ventana fija en Redis.
 *
 * Sirve para endpoints públicos que cuestan dinero. Un rate-limit por número
 * de teléfono, que era lo único que había en la demo, no protege de nada:
 * rotando números se vacía el saldo de Retell/Zadarma y se usa el sistema para
 * llamar a terceros con el caller ID de la clínica.
 *
 * Falla ABIERTO si Redis no está: preferimos servir la demo a caernos, pero se
 * loguea para que no pase inadvertido.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const redis = getRedis();
    const bucket = `ratelimit:${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
    const count = await redis.incr(bucket);
    if (count === 1) await redis.expire(bucket, windowSeconds);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  } catch (err) {
    console.warn('[rate-limit] Redis no disponible, se deja pasar', {
      key,
      err: (err as Error).message,
    });
    return { allowed: true, remaining: limit };
  }
}

/** IP del cliente detrás de Traefik. */
export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  const forwarded = req.headers.get('x-forwarded-for') ?? '';
  const first = forwarded.split(',')[0]?.trim();
  return first || req.headers.get('x-real-ip') || 'unknown';
}
