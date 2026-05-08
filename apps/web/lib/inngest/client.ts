import 'server-only';
import { Inngest } from 'inngest';

// Catálogo de eventos. Tipado fuerte para evitar typos al emitirlos.
export type InngestEvents = {
  'call/process.requested': {
    data: {
      tenantId: string;
      retellCallId: string;
      recordingUrl?: string | null;
      transcript?: string | null;
      analysisSummary?: string | null;
    };
  };
};

export const inngest = new Inngest({
  id: 'dental-voice',
  schemas: undefined as never, // tipos fuertes via overload below
});

// Helper tipado para emitir eventos
export async function sendInngestEvent<K extends keyof InngestEvents>(
  name: K,
  payload: InngestEvents[K],
): Promise<void> {
  // En tests/preview sin INNGEST_EVENT_KEY no enviamos nada (no crashea)
  if (!process.env.INNGEST_EVENT_KEY && process.env.NODE_ENV === 'production') {
    console.warn(`[inngest] INNGEST_EVENT_KEY no seteada, evento ${name} no enviado`);
    return;
  }
  if (!process.env.INNGEST_EVENT_KEY) {
    console.log(`[inngest] dev/test sin key, simulando envío de ${name}`);
    return;
  }
  await inngest.send({ name, data: payload.data });
}
