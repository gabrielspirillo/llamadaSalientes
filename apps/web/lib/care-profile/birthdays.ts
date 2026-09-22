import 'server-only';
import { and, eq, isNotNull } from 'drizzle-orm';

import { getClinicTimezone } from '@/lib/agenda/queries';
import { describeAge, isBirthdayOn } from '@/lib/care-profile/policy';
import { getCareProfile } from '@/lib/care-profile/queries';
import { db } from '@/lib/db/client';
import { patients, whatsappContacts } from '@/lib/db/schema';
import { patientFullName } from '@/lib/patients/persons';
import { localDateKey } from '@/lib/tasks/tz';

/**
 * Avisos de cumpleaños, una vez al día, en el chat interno (#agenda).
 *
 * Sólo en las clínicas con perfil de atención: son las únicas que guardan la
 * fecha de nacimiento. Un aviso interno, no un mensaje a la familia: escribir
 * al tutor sería otra decisión (plantilla, consentimiento) y no es lo que se
 * pidió. Idempotente por paciente y año: el barrido diario puede repetirse.
 */
export async function postBirthdayNotices(tenantId: string, now = new Date()): Promise<number> {
  const profile = await getCareProfile(tenantId);
  if (!profile) return 0;

  const timezone = await getClinicTimezone(tenantId);
  const todayKey = localDateKey(now, timezone);

  // Se filtra en memoria y no en SQL: la regla del 29 de febrero vive en un
  // solo sitio (`isBirthdayOn`) y la tabla de una clínica es pequeña.
  const rows = await db
    .select({
      id: patients.id,
      firstName: patients.firstName,
      lastName: patients.lastName,
      birthDate: patients.birthDate,
      phone: whatsappContacts.phoneE164,
      tutor: whatsappContacts.name,
    })
    .from(patients)
    .leftJoin(whatsappContacts, eq(whatsappContacts.id, patients.contactId))
    .where(
      and(
        eq(patients.tenantId, tenantId),
        eq(patients.active, true),
        isNotNull(patients.birthDate),
      ),
    );

  const { postPatientBirthday } = await import('@/lib/messaging/bot');
  let posted = 0;
  for (const p of rows) {
    if (!p.birthDate || !isBirthdayOn(p.birthDate, todayKey)) continue;
    await postPatientBirthday({
      tenantId,
      patientId: p.id,
      patientName: patientFullName(p),
      age: describeAge(p.birthDate, todayKey),
      phone: p.phone,
      tutorName: p.tutor,
      year: Number(todayKey.slice(0, 4)),
    });
    posted += 1;
  }
  return posted;
}
