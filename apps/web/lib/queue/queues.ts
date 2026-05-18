// Catálogo de jobs. Tipado fuerte para que productores y consumidores
// comparten la misma firma de `data`.
//
// Cada nombre aquí es a la vez el nombre de la queue de BullMQ y el del job.
// Una queue = un job type, simplifica.

export type QueueJobs = {
  'wa-process': {
    tenantId: string;
    conversationId: string;
    messageId: string;
    contactPhoneE164: string;
  };
  'process-call': {
    tenantId: string;
    retellCallId: string;
    recordingUrl?: string | null;
    transcript?: string | null;
    analysisSummary?: string | null;
  };
};

export type QueueName = keyof QueueJobs;

export const QUEUE_NAMES = ['wa-process', 'process-call'] as const satisfies readonly QueueName[];
