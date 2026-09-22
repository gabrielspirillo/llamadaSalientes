import 'server-only';
import { and, asc, eq } from 'drizzle-orm';

import { matchByName } from '@/lib/agenda/agent';
import { db } from '@/lib/db/client';
import { professionalTreatments, professionals, treatments } from '@/lib/db/schema';
import { normalizeWhatsappE164 } from '@/lib/whatsapp/phone';

/**
 * Modo DERIVE: a quién le toca la consulta y qué se le escribe.
 *
 * El centro que lo pidió no quiere que el asistente reserve nada. Quiere que
 * recopile y le pase la consulta al profesional que la puede atender, por
 * WhatsApp, con todo lo que el paciente contó. Quién es "el que la puede
 * atender" sale del catálogo: el servicio por el que preguntan está asociado a
 * uno o varios profesionales (`professional_treatments`), que es la misma
 * relación que usa la agenda para saber quién hace qué.
 *
 * A diferencia de la agenda, aquí NO se exige `agenda_enabled`: un centro en
 * modo DERIVE justamente no lleva su agenda en la plataforma, y aun así sus
 * profesionales tienen que poder recibir la consulta.
 */

export interface DerivationTarget {
  /** Profesional al que le corresponde, si se pudo determinar. */
  professionalId: string | null;
  professionalName: string | null;
  specialty: string | null;
  /** Teléfono al que sale el aviso, ya en E.164. Null = no hay a quién avisar. */
  phoneE164: string | null;
  /** Tratamiento del catálogo que se reconoció, si alguno. */
  treatmentName: string | null;
  /** Cómo se llegó hasta aquí. Queda en la traza del run para poder auditarlo. */
  via: 'treatment' | 'unico-profesional' | 'respaldo' | 'sin-destino';
}

/**
 * Resuelve el destinatario de una consulta.
 *
 * Orden: el profesional que hace ese servicio → el único profesional del centro
 * (si sólo hay uno, no hay nada que decidir) → el número de respaldo que Futura
 * dejó configurado. Si no hay ninguno de los tres, se devuelve `sin-destino`:
 * la consulta igual queda como tarea y en el chat interno del equipo, que es lo
 * que impide que se pierda.
 */
export async function resolveDerivationTarget(input: {
  tenantId: string;
  treatmentName?: string | null;
  fallbackPhone?: string | null;
}): Promise<DerivationTarget> {
  const fallback = normalizeWhatsappE164(input.fallbackPhone);
  const sinDestino: DerivationTarget = {
    professionalId: null,
    professionalName: null,
    specialty: null,
    phoneE164: fallback,
    treatmentName: null,
    via: fallback ? 'respaldo' : 'sin-destino',
  };

  const activos = await db
    .select({
      id: professionals.id,
      fullName: professionals.fullName,
      specialty: professionals.specialty,
      whatsappE164: professionals.whatsappE164,
      phone: professionals.phone,
    })
    .from(professionals)
    .where(and(eq(professionals.tenantId, input.tenantId), eq(professionals.active, true)))
    .orderBy(asc(professionals.fullName));

  if (activos.length === 0) return sinDestino;

  const porTratamiento = await candidatosPorTratamiento(input.tenantId, input.treatmentName);
  if (porTratamiento) {
    const candidatos = activos.filter((p) => porTratamiento.professionalIds.has(p.id));
    if (candidatos.length > 0) {
      // El primero con WhatsApp cargado. Si ninguno lo tiene, igual nombramos
      // al que corresponde y el aviso sale por el número de respaldo: el equipo
      // sabe así a quién pasárselo.
      const conWhatsapp = candidatos.find((p) => whatsappDe(p));
      const elegido = conWhatsapp ?? candidatos[0];
      if (!elegido) return sinDestino;
      const phone = whatsappDe(elegido);
      return {
        professionalId: elegido.id,
        professionalName: elegido.fullName,
        specialty: elegido.specialty,
        phoneE164: phone ?? fallback,
        treatmentName: porTratamiento.treatmentName,
        via: phone ? 'treatment' : fallback ? 'respaldo' : 'sin-destino',
      };
    }
  }

  // Sin servicio reconocido: si el centro tiene un solo profesional, no hay
  // nada que repartir.
  if (activos.length === 1) {
    const unico = activos[0];
    if (unico) {
      const phone = whatsappDe(unico);
      if (phone) {
        return {
          professionalId: unico.id,
          professionalName: unico.fullName,
          specialty: unico.specialty,
          phoneE164: phone,
          treatmentName: porTratamiento?.treatmentName ?? null,
          via: 'unico-profesional',
        };
      }
    }
  }

  return { ...sinDestino, treatmentName: porTratamiento?.treatmentName ?? null };
}

