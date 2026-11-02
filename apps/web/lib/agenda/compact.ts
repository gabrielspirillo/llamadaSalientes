import { localDateKey } from '@/lib/tasks/tz';

export interface CompactSlot {
  start: Date;
  end: Date;
  professionalId: string;
}

/**
 * Huecos "compactos": si el profesional ya tiene citas ese día, sólo los que
 * caen como mucho `windowMinutes` antes de la primera o después de la última.
 * Así la agenda se llena por bloques y no quedan horas sueltas entre medias.
 *
 * Orden (lo pidió la clínica): de cada día, primero uno "por arriba" (antes de
 * una cita) y uno "por abajo" (después), los más pegados; nunca dos por arriba
 * antes que uno por abajo. Esas dos de cada día van primero, por orden de días,
 * y luego el resto. Un día sin citas va por orden de hora.
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

  type Scored = { slot: T; distance: number; up: boolean };
  const days = new Map<string, Scored[]>();
  for (const slot of slots) {
    const day = localDateKey(slot.start, timezone);
    const list = days.get(day) ?? [];
    days.set(day, list);
    const around = byKey.get(`${slot.professionalId}|${day}`);
    if (!around?.length) {
      list.push({ slot, distance: Number.POSITIVE_INFINITY, up: true });
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
    // Por abajo: después de la última cita del día. Lo demás (antes de la
    // primera o un hueco entre dos citas) es por arriba.
    list.push({ slot, distance, up: slot.start.getTime() < last });
  }

  const byStart = (a: Scored, b: Scored) => a.slot.start.getTime() - b.slot.start.getTime();
  const byDistance = (a: Scored, b: Scored) => a.distance - b.distance || byStart(a, b);
  const firstRound: T[] = [];
  const rest: T[] = [];
  for (const day of [...days.keys()].sort()) {
    const list = days.get(day) ?? [];
    let ordered: Scored[];
    if (list.every((s) => s.distance === Number.POSITIVE_INFINITY)) {
      ordered = [...list].sort(byStart);
    } else {
      const ups = list.filter((s) => s.up).sort(byDistance);
      const downs = list.filter((s) => !s.up).sort(byDistance);
      ordered = [];
      for (let k = 0; k < Math.max(ups.length, downs.length); k++) {
        const u = ups[k];
        const d = downs[k];
        if (u) ordered.push(u);
        if (d) ordered.push(d);
      }
    }
    firstRound.push(...ordered.slice(0, 2).map((s) => s.slot));
    rest.push(...ordered.slice(2).map((s) => s.slot));
  }
  return [...firstRound, ...rest];
}
