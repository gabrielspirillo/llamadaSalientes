import 'server-only';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { patients, whatsappContacts } from '@/lib/db/schema';
import {
  type ImportedChild,
  type SkippedRow,
  childMatchKey,
  parseGoogleContacts,
} from '@/lib/patients/import-contacts';
import { type PatientScope, createPatient, setPatientMarks } from '@/lib/patients/persons';

/**
 * Alta masiva de pacientes desde el CSV de Google Contactos.
 *
 * El navegador manda el ARCHIVO, nunca registros ya interpretados: el servidor
 * lo vuelve a leer en la vista previa y en cada lote del alta. Así nadie puede
 * colar un paciente que no esté en el archivo, y el alta es idempotente — un
 * niño con el mismo nombre y el mismo teléfono de tutor ya existente se salta,
 * de modo que repetir un lote (o el archivo entero) no duplica nada.
 */

export const IMPORT_BATCH_SIZE = 200;

export interface ImportPreviewRow {
  row: number;
  child: string;
  guardian: string;
  phone: string | null;
  hesitant: boolean;
  priorRedFlags: number;
  noBooking: boolean;
  exists: boolean;
}

export interface ImportPreview {
  totalRows: number;
  children: number;
  toCreate: number;
  alreadyThere: number;
  withoutPhone: number;
  hesitant: number;
  withRedFlags: number;
  noBooking: number;
  skipped: SkippedRow[];
  /** Una muestra para que se vea cómo se leyó el archivo. Las marcadas primero. */
  sample: ImportPreviewRow[];
}

async function existingKeys(tenantId: string): Promise<Set<string>> {
  const rows = await db
    .select({
      firstName: patients.firstName,
      lastName: patients.lastName,
      phone: whatsappContacts.phoneE164,
    })
    .from(patients)
    .leftJoin(whatsappContacts, eq(whatsappContacts.id, patients.contactId))
    .where(eq(patients.tenantId, tenantId));
  return new Set(rows.map((r) => childMatchKey(r.phone, r.firstName, r.lastName)));
}

function keyOf(c: ImportedChild) {
  return childMatchKey(c.guardian.phone, c.firstName, c.lastName);
}

function hasMarks(c: ImportedChild) {
  return c.hesitant || c.priorRedFlags > 0 || c.noBooking;
}

export async function previewContactsImport(
  tenantId: string,
  csvText: string,
): Promise<ImportPreview> {
  const parsed = parseGoogleContacts(csvText);
  const seen = await existingKeys(tenantId);
  const rows: ImportPreviewRow[] = parsed.children.map((c) => ({
    row: c.row,
    child: [c.firstName, c.lastName].filter(Boolean).join(' '),
    guardian: c.guardian.name,
    phone: c.guardian.phone,
    hesitant: c.hesitant,
    priorRedFlags: c.priorRedFlags,
    noBooking: c.noBooking,
    exists: seen.has(keyOf(c)),
  }));
  const alreadyThere = rows.filter((r) => r.exists).length;
  const marked = rows.filter((r) => r.hesitant || r.priorRedFlags > 0 || r.noBooking);
  const plain = rows.filter((r) => !(r.hesitant || r.priorRedFlags > 0 || r.noBooking));
  return {
    totalRows: parsed.totalRows,
    children: rows.length,
    toCreate: rows.length - alreadyThere,
    alreadyThere,
    withoutPhone: rows.filter((r) => !r.phone).length,
    hesitant: rows.filter((r) => r.hesitant).length,
    withRedFlags: rows.filter((r) => r.priorRedFlags > 0).length,
    noBooking: rows.filter((r) => r.noBooking).length,
    skipped: parsed.skipped,
    sample: [...marked.slice(0, 15), ...plain.slice(0, 25)],
  };
}

export interface ImportBatchResult {
  /** Posición desde la que sigue el próximo lote; null = terminado. */
  nextOffset: number | null;
  total: number;
  created: number;
  skippedExisting: number;
  errors: { row: number; child: string; error: string }[];
}

/** Da de alta un lote del archivo: `IMPORT_BATCH_SIZE` niños desde `offset`. */
export async function importContactsBatch(
  scope: PatientScope,
  csvText: string,
  offset: number,
): Promise<ImportBatchResult> {
  const { children } = parseGoogleContacts(csvText);
  const start = Math.max(0, Math.trunc(offset));
  const batch = children.slice(start, start + IMPORT_BATCH_SIZE);
  const seen = await existingKeys(scope.tenantId);
  const result: ImportBatchResult = {
    nextOffset: start + batch.length < children.length ? start + batch.length : null,
    total: children.length,
    created: 0,
    skippedExisting: 0,
    errors: [],
  };

  for (const c of batch) {
    const key = keyOf(c);
    if (seen.has(key)) {
      result.skippedExisting++;
      continue;
    }
    try {
      const person = await createPatient(scope, {
        firstName: c.firstName,
        lastName: c.lastName,
        guardians: [
          {
            role: c.guardian.role,
            name: c.guardian.name,
            ...(c.guardian.phone ? { phone: c.guardian.phone, primary: true } : {}),
            ...(c.guardian.email ? { email: c.guardian.email.slice(0, 160) } : {}),
          },
        ],
        contactPhone: c.guardian.phone ?? '',
        notes: c.notes,
      });
      seen.add(key);
      result.created++;
      if (hasMarks(c)) {
        await setPatientMarks(scope, person.id, {
          priorityFlag: false,
          googleReview: false,
          ...(c.noBooking
            ? {
                needsHumanReview: true,
                reviewReason: 'No dar cita: así estaba marcado en los contactos de la clínica.',
              }
            : {}),
          hesitant: c.hesitant,
          priorRedFlags: c.priorRedFlags,
        });
      }
    } catch (err) {
      result.errors.push({
        row: c.row,
        child: [c.firstName, c.lastName].filter(Boolean).join(' '),
        error: (err as Error).message.slice(0, 200),
      });
    }
  }
  return result;
}
