// Importador de contactos de Google (CSV) a pacientes-persona.
//
// Pensado para las clínicas con perfil pediátrico, que llevan a sus familias
// en los contactos del móvil con un nombre que lo dice todo:
//   "🤔🚩🚩Mamá Sergio / Álvaro Peña Pascual (Clara)"
//   ─emojis─ ─rol─ ────niño(s) y apellidos──── (tutor)
//
//   🤔            → familia que duda
//   🚩 (cada una) → una bandera roja anterior a la plataforma
//   😡 👿 🤬 😠 o "NO DAR" → no dar cita (aviso que bloquea a los asistentes)
//   el resto (⭐, flores, corazones…) se ignora, pero el nombre original queda
//   en la nota del paciente para que nada se pierda.
//
// Puro, sin base: el servidor lo corre dos veces (vista previa y alta) sobre el
// mismo archivo, así el navegador nunca manda registros ya "interpretados".

import type { GuardianRole } from '@/lib/care-profile/policy';

export interface ImportedChild {
  /** Fila del CSV (1 = cabecera), para poder buscarla en el original. */
  row: number;
  firstName: string;
  lastName: string;
  guardian: { role: GuardianRole; name: string; phone: string | null; email: string | null };
  hesitant: boolean;
  priorRedFlags: number;
  noBooking: boolean;
  notes: string;
  /** El nombre tal como estaba en los contactos. */
  original: string;
}

export interface SkippedRow {
  row: number;
  name: string;
  reason: string;
}

export interface ParsedContacts {
  children: ImportedChild[];
  skipped: SkippedRow[];
  /** Filas de datos del CSV (sin la cabecera). */
  totalRows: number;
}

export class ContactsImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContactsImportError';
  }
}

export const MAX_IMPORT_ROWS = 10_000;

// ─── CSV (RFC 4180: comillas, comas y saltos de línea dentro de un campo) ────

export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// ─── Teléfono ────────────────────────────────────────────────────────────────

/**
 * A E.164. Un móvil español de 9 cifras gana el +34. Google a veces exporta
 * "226-703-96031" (el 6 del móvil detrás de un "22" que sobra): se quita.
 */
export function contactPhoneToE164(raw: string): string | null {
  const first = raw.split(':::')[0]?.trim() ?? '';
  if (!first) return null;
  const plus = first.startsWith('+');
  let d = first.replace(/\D/g, '');
  if (plus) {
    if (d.length === 13 && d.startsWith('3422')) d = `34${d.slice(4)}`;
    return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
  }
  if (d.length === 13 && d.startsWith('0034')) d = d.slice(4);
  if (d.length === 11 && d.startsWith('22')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('34')) d = d.slice(2);
  if (d.length === 9 && /^[6789]/.test(d)) return `+34${d}`;
  return null;
}

// ─── Nombre ──────────────────────────────────────────────────────────────────

const LETTER = 'A-Za-zÁÉÍÓÚÜÑáéíóúüñ';
const ROLE_RE = new RegExp(
  `(?<![${LETTER}])(mam[aá]|mami|pap[aá]|abuel[ao]|t[ií][ao])(?![${LETTER}])\\s*\\d*`,
  'i',
);
const ROLE_MAP: Record<string, GuardianRole> = {
  mama: 'MADRE',
  mamá: 'MADRE',
  mami: 'MADRE',
  papa: 'PADRE',
  papá: 'PADRE',
  abuela: 'ABUELA',
  abuelo: 'ABUELO',
  tia: 'OTRO',
  tía: 'OTRO',
  tio: 'OTRO',
  tío: 'OTRO',
};
const ANGRY = ['😡', '👿', '🤬', '😠'];

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** Fuera emojis y símbolos; quedan letras, dígitos, espacios y / ( ) . , - ª º. */
function stripSymbols(s: string): string {
  let out = '';
  for (const ch of s) out += /[\p{L}\p{N} /().,\-ªº]/u.test(ch) ? ch : ' ';
  return out.replace(/\s+/g, ' ').trim();
}

/** "Sergio / Álvaro Peña Pascual" → Sergio Peña Pascual y Álvaro Peña Pascual. */
export function splitChildren(text: string): { firstName: string; lastName: string }[] {
  const clean = text.replace(/^[\s.,-]+|[\s.,-]+$/g, '');
  if (!clean) return [];
  const parts = clean
    .split(/\s*[/,]\s*|\s+[yY]\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return [];
  const lastTokens = (parts[parts.length - 1] as string).split(' ');
  const sharedSurname = lastTokens.slice(1).join(' ');
  return parts.map((p, i) => {
    const toks = p.split(' ');
    if (i < parts.length - 1 && toks.length === 1) {
      return { firstName: toks[0] as string, lastName: sharedSurname };
    }
    return { firstName: toks[0] as string, lastName: toks.slice(1).join(' ') };
  });
}

function fullNameOf(first: string, middle: string, last: string): string {
  // Google parte los nombres largos en tres columnas; cuando el paréntesis está
  // en la primera, las otras dos son trozos repetidos.
  if (first.includes('(')) return first.trim();
  return [first, middle, last]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
}

interface NameParts {
  role: GuardianRole;
  guardianName: string;
  children: { firstName: string; lastName: string }[];
  before: string;
  rest: string;
}

export function parseContactName(original: string): NameParts | null {
  const text = stripSymbols(original);
  const m = ROLE_RE.exec(text);
  if (!m) return null;
  const roleWord = (m[1] ?? '').toLowerCase();
  const role = ROLE_MAP[roleWord] ?? 'OTRO';
  let before = text.slice(0, m.index).replace(/^[\s.,-]+|[\s.,-]+$/g, '');
  const after = text.slice(m.index + m[0].length).trim();

  let guardianName = '';
  let rest = '';
  let childText: string;
  const insideParen = text.lastIndexOf('(', m.index) > text.lastIndexOf(')', m.index);
  if (insideParen) {
    // "Jose Manuel (papá Nuño y Cayetana)": el tutor delante, los niños dentro.
    guardianName = before.replace(/[\s(]+$/, '').trim();
    before = '';
    const close = after.indexOf(')');
    childText = close >= 0 ? after.slice(0, close) : after;
    rest = close >= 0 ? after.slice(close + 1).replace(/^[\s.,-]+|[\s.,-]+$/g, '') : '';
  } else {
    const pm = /\(([^)]*)\)/.exec(after);
    if (pm) {
      childText = after.slice(0, pm.index);
      guardianName = (pm[1] ?? '').replace(/^[\s,.]+|[\s,.]+$/g, '');
      rest = after
        .slice(pm.index + pm[0].length)
        .replace(/\([^)]*\)/g, ' ')
        .replace(/^[\s.,-]+|[\s.,-]+$/g, '')
        .replace(/\s+/g, ' ');
    } else {
      childText = after;
    }
  }
  childText = childText.replace(/^\d+\s*/, '');
  return { role, guardianName, children: splitChildren(childText), before, rest };
}

