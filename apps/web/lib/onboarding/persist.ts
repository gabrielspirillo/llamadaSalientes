import 'server-only';
import { upsertAgentConfig } from '@/lib/data/agent-config';
import { updateClinicSettings } from '@/lib/data/clinic';
import { createFaq } from '@/lib/data/faqs';
import { createTreatment } from '@/lib/data/treatments';
import type { OnboardingPayload } from '@/lib/onboarding/schema';

/**
 * Persiste los datos del onboarding reusando EXCLUSIVAMENTE los servicios de
 * datos ya existentes (lib/data/*). No hace escrituras SQL directas ni toca el
 * esquema — solo llama a las mismas funciones que usan las pantallas de
 * Clínica / Tratamientos / FAQs / Agente en el dashboard.
 *
 * Mapeo payload → modelo existente:
 *   clinic.{address,phones,timezone,defaultLanguage} + hours    → clinic_settings
 *   agent.{afterHoursMessage,transferNumber,recordingConsentText} → clinic_settings
 *   treatments[]                                                 → treatments
 *   faqs[]                                                        → faqs
 *   agent.{tone,transferNumber}                                  → agent_configs (inbound)
 *
 * NOTA (clinic.name): no hay servicio existente para actualizar `tenants.name`
 * (lib/data/clinic.ts solo expone getTenant de lectura), así que el nombre que
 * carga la clínica NO se escribe en la tabla `tenants` — se preserva en el
 * payload y en el aviso interno. Ver TODO abajo.
 */
export async function persistOnboarding(
  tenantId: string,
  payload: OnboardingPayload,
): Promise<void> {
  const { clinic, hours, agent } = payload;

  // 1. Ajustes de la clínica (una sola escritura). La fila clinic_settings ya
  //    existe (se crea al provisionar el tenant), así que el UPDATE aplica.
  await updateClinicSettings(tenantId, {
    address: clinic.address,
    phones: clinic.phones,
    workingHours: hours,
    timezone: clinic.timezone,
    defaultLanguage: clinic.defaultLanguage,
    afterHoursMessage: agent.afterHoursMessage || null,
    recordingConsentText: agent.recordingConsentText,
    transferNumber: agent.transferNumber,
  });

  // TODO(futura): persistir clinic.name en tenants.name cuando exista un
  // servicio para hacerlo (hoy no lo hay y el prompt prohíbe escrituras
  // directas nuevas a la DB). Mientras tanto el nombre viaja en el aviso
  // interno para carga/verificación manual.

  // 2. Tratamientos. Se CREAN nuevas filas (no se borran los seeds demo que el
  //    tenant pudiera traer del provisioning — eso sería destructivo y queda
  //    como decisión de producto). Ver TODO.
  for (const t of payload.treatments) {
    await createTreatment({
      tenantId,
      name: t.name,
      description: t.description || null,
      durationMinutes: t.durationMinutes,
      priceMin: t.priceMin != null ? String(t.priceMin) : null,
      priceMax: t.priceMax != null ? String(t.priceMax) : null,
      // "Precio referencial" (€) → price_cents (usado para revenue recuperado).
      // Vacío = no se contabiliza.
      priceCents: t.priceReferencial != null ? Math.round(t.priceReferencial * 100) : null,
      currency: 'EUR',
    });
  }
  // TODO(futura): si onboarding debe REEMPLAZAR los tratamientos/FAQs sembrados
  // en el provisioning en vez de agregarse a ellos, limpiar los seeds antes de
  // insertar (decisión de producto; requiere delete explícito).

  // 3. FAQs (opcionales).
  for (const f of payload.faqs) {
    await createFaq({
      tenantId,
      category: f.category || null,
      question: f.question,
      answer: f.answer,
    });
  }

  // 4. Config del agente (inbound). tone recibe el tono/instrucciones extra.
  await upsertAgentConfig({
    tenantId,
    role: 'inbound',
    tone: agent.tone || null,
    transferNumber: agent.transferNumber,
  });

  // NOTA (agent.name): agent_configs no tiene columna de "nombre visible" del
  // agente; el dato viaja en el aviso interno. TODO(futura) si se agrega columna.
}
