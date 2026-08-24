import { E164_REGEX, type OnboardingForm } from '@/lib/onboarding/schema';

// Errores por paso: mapa de "path" → mensaje. Los steps leen su subconjunto.
export type Errors = Record<string, string>;

function isEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function isPositiveInt(v: string) {
  const n = Number(v.trim());
  return Number.isFinite(n) && n > 0 && Number.isInteger(n);
}

function isNonNegNumberOrEmpty(v: string) {
  if (v.trim() === '') return true;
  const n = Number(v.trim().replace(',', '.'));
  return Number.isFinite(n) && n >= 0;
}

// Devuelve los errores del paso `step` (1-indexado). Vacío = paso válido.
export function validateStep(step: number, form: OnboardingForm): Errors {
  const e: Errors = {};

  if (step === 1) {
    if (!form.clinic.name.trim()) e['clinic.name'] = 'Ingresá el nombre de la clínica';
    if (!form.clinic.address.trim()) e['clinic.address'] = 'Ingresá la dirección';
    const phones = form.clinic.phones.map((p) => p.trim()).filter(Boolean);
    if (phones.length === 0) e['clinic.phones'] = 'Ingresá al menos un teléfono';
    if (!form.clinic.timezone) e['clinic.timezone'] = 'Elegí la zona horaria';
    if (!form.clinic.contactEmail.trim()) e['clinic.contactEmail'] = 'Ingresá un email de contacto';
    else if (!isEmail(form.clinic.contactEmail)) e['clinic.contactEmail'] = 'Email inválido';
  }

  if (step === 2) {
    for (const [day, row] of Object.entries(form.hours)) {
      if (row.enabled && row.open >= row.close) {
        e[`hours.${day}`] = 'La hora de cierre debe ser mayor a la de apertura';
      }
    }
  }

  if (step === 3) {
    if (form.treatments.length === 0) e.treatments = 'Cargá al menos un tratamiento';
    form.treatments.forEach((t, i) => {
      if (!t.name.trim()) e[`treatments.${i}.name`] = 'Nombre requerido';
      if (!isPositiveInt(t.durationMinutes))
        e[`treatments.${i}.durationMinutes`] = 'Duración en minutos (número entero > 0)';
      if (!isNonNegNumberOrEmpty(t.priceMin)) e[`treatments.${i}.priceMin`] = 'Precio inválido';
      if (!isNonNegNumberOrEmpty(t.priceMax)) e[`treatments.${i}.priceMax`] = 'Precio inválido';
      if (!isNonNegNumberOrEmpty(t.priceReferencial))
        e[`treatments.${i}.priceReferencial`] = 'Precio inválido';
    });
  }

  if (step === 4) {
    form.faqs.forEach((f, i) => {
      const started = f.question.trim() || f.answer.trim() || f.category.trim();
      if (!started) return;
      if (!f.question.trim()) e[`faqs.${i}.question`] = 'Pregunta requerida';
      if (!f.answer.trim()) e[`faqs.${i}.answer`] = 'Respuesta requerida';
    });
  }

  if (step === 5) {
    if (form.agent.tone.length > 2000) e['agent.tone'] = 'Máximo 2000 caracteres';
    if (!form.agent.transferNumber.trim())
      e['agent.transferNumber'] = 'Ingresá el número de transferencia';
    else if (!E164_REGEX.test(form.agent.transferNumber.trim()))
      e['agent.transferNumber'] = 'Formato internacional, ej: +34611223344';
    if (!form.agent.recordingConsentText.trim())
      e['agent.recordingConsentText'] = 'El texto de consentimiento es obligatorio';
  }

  return e;
}

export function isStepValid(step: number, form: OnboardingForm): boolean {
  return Object.keys(validateStep(step, form)).length === 0;
}
