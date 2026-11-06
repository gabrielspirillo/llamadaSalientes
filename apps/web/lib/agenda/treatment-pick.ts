/**
 * Qué tratamiento le toca a un niño (clínicas con perfil de atención). Puro,
 * sin base: la ficha y el catálogo entran como datos.
 *
 * - Con historia → el seguimiento.
 * - Sin historia y con un hermano que YA VINO (o marcado como hermano) → la
 *   primera visita de HERMANO, si el catálogo la tiene. Respinens la cobra
 *   distinto ("HERMANO PEQUEÑO - PRIMERA VISITA"), y hasta el 6/11 el asistente
 *   reservaba siempre la "PRIMERA VISITA" a secas aunque la familia dijera que
 *   era el hermano.
 * - Sin historia y sin familia conocida → la primera visita normal.
 *
 * Si la familia pidió uno por su nombre y está en la lista que toca, se respeta.
 */
export type PickableTreatment = {
  name: string;
  visitKind: 'FIRST' | 'FOLLOW_UP' | string | null;
};

const isSiblingTreatment = (n: string) =>
  /herman/.test(
    n
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase(),
  );

export function pickTreatmentForChild(input: {
  hasHistory: boolean;
  familyKnown: boolean;
  requested: string | null | undefined;
  catalog: PickableTreatment[];
  /** Los de mellizos ya se resolvieron antes; aquí se excluyen del seguimiento. */
  isTwinTreatment?: (name: string) => boolean;
}): string | null {
  const twin = input.isTwinTreatment ?? (() => false);
  const req = input.requested?.trim().toLowerCase() ?? '';
  const keepIfIn = (list: PickableTreatment[]) =>
    list.find((t) => t.name.toLowerCase() === req)?.name ??
    (list.length === 1 ? (list[0]?.name ?? null) : null);

  if (input.hasHistory) {
    return keepIfIn(input.catalog.filter((t) => t.visitKind === 'FOLLOW_UP' && !twin(t.name)));
  }
  const firstKind = input.catalog.filter((t) => t.visitKind === 'FIRST');
  const siblingFirst = firstKind.filter((t) => isSiblingTreatment(t.name));
  const plainFirst = firstKind.filter((t) => !isSiblingTreatment(t.name));
  if (input.familyKnown && siblingFirst.length > 0) {
    return keepIfIn(siblingFirst) ?? keepIfIn(firstKind);
  }
  return keepIfIn(plainFirst) ?? keepIfIn(firstKind);
}
