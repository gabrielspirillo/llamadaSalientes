import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  insertValues: vi.fn(),
  returning: vi.fn(),
  selectByExternal: vi.fn(),
  updateLastMsg: vi.fn(),
}));

vi.mock('@/lib/db/client', () => {
  const insertChain = {
    values: (row: unknown) => {
      mocks.insertValues(row);
      return {
        onConflictDoNothing: () => ({
          returning: () => mocks.returning(),
        }),
      };
    },
  };
  const updateChain = {
    set: () => updateChain,
    where: async () => {
      mocks.updateLastMsg();
    },
  };
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: async () => mocks.selectByExternal(),
  };
  return {
    db: {
      insert: () => insertChain,
      update: () => updateChain,
      select: () => selectChain,
    },
  };
});

vi.mock('@/lib/db/schema', () => ({
  whatsappMessages: {
    id: 'id',
    conversationId: 'conversationId',
    externalId: 'externalId',
  },
  whatsappConversations: { id: 'id' },
}));

import { sendAgentResponse } from '@/lib/whatsapp/outbound/send-response';
import type { WhatsAppConnector } from '@/lib/whatsapp/types';

function fakeConnector(
  channel: 'whatsapp_cloud' | 'whatsapp_evolution' | 'whatsapp_twilio' = 'whatsapp_cloud',
) {
  const sendText = vi.fn(async () => ({ id: 'wamid-1', channel }));
  const sendButtons = vi.fn(async () => ({ id: 'wamid-btn-1', channel }));
  return {
    channel,
    sendText,
    sendButtons,
    sendList: vi.fn(),
    sendTemplate: vi.fn(),
    sendMedia: vi.fn(),
    downloadMedia: vi.fn(),
    sendTyping: vi.fn(),
  } as unknown as WhatsAppConnector;
}

beforeEach(() => {
  mocks.insertValues.mockReset();
  mocks.returning.mockReset();
  mocks.selectByExternal.mockReset();
  mocks.updateLastMsg.mockReset();
});

describe('sendAgentResponse', () => {
  it('envía texto, persiste TEXT outbound y actualiza lastMsgAt', async () => {
    mocks.returning.mockResolvedValue([{ id: 'msg-out-1' }]);
    const connector = fakeConnector('whatsapp_cloud');

    const out = await sendAgentResponse({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      toPhoneE164: '+34699111222',
      text: 'Vale, te ayudo con eso.',
      buttons: null,
      connector,
    });

    expect(out.messageId).toBe('msg-out-1');
    expect(out.externalId).toBe('wamid-1');
    expect(out.kind).toBe('text');
    expect(connector.sendText).toHaveBeenCalledWith('+34699111222', 'Vale, te ayudo con eso.');
    expect(connector.sendButtons).not.toHaveBeenCalled();
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'OUTBOUND',
        type: 'TEXT',
        senderType: 'AGENT',
        externalId: 'wamid-1',
      }),
    );
    expect(mocks.updateLastMsg).toHaveBeenCalled();
  });

  it('con buttons (1-3) envía interactive', async () => {
    mocks.returning.mockResolvedValue([{ id: 'msg-out-2' }]);
    const connector = fakeConnector('whatsapp_cloud');

    const out = await sendAgentResponse({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      toPhoneE164: '+34699111222',
      text: '¿Qué horario prefieres?',
      buttons: [
        { id: 'slot-0', title: 'Lun 10:00' },
        { id: 'slot-1', title: 'Mar 11:00' },
      ],
      connector,
    });

    expect(out.kind).toBe('buttons');
    expect(out.externalId).toBe('wamid-btn-1');
    expect(connector.sendButtons).toHaveBeenCalledWith(
      '+34699111222',
      '¿Qué horario prefieres?',
      expect.any(Array),
    );
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'INTERACTIVE' }),
    );
  });

  it('si el insert no devuelve (conflict), recupera la fila por externalId', async () => {
    // returning vacío = onConflict ya existía.
    mocks.returning.mockResolvedValue([]);
    mocks.selectByExternal.mockResolvedValue([{ id: 'msg-existing' }]);
    const connector = fakeConnector('whatsapp_cloud');

    const out = await sendAgentResponse({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      toPhoneE164: '+34699111222',
      text: 'retry',
      buttons: null,
      connector,
    });

    expect(out.messageId).toBe('msg-existing');
  });

  it('más de 3 botones → cae a texto plano', async () => {
    mocks.returning.mockResolvedValue([{ id: 'msg-out-3' }]);
    const connector = fakeConnector('whatsapp_cloud');

    await sendAgentResponse({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      toPhoneE164: '+34699111222',
      text: 'demasiados',
      buttons: [
        { id: '1', title: 'a' },
        { id: '2', title: 'b' },
        { id: '3', title: 'c' },
        { id: '4', title: 'd' },
      ],
      connector,
    });

    expect(connector.sendText).toHaveBeenCalledTimes(1);
    expect(connector.sendButtons).not.toHaveBeenCalled();
  });
});
