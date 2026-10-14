// Identidad del paciente dentro de la agenda.
//
// La plataforma no tiene (todavía) una tabla propia de pacientes: los contactos
// viven en el CRM del tenant (GHL) y en WhatsApp, y hay clínicas sin CRM
// conectado. Para que la agenda y la historia clínica funcionen igual en los
// tres casos, cada cita guarda una `patient_key`: la identidad estable del
// paciente DENTRO del tenant.
//
// Prioridad: paciente de la plataforma > id del CRM > teléfono normalizado >
// email > nombre. Va prefijada por espacio de nombres para que un id del CRM no
// pueda colisionar nunca con un teléfono. Es puro: se testea sin base.
//
// `pat:<uuid>` es el paciente como PERSONA (tabla `patients`), distinto del
// contacto que llama: en una clínica pediátrica el teléfono es del tutor y
// detrás hay hermanos. Sin esta clave, dos gemelos compartirían historia.

/**
 * Un móvil o fijo español tecleado sin prefijo ("600 11 22 33"): nueve dígitos
 * que empiezan por 6, 7, 8 o 9. Ningún E.164 real es "+6" seguido de ocho
 * dígitos, así que no se confunde con un número extranjero.
 */
const SPANISH_NATIONAL = /^[6-9]\d{8}$/;

/** E.164 (`+` y dígitos). Devuelve null si no hay forma de normalizarlo. */
export function normalizePatientPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\s().-]/g, '').trim();
  if (!cleaned) return null;
  if (cleaned.startsWith('+')) {
    if (!/^\+\d{7,15}$/.test(cleaned)) return null;
    // "+600112233": el "+" puesto a mano delante de un número nacional.
    return SPANISH_NATIONAL.test(cleaned.slice(1)) ? `+34${cleaned.slice(1)}` : cleaned;
  }
  if (/^00\d{7,15}$/.test(cleaned)) return `+${cleaned.slice(2)}`;
  // Sin esto "600112233" se guardaba como "+600112233" y, cuando ese tutor
  // escribía por WhatsApp (+34600112233), nacía un segundo contacto.
  if (SPANISH_NATIONAL.test(cleaned)) return `+34${cleaned}`;
  if (/^\d{7,15}$/.test(cleaned)) return `+${cleaned}`;
  return null;
}

/** Sólo los dígitos de un teléfono: lo que se compara para no duplicar. */
export function phoneDigits(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

/**
 * ¿Es el mismo teléfono escrito de dos formas? Iguales, o uno es el otro sin
 * el prefijo de país ("600112233" dentro de "34600112233"). El corto tiene que
 * tener al menos nueve dígitos: con menos, cualquier final coincidiría.
 */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  const [short, long] = da.length < db.length ? [da, db] : [db, da];
  return short.length >= 9 && long.endsWith(short);
}

export interface PatientIdentity {
  /** Id de `patients`, cuando la clínica lleva a sus pacientes como personas. */
  patientId?: string | null;
  ghlContactId?: string | null;
  phone?: string | null;
  email?: string | null;
  name?: string | null;
}

/**
 * Clave estable del paciente. Nunca devuelve cadena vacía: si no hay ningún
 * dato utilizable cae a `anon:<nombre normalizado>` y, en último extremo, a
 * `anon:sin-datos` — una cita sin identidad sigue teniendo que poder guardarse
 * (recepción a veces sólo tiene un nombre a medias).
 */
export function patientKeyFor(identity: PatientIdentity): string {
  const patientId = identity.patientId?.trim();
  if (patientId) return patientKeyForPerson(patientId);

  const ghl = identity.ghlContactId?.trim();
  if (ghl) return `ghl:${ghl}`;

  const phone = normalizePatientPhone(identity.phone);
  if (phone) return `tel:${phone}`;

  const email = identity.email?.trim().toLowerCase();
  if (email?.includes('@')) return `email:${email}`;

  const name = slugifyName(identity.name);
  return name ? `anon:${name}` : 'anon:sin-datos';
}

function slugifyName(raw: string | null | undefined): string {
  if (!raw) return '';
  return (
    raw
      .normalize('NFD')
      // Tildes del castellano y poco más: acento, diéresis, virgulilla y cedilla.
      .replace(/\u0301|\u0300|\u0302|\u0303|\u0308|\u0327/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60)
  );
}

/** Clave de un paciente de la plataforma (`patients.id`). */
export function patientKeyForPerson(patientId: string): string {
  return `pat:${patientId}`;
}

/** `patients.id` si la clave es de un paciente de la plataforma; si no, null. */
export function patientIdFromKey(key: string | null | undefined): string | null {
  if (!key?.startsWith('pat:')) return null;
  const id = key.slice(4);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

/** Etiqueta legible de una clave, para depurar y para la ficha del paciente. */
export function describePatientKey(key: string): string {
  if (key.startsWith('pat:')) return 'Paciente de la clínica';
  if (key.startsWith('ghl:')) return `CRM ${key.slice(4)}`;
  if (key.startsWith('tel:')) return key.slice(4);
  if (key.startsWith('email:')) return key.slice(6);
  return 'Sin datos de contacto';
}

/**
 * Todas las identidades con las que una cita puede referirse a este contacto.
 *
 * Una cita de GoHighLevel guarda el id del CRM tal cual; una de la agenda
 * propia guarda su `patient_key`. Las fichas del panel tienen que encontrar
 * las dos, así que preguntan por todas a la vez en lugar de por una sola.
 */
export function contactRefsFor(contact: {
  ghlContactId?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Los pacientes (personas) que cuelgan de este contacto. */
  patientIds?: string[] | null;
}): string[] {
  const refs = new Set<string>();
  for (const id of contact.patientIds ?? []) {
    const clean = id?.trim();
    if (clean) refs.add(patientKeyForPerson(clean));
  }
  const ghl = contact.ghlContactId?.trim();
  if (ghl) {
    refs.add(ghl);
    refs.add(`ghl:${ghl}`);
  }
  const phone = normalizePatientPhone(contact.phone);
  if (phone) refs.add(`tel:${phone}`);
  const email = contact.email?.trim().toLowerCase();
  if (email?.includes('@')) refs.add(`email:${email}`);
  return [...refs];
}

export function patientKeyIsPhone(key: string): boolean {
  return key.startsWith('tel:');
}

export function phoneFromPatientKey(key: string): string | null {
  return key.startsWith('tel:') ? key.slice(4) : null;
}
