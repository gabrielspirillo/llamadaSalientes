// Hermanos y gemelos en la agenda (Respinens). Puro, con tests.
//
// En su agenda de papel la clínica marca con una "H" a los hermanos y distingue
// a los gemelos/mellizos: de un vistazo sabe que vienen juntos y que comparten
// familia. Aquí se calcula:
//
// - Familia = pacientes que comparten contacto (`contact_id`) o el teléfono de
//   algún tutor (por sus nueve últimos dígitos).
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
  siblingMark: SiblingMark | null;
  /** Día (YYYY-MM-DD local) de su primera cita no anulada ni faltada; null si nunca vino. */
  firstVisitDate: string | null;
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
