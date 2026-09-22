import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * El aviso al profesional sale por el WhatsApp de la clínica.
 *
 * Eso trae dos peligros y los dos se fijan aquí: que el parte clínico acabe en
 * el móvil del propio paciente porque alguien copió mal un número, y que el
 * asistente se ponga a atender al profesional cuando éste responda al hilo.
 */
const mocks = vi.hoisted(() => ({
  sendAgentResponse: vi.fn(),
  upsertContact: vi.fn(),
  getOrCreateConversation: vi.fn(),
  update: vi.fn(),
  setValues: vi.fn(),
}));

vi.mock('@/lib/whatsapp/outbound/send-response', () => ({
  sendAgentResponse: mocks.sendAgentResponse,
}));
vi.mock('@/lib/whatsapp/persist', () => ({
  upsertWhatsappContact: mocks.upsertContact,
  getOrCreateOpenConversation: mocks.getOrCreateConversation,
}));
vi.mock('@/lib/whatsapp/factory', () => ({ getConnectorForTenant: async () => null }));
// Redis del cerrojo: por defecto la clave NO existía (primer aviso pasa).
const redisSet = vi.hoisted(() => vi.fn(async (): Promise<string | null> => 'OK'));
vi.mock('@/lib/queue/connection', () => ({ getRedis: () => ({ set: redisSet }) }));
vi.mock('@/lib/db/client', () => ({
  db: {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mocks.setValues(values);
        return { where: () => Promise.resolve() };
      },
    }),
  },
}));

import { notifyProfessionalOfDerivation } from '@/lib/whatsapp/notify-professional';

const CONNECTOR = { channel: 'whatsapp_evolution' } as never;

const DERIVATION = {
  professionalId: 'p-ana',
  professionalName: 'Ana Ruiz',
  phoneE164: '+34600111222',
  treatmentName: 'Fisioterapia deportiva',
  summary: 'Molestia en el hombro derecho desde hace dos semanas.',
  patientName: 'Marta',
  patientPhoneE164: '+34611222333',
  preferredTime: 'martes por la tarde',
  urgent: false,
  via: 'treatment',
};

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  redisSet.mockReset();
  redisSet.mockResolvedValue('OK'); // por defecto: no había aviso previo

  mocks.upsertContact.mockResolvedValue({ id: 'contacto-ana' });
  mocks.getOrCreateConversation.mockResolvedValue({ id: 'conv-ana' });
  mocks.sendAgentResponse.mockResolvedValue({ messageId: 'm-1', externalId: 'x-1', kind: 'text' });
});

describe('notifyProfessionalOfDerivation', () => {
  it('le manda el parte y deja su hilo con el asistente apagado', async () => {
    const result = await notifyProfessionalOfDerivation({
      tenantId: 'c1',
      clinicName: 'Train Movements Center',
      derivation: DERIVATION,
      connector: CONNECTOR,
    });

    expect(result.sent).toBe(true);
    const enviado = mocks.sendAgentResponse.mock.calls[0]?.[0];
    expect(enviado.toPhoneE164).toBe('+34600111222');
    expect(enviado.text).toContain('+34611222333');
    expect(enviado.text).toContain('hombro derecho');
    expect(mocks.setValues).toHaveBeenCalledWith(expect.objectContaining({ aiEnabled: false }));
  });

  it('no manda nada si el destinatario es el propio paciente', async () => {
    const result = await notifyProfessionalOfDerivation({
      tenantId: 'c1',
      clinicName: 'Centro',
      derivation: { ...DERIVATION, phoneE164: DERIVATION.patientPhoneE164 },
      connector: CONNECTOR,
    });

    expect(result).toEqual({ sent: false, reason: 'destinatario_es_el_paciente' });
    expect(mocks.sendAgentResponse).not.toHaveBeenCalled();
  });

  it('sin destinatario no falla: lo dice y sigue', async () => {
    const result = await notifyProfessionalOfDerivation({
      tenantId: 'c1',
      clinicName: 'Centro',
      derivation: { ...DERIVATION, phoneE164: null },
      connector: CONNECTOR,
    });

    expect(result).toEqual({ sent: false, reason: 'sin_destinatario' });
  });

  it('sin conexión de WhatsApp tampoco rompe', async () => {
    const result = await notifyProfessionalOfDerivation({
      tenantId: 'c1',
      clinicName: 'Centro',
      derivation: DERIVATION,
    });

    expect(result).toEqual({ sent: false, reason: 'sin_conector' });
  });

  it('no reenvía la misma consulta: el cerrojo por conversación corta el segundo aviso', async () => {
    // El SET NX devuelve algo distinto de 'OK' cuando la clave ya existe.
    redisSet.mockResolvedValue(null);
    const result = await notifyProfessionalOfDerivation({
      tenantId: 'c1',
      clinicName: 'Centro',
      derivation: DERIVATION,
      sourceConversationId: 'conv-paciente',
      connector: CONNECTOR,
    });

    expect(result).toEqual({ sent: false, reason: 'duplicado' });
    expect(mocks.sendAgentResponse).not.toHaveBeenCalled();
  });

  it('si Redis no responde, manda igual (no perder el aviso por el cerrojo)', async () => {
    redisSet.mockRejectedValue(new Error('redis caído'));
    const result = await notifyProfessionalOfDerivation({
      tenantId: 'c1',
      clinicName: 'Centro',
      derivation: DERIVATION,
      sourceConversationId: 'conv-paciente',
      connector: CONNECTOR,
    });

    expect(result.sent).toBe(true);
  });
});
