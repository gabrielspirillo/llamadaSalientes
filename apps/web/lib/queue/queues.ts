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
  // Reminders: el delay sale del cálculo scheduledFor - now. Si la regla tiene
  // fallback, el handler de send encola un 'reminder-fallback-check' al terminar.
  'reminder-send': {
    tenantId: string;
    reminderId: string;
  };
  'reminder-fallback-check': {
    tenantId: string;
    reminderId: string;
  };
};

export type QueueName = keyof QueueJobs;

export const QUEUE_NAMES = [
  'wa-process',
  'process-call',
  'reminder-send',
  'reminder-fallback-check',
] as const satisfies readonly QueueName[];
