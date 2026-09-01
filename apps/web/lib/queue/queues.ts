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
  // Waitlist: oferta de slot adelantado por WhatsApp o Voz. El delay = 0 (se
  // dispara inmediato al detectar el cancelled_slot). expireOfferAndAdvance se
  // ejecuta vía 'waitlist-offer-expire' con delay = TTL.
  'waitlist-offer-send': {
    tenantId: string;
    offerId: string;
  };
  'waitlist-offer-expire': {
    tenantId: string;
    offerId: string;
  };
  // Tareas: tick repetible que materializa las rutinas de todas las clínicas
  // (apertura, cierre, control biológico...) en su propia timezone.
  'task-routines-tick': Record<string, never>;
  // Tareas: barrido diario sobre datos de estado (presupuestos aceptados sin
  // agendar, pacientes inactivos). No hay webhook que los dispare.
  'task-daily-sweep': Record<string, never>;
};

export type QueueName = keyof QueueJobs;

export const QUEUE_NAMES = [
  'wa-process',
  'process-call',
  'reminder-send',
  'reminder-fallback-check',
  'waitlist-offer-send',
  'waitlist-offer-expire',
  'task-routines-tick',
  'task-daily-sweep',
] as const satisfies readonly QueueName[];
