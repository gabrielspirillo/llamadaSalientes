import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/client', () => ({ db: {} }));

import { looksLikeMedicalQuestion } from '@/lib/whatsapp/agent';
import { stripClinicalTriage } from '@/lib/whatsapp/agent/prompt';

describe('asistente administrativo', () => {
  it('detecta preguntas sobre síntomas', () => {
    expect(looksLikeMedicalQuestion('¿Desde cuándo tiene fiebre? ¿Ha tenido tos?')).toBe(true);
    expect(looksLikeMedicalQuestion('¿La fiebre ha superado los 38.5º?')).toBe(true);
    expect(looksLikeMedicalQuestion('¿Ha tomado algún medicamento?')).toBe(true);
  });

  it('no bloquea el saludo con el aviso de fiebre ni preguntas de agenda', () => {
    expect(
      looksLikeMedicalQuestion(
        'Hola, ¿es la primera vez que acudes a la clínica?\n‼️ SI HAY FIEBRE SUPERIOR A 38.5º NO SE PUEDE REALIZAR LA SESIÓN',
      ),
    ).toBe(false);
    expect(looksLikeMedicalQuestion('¿Te viene bien el martes a las 17:00?')).toBe(false);
    expect(looksLikeMedicalQuestion('No duele aunque resulte incómodo.')).toBe(false);
  });

  it('quita el protocolo de urgencias del prompt', () => {
    const prompt = `A
D. **Urgencia clínica dentro del alcance** — haz 2-3 preguntas BREVES sobre el síntoma

# Reglas duras (no negociables)
2. NUNCA des diagnósticos clínicos ni recomendaciones médicas. Si describe dolor,
   hazle 2-3 preguntas sobre el síntoma. ni reserves sin que el paciente haya elegido el horario.
- flag_urgent: marca urgencia clínica (dolor). haz 2-3 preguntas sobre el síntoma
- request_handoff: x`;
    const out = stripClinicalTriage(prompt);
    expect(out).not.toMatch(/2-3 preguntas/);
    expect(out).not.toMatch(/flag_urgent/);
    expect(out).toMatch(/request_handoff/);
  });
});