// ─── Archivo completo ────────────────────────────────────────────────────────

const REQUIRED = ['First Name', 'Phone 1 - Value'];

export function parseGoogleContacts(csvText: string): ParsedContacts {
  const table = parseCsv(csvText);
  const header = table[0];
  if (!header) throw new ContactsImportError('El archivo está vacío.');
  const col = new Map(header.map((h, i) => [h.trim(), i]));
  for (const name of REQUIRED) {
    if (!col.has(name)) {
      throw new ContactsImportError(
        `No parece un export de Google Contactos: falta la columna "${name}". En contacts.google.com → Exportar → "CSV de Google".`,
      );
    }
  }
  const dataRows = table.slice(1);
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new ContactsImportError(`Como mucho ${MAX_IMPORT_ROWS} contactos por archivo.`);
  }
  const get = (r: string[], name: string) => {
    const i = col.get(name);
    return i === undefined ? '' : (r[i] ?? '');
  };

  const skipped: SkippedRow[] = [];
  const byKey = new Map<string, ImportedChild>();

  dataRows.forEach((r, i) => {
    const row = i + 2;
    const original = fullNameOf(get(r, 'First Name'), get(r, 'Middle Name'), get(r, 'Last Name'));
    if (!original) {
      skipped.push({ row, name: '(sin nombre)', reason: 'Sin nombre' });
      return;
    }
    const parts = parseContactName(original);
    if (!parts) {
      skipped.push({
        row,
        name: original,
        reason: 'No dice mamá, papá, abuela…: no parece una familia',
      });
      return;
    }
    if (parts.children.length === 0) {
      skipped.push({ row, name: original, reason: 'No trae el nombre del niño' });
      return;
    }

    const phoneRaw = get(r, 'Phone 1 - Value');
    const phone = contactPhoneToE164(phoneRaw);
    const email = get(r, 'E-mail 1 - Value').split(':::')[0]?.trim() || null;
    const otherPhones = [
      ...phoneRaw.split(':::').slice(1),
      ...get(r, 'Phone 2 - Value').split(':::'),
      ...get(r, 'Phone 3 - Value').split(':::'),
    ]
      .map((p) => p.trim())
      .filter(Boolean);

    const notes = [`Importado de los contactos: «${original}».`];
    if (parts.before) notes.push(`Antes del nombre: ${parts.before}.`);
    if (parts.rest) notes.push(`Además: ${parts.rest}.`);
    if (otherPhones.length > 0) notes.push(`Otros teléfonos: ${otherPhones.join(', ')}.`);
    if (phoneRaw.trim() && !phone) notes.push(`Teléfono sin formato válido: ${phoneRaw.trim()}.`);
    const extra = get(r, 'Notes').trim();
    if (extra) notes.push(extra);

    const hesitant = original.includes('🤔');
    const priorRedFlags = Math.min(99, countOf(original, '🚩'));
    const noBooking = ANGRY.some((e) => original.includes(e)) || /no\s+dar/i.test(original);

    for (const child of parts.children) {
      const firstName = child.firstName.slice(0, 80);
      const lastName = child.lastName.slice(0, 120);
      // El mismo niño con el mismo teléfono dos veces (contacto duplicado): se
      // fusionan las marcas en vez de crear dos fichas.
      const key = `${phone ?? `row${row}`}|${normalizeForMatch(firstName)}|${normalizeForMatch(lastName)}`;
      const prev = byKey.get(key);
      if (prev) {
        prev.hesitant ||= hesitant;
        prev.noBooking ||= noBooking;
        prev.priorRedFlags = Math.max(prev.priorRedFlags, priorRedFlags);
        if (!prev.guardian.name) prev.guardian.name = parts.guardianName;
        continue;
      }
      byKey.set(key, {
        row,
        firstName,
        lastName,
        guardian: { role: parts.role, name: parts.guardianName.slice(0, 120), phone, email },
        hesitant,
        priorRedFlags,
        noBooking,
        notes: notes.join(' ').slice(0, 2000),
        original,
      });
    }
  });

  return { children: [...byKey.values()], skipped, totalRows: dataRows.length };
}

/** Para comparar nombres: sin tildes, sin mayúsculas, sin espacios de más. */
export function normalizeForMatch(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** La clave con la que se detecta que un niño ya está dado de alta. */
export function childMatchKey(phone: string | null, firstName: string, lastName: string | null) {
  return `${phone ?? ''}|${normalizeForMatch(firstName)}|${normalizeForMatch(lastName)}`;
}