/**
 * El WhatsApp de un profesional.
 *
 * El campo propio manda. El teléfono de contacto sólo vale de reserva y sólo si
 * ya está en formato internacional: es texto libre y ahí hay de todo, desde
 * fijos del centro hasta móviles sin prefijo, que normalizados a la fuerza dan
 * un número de otro país al que el mensaje sale sin dar error.
 */
function whatsappDe(p: { whatsappE164: string | null; phone: string | null }): string | null {
  return normalizeWhatsappE164(p.whatsappE164) ?? normalizeWhatsappE164(p.phone);
}

/** Los profesionales que realizan el servicio por el que preguntó el paciente. */
async function candidatosPorTratamiento(
  tenantId: string,
  spoken: string | null | undefined,
): Promise<{ treatmentName: string; professionalIds: Set<string> } | null> {
  const dicho = spoken?.trim();
  if (!dicho) return null;

  const catalogo = await db
    .select({ id: treatments.id, name: treatments.name })
    .from(treatments)
    .where(and(eq(treatments.tenantId, tenantId), eq(treatments.active, true)));
  if (catalogo.length === 0) return null;

  const match = matchByName(dicho, catalogo, (t) => t.name);
  if (!match) return null;

  const links = await db
    .select({ professionalId: professionalTreatments.professionalId })
    .from(professionalTreatments)
    .where(
      and(
        eq(professionalTreatments.tenantId, tenantId),
        eq(professionalTreatments.treatmentId, match.id),
      ),
    );

  return {
    treatmentName: match.name,
    professionalIds: new Set(links.map((l) => l.professionalId)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// El mensaje que recibe el profesional
// ─────────────────────────────────────────────────────────────────────────────

export interface DerivationBrief {
  clinicName: string;
  /** Nombre del paciente, si lo dio. */
  patientName?: string | null;
  patientPhoneE164: string;
  /** Resumen que escribió el asistente. */
  summary: string;
  treatmentName?: string | null;
  /** Disponibilidad o preferencia horaria que mencionó el paciente. */
  preferredTime?: string | null;
  urgent?: boolean;
  /** Se nombra cuando el aviso sale por el número de respaldo. */
  professionalName?: string | null;
  viaFallback?: boolean;
}

/**
 * El WhatsApp que le llega al profesional. Es un parte, no una conversación:
 * quien lo lee tiene que poder decidir en diez segundos si llama o no.
 *
 * El teléfono del paciente va entero y a propósito — es el único dato con el
 * que el profesional puede responderle, y va a una persona del equipo, no a un
 * log ni a un tercero.
 */
export function formatDerivationBrief(brief: DerivationBrief): string {
  const lineas: string[] = [];
  lineas.push(
    brief.urgent ? 'URGENTE · Consulta nueva por WhatsApp' : 'Consulta nueva por WhatsApp',
  );
  if (brief.viaFallback && brief.professionalName) {
    lineas.push(`Para: ${brief.professionalName} (no tiene móvil cargado en el panel)`);
  }
  const quien = brief.patientName?.trim()
    ? `${brief.patientName.trim()} (${brief.patientPhoneE164})`
    : brief.patientPhoneE164;
  lineas.push(`Paciente: ${quien}`);
  if (brief.treatmentName?.trim()) lineas.push(`Servicio: ${brief.treatmentName.trim()}`);
  lineas.push(`Consulta: ${brief.summary.trim()}`);
  if (brief.preferredTime?.trim()) lineas.push(`Disponibilidad: ${brief.preferredTime.trim()}`);
  lineas.push('');
  lineas.push(
    `Escríbele tú directamente al ${brief.patientPhoneE164}. Si respondes por aquí, lo lee el equipo en el panel, no el paciente.`,
  );
  return lineas.join('\n');
}

/**
 * Lo que el asistente le contesta al paciente después de derivar. Lo compone la
 * app y no el modelo: el modelo no sabe a quién se enrutó la consulta, y una
 * confirmación inventada ("te escribe la doctora Ruiz") sería peor que ninguna.
 */
export function buildDerivationReply(target: DerivationTarget): string {
  if (target.professionalName && target.via !== 'respaldo' && target.via !== 'sin-destino') {
    return `Ya le he pasado tu consulta a ${target.professionalName} con todo el detalle. Te escribe o te llama en cuanto pueda por este mismo número.`;
  }
  return 'Ya le he pasado tu consulta al equipo con todo el detalle. Te escriben o te llaman en cuanto puedan por este mismo número.';
}
