import { localDateKey } from '@/lib/tasks/tz';

export interface CompactSlot {
  start: Date;
  end: Date;
  professionalId: string;
}

/**
 * Huecos "compactos": si el profesional ya tiene citas ese día, sólo los que
 * caen como mucho `windowMinutes` antes de la primera o después de la última,
 * y primero los que quedan pegados a una cita. Así la agenda se llena por
 * bloques y no quedan horas sueltas entre medias. Un día sin citas no se
 * toca. Respeta el orden de los días.
 */
export function compactSlots<T extends CompactSlot>(
  slots: T[],
  busy: CompactSlot[],
  timezone: string,
  windowMinutes: number,
): T[] {
  const win = windowMinutes * 60_000;
  const byKey = new Map<string, CompactSlot[]>();
  for (const b of busy) {
    const key = `${b.professionalId}|${localDateKey(b.start, timezone)}`;
    const list = byKey.get(key) ?? [];
    list.push(b);
    byKey.set(key, list);
  }

  const scored: { slot: T; day: string; distance: number }[] = [];
  for (const slot of slots) {
    const day = localDateKey(slot.start, timezone);
    const around = byKey.get(`${slot.professionalId}|${day}`);
    if (!around?.length) {
      scored.push({ slot, day, distance: Number.POSITIVE_INFINITY });
      continue;
    }
    const first = Math.min(...around.map((b) => b.start.getTime()));
    const last = Math.max(...around.map((b) => b.end.getTime()));
    if (slot.start.getTime() < first - win || slot.end.getTime() > last + win) continue;
    const distance = Math.min(
      ...around.map((b) =>
        Math.max(0, b.start.getTime() - slot.end.getTime(), slot.start.getTime() - b.end.getTime()),
      ),
    );
    scored.push({ slot, day, distance });
  }

  return scored
    .sort((a, b) =>
      a.day !== b.day
        ? a.day < b.day
          ? -1
          : 1
        : a.distance !== b.distance
          ? a.distance - b.distance
          : a.slot.start.getTime() - b.slot.start.getTime(),
    )
    .map((s) => s.slot);
}
