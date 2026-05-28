// Cálculo de TTL para una oferta puntual:
//   - Si el slot está a < min_skip_hours_threshold ⇒ no se ofrece (skip).
//   - Si está a < near_slot_hours_threshold ⇒ TTL reducido (ttl_minutes_near_slot).
//   - En otro caso ⇒ ttl_minutes_default.
//
// Sin I/O — testeable.

export type TtlSettings = {
  ttlMinutesDefault: number;
  ttlMinutesNearSlot: number;
  nearSlotHoursThreshold: number;
  minSkipHoursThreshold: number;
};

export type TtlDecision =
  | { shouldSkip: true; reason: 'slot_too_close' | 'slot_in_past' }
  | { shouldSkip: false; ttlMinutes: number; expiresAt: Date };

export function computeTtl(
  slotStartTime: Date,
  settings: TtlSettings,
  now: Date = new Date(),
): TtlDecision {
  const msUntilSlot = slotStartTime.getTime() - now.getTime();
  if (msUntilSlot <= 0) return { shouldSkip: true, reason: 'slot_in_past' };

  const hoursUntilSlot = msUntilSlot / (60 * 60 * 1000);
  if (hoursUntilSlot < settings.minSkipHoursThreshold) {
    return { shouldSkip: true, reason: 'slot_too_close' };
  }

  let ttlMinutes =
    hoursUntilSlot < settings.nearSlotHoursThreshold
      ? settings.ttlMinutesNearSlot
      : settings.ttlMinutesDefault;

  // Nunca expirar después del slot mismo: cap al 80% del tiempo restante.
  const minutesUntilSlot = msUntilSlot / (60 * 1000);
  const maxByCap = Math.floor(minutesUntilSlot * 0.8);
  if (ttlMinutes > maxByCap) ttlMinutes = Math.max(1, maxByCap);

  return {
    shouldSkip: false,
    ttlMinutes,
    expiresAt: new Date(now.getTime() + ttlMinutes * 60 * 1000),
  };
}
