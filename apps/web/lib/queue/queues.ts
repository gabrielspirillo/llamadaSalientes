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
  // Un mensaje mandado desde el teléfono de la clínica (no desde la app):
  // se refleja en el chat. Retardado para no duplicar lo que mandó la app.
  'wa-echo': {
    message: {
      tenantId: string;
      providerMessageId: string;
      fromPhoneE164: string;
      channel: 'WHATSAPP_CLOUD' | 'WHATSAPP_EVOLUTION' | 'WHATSAPP_TWILIO';
      type: import('@/lib/whatsapp/types').InboundMessageType;
      text: string | null;
      mediaId: string | null;
      mediaMimeType: string | null;
      contactName: string | null;
      /** ISO: el job viaja como JSON. */
      timestamp: string;
      raw: unknown;
    };
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
  // Mensajes: tick cada 30 min que publica el resumen diario en #general de
  // cada clínica cuando en SU timezone son las 08:00. El job decide a quién
  // le toca, igual que 'task-routines-tick'.
  'im-digest': Record<string, never>;
  // Mensajes: escalado de una mención que sigue sin leer pasados N minutos.
  // Job retardado (delay = escalate_mentions_after_minutes). Apagado por
  // defecto: la columna arranca en 0 y sin eso no se encola nada.
  'im-mention-escalate': {
    tenantId: string;
    mentionId: string;
  };
  // Mensajes: borrado duro de lo que superó la retención del tenant. Es la
  // pata operativa de la postura RGPD del módulo.
  'im-retention-sweep': Record<string, never>;
  // Confirmación obligatoria el día de la cita (perfil de atención): tick
  // cada 5 min que manda el recordatorio, insiste, avisa para llamar y anula.
  'day-of-tick': Record<string, never>;
};

export type QueueName = keyof QueueJobs;

export const QUEUE_NAMES = [
  'wa-process',
  'wa-echo',
  'process-call',
  'reminder-send',
  'reminder-fallback-check',
  'waitlist-offer-send',
  'waitlist-offer-expire',
  'task-routines-tick',
  'task-daily-sweep',
  'im-digest',
  'im-mention-escalate',
  'im-retention-sweep',
  'day-of-tick',
] as const satisfies readonly QueueName[];
