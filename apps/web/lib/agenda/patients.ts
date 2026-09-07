// Identidad del paciente dentro de la agenda.
//
// La plataforma no tiene (todavía) una tabla propia de pacientes: los contactos
// viven en el CRM del tenant (GHL) y en WhatsApp, y hay clínicas sin CRM
// conectado. Para que la agenda y la historia clínica funcionen igual en los
// tres casos, cada cita guarda una `patient_key`: la identidad estable del
// paciente DENTRO del tenant.
//
// Prioridad: id del CRM > teléfono normalizado > email > nombre. Va prefijada
// por espacio de nombres para que un id del CRM no pueda colisionar nunca con
// un teléfono. Es puro: se testea sin base.

/** E.164 (`+` y dígitos). Devuelve null si no hay forma de normalizarlo. */
export function normalizePatientPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\s().-]/g, '').trim();
  if (!cleaned) return null;
  if (cleaned.startsWith('+')) return /^\+\d{7,15}$/.test(cleaned) ? cleaned : null;
  if (/^00\d{7,15}$/.test(cleaned)) return `+${cleaned.slice(2)}`;
  if (/^\d{7,15}$/.test(cleaned)) return `+${cleaned}`;
  return null;
}

export interface PatientIdentity {
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

/** Etiqueta legible de una clave, para depurar y para la ficha del paciente. */
export function describePatientKey(key: string): string {
  if (key.startsWith('ghl:')) return `CRM ${key.slice(4)}`;
  if (key.startsWith('tel:')) return key.slice(4);
  if (key.startsWith('email:')) return key.slice(6);
  return 'Sin datos de contacto';
}

export function patientKeyIsPhone(key: string): boolean {
  return key.startsWith('tel:');
}

export function phoneFromPatientKey(key: string): string | null {
  return key.startsWith('tel:') ? key.slice(4) : null;
}
