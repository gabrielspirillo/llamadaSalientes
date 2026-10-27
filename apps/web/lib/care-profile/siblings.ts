// Hermanos y gemelos en la agenda (Respinens). Puro, con tests.
//
// En su agenda de papel la clínica marca con una "H" a los hermanos y distingue
// a los gemelos/mellizos: de un vistazo sabe que vienen juntos y que comparten
// familia. Aquí se calcula:
//
// - Familia = pacientes que comparten contacto (`contact_id`), el teléfono de
//   algún tutor (por sus nueve últimos dígitos) o LOS DOS APELLIDOS. Lo
//   último hacía falta: unos mellizos con el móvil de la madre en uno y el del
//   padre en otro no salían como familia (Respinens, 22/10).
// - El tratamiento también manda: "GEMELOS / MELLIZOS" es G/M y "HERMANOS" es
//   H aunque el cálculo no llegue (`familyTagFromTreatment`).
// - G/M = hermano con la MISMA fecha de nacimiento. Se muestra siempre.
// - H = hermano de alguien que YA vino a la clínica antes de esa cita: la
//   familia ya nos conoce ("primera visita de hermano"). No tiene nada que ver
//   con que vengan el mismo día (así lo aclaró la clínica el 19/10).
// - `siblingMark` lo fuerza a mano cuando el cálculo no llega (falta la fecha
//   de nacimiento, teléfonos distintos): TWIN → G/M, SIBLING → H, NONE → nada.

export type FamilyTag = 'GM' | 'H';
export type SiblingMark = 'TWIN' | 'SIBLING' | 'NONE';

export interface FamilyPatient {
  id: string;
  contactId: string | null;
  /** Teléfonos de la ficha: el del contacto y los de los tutores. */
  phones: string[];
  birthDate: string | null;
  /** Apellidos tal cual en la ficha: con los dos, identifican a la familia. */
  lastName?: string | null;
  siblingMark: SiblingMark | null;
  /** Día (YYYY-MM-DD local) de su primera cita no anulada ni faltada; null si nunca vino. */
  firstVisitDate: string | null;
}

/** Los apellidos sin tildes ni mayúsculas, sólo si son dos o más palabras. */
export function surnamesKey(lastName: string | null | undefined): string | null {
  const words = (lastName ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-zñ\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
  return words.length >= 2 ? words.join(' ') : null;
}

/** La etiqueta que dicta el tratamiento de la cita, si lo dice. */
export function familyTagFromTreatment(name: string | null | undefined): FamilyTag | null {
  const n = (name ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  if (/gemel|melliz/.test(n)) return 'GM';
  if (/herman/.test(n)) return 'H';
  return null;
}

function phoneTail(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : null;
}

/** Agrupa a los pacientes por familia. Devuelve, para cada id, los ids de sus hermanos. */
export function groupFamilies(patients: FamilyPatient[]): Map<string, string[]> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    let cur = x;
    while (cur !== root) {
      const next = parent.get(cur) ?? root;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const p of patients) {
    const node = `pat:${p.id}`;
    if (!parent.has(node)) parent.set(node, node);
    if (p.contactId) union(node, `c:${p.contactId}`);
    for (const phone of p.phones) {
      const tail = phoneTail(phone);
      if (tail) union(node, `t:${tail}`);
    }
    const surnames = surnamesKey(p.lastName);
    if (surnames) union(node, `s:${surnames}`);
  }

  const byRoot = new Map<string, string[]>();
  for (const p of patients) {
    const root = find(`pat:${p.id}`);
    byRoot.set(root, [...(byRoot.get(root) ?? []), p.id]);
  }
  const out = new Map<string, string[]>();
  for (const members of byRoot.values()) {
    for (const id of members)
      out.set(
        id,
        members.filter((m) => m !== id),
      );
  }
  return out;
}

/** La etiqueta de una cita del paciente el día `dateKey` (YYYY-MM-DD local). */
export function familyTagFor(
  patient: FamilyPatient,
  dateKey: string,
  siblings: FamilyPatient[],
): FamilyTag | null {
  if (patient.siblingMark === 'NONE') return null;
  if (patient.siblingMark === 'TWIN') return 'GM';
  if (patient.siblingMark === 'SIBLING') return 'H';
  if (siblings.length === 0) return null;
  if (patient.birthDate && siblings.some((s) => s.birthDate === patient.birthDate)) return 'GM';
  if (siblings.some((s) => s.firstVisitDate !== null && s.firstVisitDate < dateKey)) return 'H';
  return null;
}

/**
 * Lo que pinta el chip del calendario: si es primera visita y qué etiqueta de
 * familia lleva. El tratamiento manda sobre el cálculo ("GEMELOS / MELLIZOS"
 * es G/M aunque la cita no esté atada a las fichas; "…HERMANOS…" es H), y
 * G/M nunca sale como primera visita.
 */
export function appointmentTypeTag(input: {
  isFirstVisit: boolean;
  treatmentName: string | null | undefined;
  /** El de `familyTagFor`, o null si la cita no tiene ficha. */
  familyTag: FamilyTag | null;
}): { firstVisit: boolean; familyTag: FamilyTag | null } {
  const familyTag = familyTagFromTreatment(input.treatmentName) ?? input.familyTag;
  // Un mellizo nunca es "1ª visita" a ojos de la clínica, venga la G/M del
  // tratamiento o de la ficha (misma familia y misma fecha de nacimiento).
  return { firstVisit: input.isFirstVisit && familyTag !== 'GM', familyTag };
}
