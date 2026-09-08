import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/agenda/agent', () => ({ describeAgendaForPrompt: vi.fn() }));
vi.mock('@/lib/data/faqs', () => ({ listFaqsForTenant: vi.fn() }));
vi.mock('@/lib/data/treatments', () => ({ listTreatmentsForTenant: vi.fn() }));
vi.mock('@/lib/retell/clinic-context', () => ({ buildClinicContextVars: vi.fn() }));

import { type BuildSystemPromptInput, buildSystemPrompt } from '@/lib/whatsapp/agent/prompt';

/**
 * El asistente no empieza a agendar por su cuenta.
 *
 * Caso real: el paciente saludó, el agente le pidió nombre y apellido "para
 * agendar la consulta" y, en cuanto se lo dio, se inventó el tratamiento
 * ("valoración"), eligió profesional y le cantó tres horarios. Nadie le había
 * pedido una cita.
 *
 * El comportamiento lo decide el LLM, así que la garantía de verdad son los
 * casos dorados (`pnpm eval:agent`, caso `nombre-suelto-no-agenda`). Este test
 * es más modesto y complementario: fija que las instrucciones que lo frenan
 * SIGUEN en el prompt, para que no desaparezcan en una reescritura sin que
 * nadie se entere.
 */

const BASE: BuildSystemPromptInput = {
  clinic: {
    name: 'Clínica Dental Test',
    address: 'Calle Falsa 123',
    phones: '+34600000000',
    workingHours: 'L-V 9:00-20:00',
    timezone: 'Europe/Madrid',
    transferNumber: '+34600000001',
  },
  treatments: [
    {
      name: 'Limpieza dental',
      durationMinutes: 45,
      priceMin: 60,
      priceMax: 60,
      currency: 'EUR',
      description: null,
    },
  ],
  faqs: [{ category: null, question: '¿Hay parking?', answer: 'Sí, en la puerta.' }],
  now: 'lunes 8 de septiembre de 2026, 11:00 (Europe/Madrid)',
};

describe('el prompt frena el agendamiento no pedido', () => {
  const prompt = buildSystemPrompt(BASE);

  it('exige que el paciente haya pedido cita antes de buscar hueco', () => {
    expect(prompt).toContain('NO empieces a agendar por tu cuenta');
    expect(prompt).toMatch(/PEDIDO cita y tú tienes que saber PARA QUÉ/);
  });

  it('prohíbe elegir el tratamiento por su cuenta para poder buscar hueco', () => {
    // Es literalmente lo que hizo: eligió "valoración" para tener con qué
    // llamar a check_availability.
    expect(prompt).toMatch(/nunca elijas tú el tratamiento/i);
  });

  it('deja claro que un saludo no es una petición de cita', () => {
    expect(prompt).toContain('Y ahí te paras');
    expect(prompt).toMatch(/No le pidas datos personales ni\s+le busques hueco todavía/);
  });

  it('el nombre se pide al reservar, no para enseñar huecos', () => {
    expect(prompt).toMatch(/cuando ya\s+haya elegido un horario concreto, no antes/);
  });

  it('conserva las dos excepciones en las que sí toma la iniciativa', () => {
    // Sin ellas, el freno rompería la urgencia y el reagendamiento desde un
    // recordatorio, que SÍ deben ofrecer huecos sin que se los pidan.
    expect(prompt).toMatch(
      /la urgencia\s+bucodental del carril D y el reagendamiento desde un recordatorio/,
    );
  });

  it('sigue sin exigir un id de CRM para reservar', () => {
    // La corrección anterior no se pierde con esta.
    expect(prompt).toMatch(/el contact_id es\s+opcional/);
    expect(prompt).not.toContain('NUNCA reserves sin contact_id real');
  });
});
