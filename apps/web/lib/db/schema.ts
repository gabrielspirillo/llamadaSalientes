import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────────────────────
// Tenants & users
// ─────────────────────────────────────────────────────────────────────────────

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  plan: text('plan').notNull().default('starter'),
  status: text('status').notNull().default('active'), // active|suspended|trial
  clerkOrganizationId: text('clerk_organization_id').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const tenantMemberships = pgTable(
  'tenant_memberships',
  {
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    role: text('role').notNull(), // admin|operator|viewer
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.userId] }),
    userIdx: index('tenant_memberships_user_idx').on(t.userId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Clinic configuration
// ─────────────────────────────────────────────────────────────────────────────

export const clinicSettings = pgTable('clinic_settings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  address: text('address'),
  phones: jsonb('phones').$type<string[]>().default([]),
  workingHours:
    jsonb('working_hours').$type<Record<string, { open: string; close: string } | null>>(),
  timezone: text('timezone').notNull().default('America/Mexico_City'),
  defaultLanguage: text('default_language').notNull().default('es'),
  afterHoursMessage: text('after_hours_message'),
  recordingConsentText: text('recording_consent_text').notNull(),
  transferNumber: text('transfer_number'),
  optOutMessage: text('opt_out_message'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const treatments = pgTable(
  'treatments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    description: text('description'),
    durationMinutes: integer('duration_minutes').notNull(),
    priceMin: numeric('price_min'),
    priceMax: numeric('price_max'),
    // Precio puntual en centavos para revenue de slots optimizados (analytics).
    priceCents: integer('price_cents'),
    currency: text('currency').default('EUR'),
    ghlCalendarId: text('ghl_calendar_id'),
    assignedDentists: jsonb('assigned_dentists').$type<string[]>().default([]),
    active: boolean('active').default(true),
    // Si true, este tratamiento entra al pool de waitlist (citas adelantadas).
    // Ver migración 0014_waitlist.sql.
    waitlistEligible: boolean('waitlist_eligible').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantIdx: index('treatments_tenant_idx').on(t.tenantId),
  }),
);

export const faqs = pgTable(
  'faqs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    category: text('category'),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    priority: integer('priority').default(0),
    // V1: añadir vector(1536) cuando habilitemos pgvector
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantIdx: index('faqs_tenant_idx').on(t.tenantId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Agent
// ─────────────────────────────────────────────────────────────────────────────

export const agentConfigs = pgTable(
  'agent_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    role: text('role').notNull().default('inbound'), // inbound | outbound
    retellAgentId: text('retell_agent_id'),
    retellLlmId: text('retell_llm_id'),
    promptVersion: integer('prompt_version').default(1),
    currentPromptText: text('current_prompt_text').notNull(),
    voiceId: text('voice_id').notNull(),
    tone: text('tone').default('cercano'),
    transferNumber: text('transfer_number'),
    welcomeMessage: text('welcome_message'),
    published: boolean('published').default(false),
    lastTestCallId: text('last_test_call_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantRoleUnique: unique('agent_configs_tenant_role_unique').on(t.tenantId, t.role),
  }),
);

export const agentPromptVersions = pgTable(
  'agent_prompt_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    agentConfigId: uuid('agent_config_id')
      .references(() => agentConfigs.id, { onDelete: 'cascade' })
      .notNull(),
    version: integer('version').notNull(),
    promptText: text('prompt_text').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('agent_prompt_versions_tenant_idx').on(t.tenantId),
    agentIdx: index('agent_prompt_versions_agent_idx').on(t.agentConfigId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Integrations
// ─────────────────────────────────────────────────────────────────────────────

export const ghlIntegrations = pgTable('ghl_integrations', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  locationId: text('location_id').notNull(),
  companyId: text('company_id'),
  accessTokenEnc: text('access_token_enc').notNull(),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  scopes: text('scopes').notNull(),
  connectedBy: uuid('connected_by').references(() => users.id),
  connectedAt: timestamp('connected_at', { withTimezone: true }).defaultNow().notNull(),
});

// Configuración de telefonía por-tenant (Caller ID saliente + número
// entrante propio del tenant). Soporta dos providers: Twilio y Zadarma.
// Ver supabase/migrations/0006_tenant_telephony.sql + 0010_telephony_zadarma.sql.
export const tenantTelephony = pgTable(
  'tenant_telephony',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // 'twilio' | 'zadarma'. Default 'twilio' por compatibilidad con tenants
    // pre-migración.
    provider: text('provider').notNull().default('twilio'),
    // Twilio creds (provider='twilio').
    twilioAccountSid: text('twilio_account_sid'),
    twilioAuthTokenEnc: text('twilio_auth_token_enc'),
    // Zadarma creds (provider='zadarma').
    zadarmaUserKey: text('zadarma_user_key'),
    zadarmaSecretEnc: text('zadarma_secret_enc'),
    zadarmaWebhookSecretEnc: text('zadarma_webhook_secret_enc'),
    // Caller ID saliente. Compartido entre providers.
    callerIdE164: text('caller_id_e164'),
    // Sólo Twilio: SID del OutgoingCallerId. Zadarma NO usa SIDs (los
    // "verified personal numbers" se identifican por número).
    callerIdSid: text('caller_id_sid'),
    callerIdVerifiedAt: timestamp('caller_id_verified_at', { withTimezone: true }),
    // Número entrante propio del tenant. Compartido entre providers.
    inboundNumberE164: text('inbound_number_e164'),
    // Sólo Twilio: SID del IncomingPhoneNumber.
    inboundNumberSid: text('inbound_number_sid'),
    inboundConfiguredAt: timestamp('inbound_configured_at', { withTimezone: true }),
    // 'agent' (Retell) | 'forward' (transferir a un humano sin pasar por el agente)
    inboundRoute: text('inbound_route').notNull().default('agent'),
    inboundForwardNumber: text('inbound_forward_number'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    inboundNumberIdx: index('tenant_telephony_inbound_number_idx').on(t.inboundNumberE164),
    providerIdx: index('tenant_telephony_provider_idx').on(t.provider),
  }),
);

export const phoneNumbers = pgTable(
  'phone_numbers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    e164: text('e164').notNull().unique(),
    twilioSid: text('twilio_sid').notNull(),
    retellPhoneId: text('retell_phone_id'),
    agentId: uuid('agent_id').references(() => agentConfigs.id),
    active: boolean('active').default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantIdx: index('phone_numbers_tenant_idx').on(t.tenantId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Calls
// ─────────────────────────────────────────────────────────────────────────────

export const calls = pgTable(
  'calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    retellCallId: text('retell_call_id').notNull().unique(),
    fromNumber: text('from_number'),
    toNumber: text('to_number'),
    ghlContactId: text('ghl_contact_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    durationSeconds: integer('duration_seconds'),
    status: text('status'), // ongoing|ended|error
    intent: text('intent'),
    sentiment: text('sentiment'),
    transferred: boolean('transferred').default(false),
    transcriptEnc: text('transcript_enc'),
    recordingR2Key: text('recording_r2_key'),
    summary: text('summary'),
    customData: jsonb('custom_data').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantStartedIdx: index('calls_tenant_started_idx').on(t.tenantId, t.startedAt),
    intentIdx: index('calls_intent_idx').on(t.intent),
  }),
);

export const callEvents = pgTable(
  'call_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    callId: text('call_id').notNull(),
    event: text('event').notNull(),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => ({
    uniqCallEvent: unique('call_events_call_event_unique').on(t.callId, t.event),
    tenantIdx: index('call_events_tenant_idx').on(t.tenantId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Outbound calls module (campañas batch)
// ─────────────────────────────────────────────────────────────────────────────

export const outboundCampaigns = pgTable(
  'outbound_campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    useCase: text('use_case').notNull(), // payment | info | reminder | reactivation | custom
    status: text('status').notNull().default('draft'), // draft | dispatching | running | paused | completed | failed
    fromPhoneId: uuid('from_phone_id').references(() => phoneNumbers.id),
    overrideAgentId: text('override_agent_id'), // retell agent id (cacheado al dispatch)
    retellBatchCallId: text('retell_batch_call_id'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    callWindowStart: integer('call_window_start'), // minutos desde 00:00 local
    callWindowEnd: integer('call_window_end'),
    timezone: text('timezone'),
    maxRetries: integer('max_retries').notNull().default(0),
    retryDelayMinutes: integer('retry_delay_minutes').notNull().default(60),
    sharedDynamicVars: jsonb('shared_dynamic_vars').$type<Record<string, string>>().default({}),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('outbound_campaigns_tenant_idx').on(t.tenantId, t.createdAt),
    statusIdx: index('outbound_campaigns_status_idx').on(t.tenantId, t.status),
  }),
);

export const outboundTargets = pgTable(
  'outbound_targets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .references(() => outboundCampaigns.id, { onDelete: 'cascade' })
      .notNull(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    toNumber: text('to_number').notNull(),
    patientName: text('patient_name'),
    email: text('email'),
    ghlContactId: text('ghl_contact_id'),
    dynamicVars: jsonb('dynamic_vars').$type<Record<string, string>>().default({}),
    status: text('status').notNull().default('pending'),
    // pending | queued | ongoing | ended | voicemail | no_answer | busy | failed | skipped
    attempts: integer('attempts').notNull().default(0),
    retellCallId: text('retell_call_id'),
    lastDisconnectionReason: text('last_disconnection_reason'),
    lastError: text('last_error'),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    campaignIdx: index('outbound_targets_campaign_idx').on(t.campaignId, t.status),
    tenantIdx: index('outbound_targets_tenant_idx').on(t.tenantId),
    retellCallIdx: index('outbound_targets_retell_call_idx').on(t.retellCallId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Cache (replicas read-only de GHL)
// ─────────────────────────────────────────────────────────────────────────────

export const patientsCache = pgTable(
  'patients_cache',
  {
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    ghlContactId: text('ghl_contact_id').notNull(),
    phone: text('phone'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    email: text('email'),
    lastVisitAt: timestamp('last_visit_at', { withTimezone: true }),
    summary: text('summary'),
    pendingTreatment: text('pending_treatment'),
    voiceAgentPriority: text('voice_agent_priority'), // alto|medio|bajo
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.ghlContactId] }),
    phoneIdx: index('patients_cache_phone_idx').on(t.tenantId, t.phone),
  }),
);

export const appointmentsCache = pgTable(
  'appointments_cache',
  {
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    ghlAppointmentId: text('ghl_appointment_id').notNull(),
    contactId: text('contact_id'),
    calendarId: text('calendar_id'),
    treatmentId: uuid('treatment_id').references(() => treatments.id),
    startTime: timestamp('start_time', { withTimezone: true }),
    endTime: timestamp('end_time', { withTimezone: true }),
    status: text('status'),
    assignedUserId: text('assigned_user_id'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.ghlAppointmentId] }),
    startIdx: index('appointments_cache_start_idx').on(t.tenantId, t.startTime),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Operational logs
// ─────────────────────────────────────────────────────────────────────────────

export const webhookLogs = pgTable(
  'webhook_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id'),
    source: text('source').notNull(), // retell|ghl|stripe|twilio|clerk|whatsapp_cloud|whatsapp_evolution
    event: text('event'),
    signatureValid: boolean('signature_valid'),
    statusCode: integer('status_code'),
    body: jsonb('body'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    sourceIdx: index('webhook_logs_source_idx').on(t.source, t.createdAt),
  }),
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantIdx: index('audit_logs_tenant_idx').on(t.tenantId, t.createdAt),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Billing
// ─────────────────────────────────────────────────────────────────────────────

export const billingSubscriptions = pgTable('billing_subscriptions', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  stripeCustomerId: text('stripe_customer_id').notNull(),
  stripeSubscriptionId: text('stripe_subscription_id'),
  plan: text('plan').notNull(),
  status: text('status').notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  includedMinutes: integer('included_minutes').notNull(),
  usedMinutesPeriod: integer('used_minutes_period').default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp module (Meta Cloud API + Evolution self-hosted)
// ─────────────────────────────────────────────────────────────────────────────

export const whatsappModeEnum = pgEnum('whatsapp_mode', ['CLOUD', 'EVOLUTION', 'TWILIO']);
export const whatsappStatusEnum = pgEnum('whatsapp_status', [
  'PENDING',
  'CONNECTED',
  'DISCONNECTED',
  'ERROR',
]);
export const conversationChannelEnum = pgEnum('conversation_channel', [
  'WHATSAPP_CLOUD',
  'WHATSAPP_EVOLUTION',
  'WHATSAPP_TWILIO',
]);
export const conversationStatusEnum = pgEnum('conversation_status', [
  'ACTIVE',
  'HANDOFF',
  'CLOSED',
]);
export const messageDirectionEnum = pgEnum('message_direction', ['INBOUND', 'OUTBOUND']);
export const messageSenderEnum = pgEnum('message_sender', [
  'CONTACT',
  'AGENT',
  'HUMAN',
  'SYSTEM',
]);
export const messageDeliveryStatusEnum = pgEnum('message_delivery_status', [
  'PENDING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
]);
export const messageTypeEnum = pgEnum('message_type', [
  'TEXT',
  'AUDIO',
  'IMAGE',
  'PDF',
  'VIDEO',
  'STICKER',
  'LOCATION',
  'CONTACT',
  'TEMPLATE',
  'INTERACTIVE',
  'SYSTEM',
]);

export const whatsappConnections = pgTable(
  'whatsapp_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    mode: whatsappModeEnum('mode').notNull(),
    status: whatsappStatusEnum('status').notNull().default('PENDING'),
    qrB64: text('qr_b64'),
    wabaId: text('waba_id'),
    phoneId: text('phone_id'),
    cloudAccessTokenEnc: text('cloud_access_token_enc'),
    cloudAppSecretEnc: text('cloud_app_secret_enc'),
    evolutionInstance: text('evolution_instance'),
    evolutionTokenEnc: text('evolution_token_enc'),
    twilioAccountSid: text('twilio_account_sid'),
    twilioAuthTokenEnc: text('twilio_auth_token_enc'),
    twilioFromNumber: text('twilio_from_number'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantModeUnique: unique('whatsapp_connections_tenant_mode_unique').on(t.tenantId, t.mode),
    phoneIdIdx: index('whatsapp_connections_phone_id_idx').on(t.phoneId),
    tenantStatusIdx: index('whatsapp_connections_tenant_status_idx').on(t.tenantId, t.status),
    twilioFromIdx: index('whatsapp_connections_twilio_from_idx').on(t.twilioFromNumber),
  }),
);

export const whatsappContacts = pgTable(
  'whatsapp_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    phoneE164: text('phone_e164').notNull(),
    name: text('name'),
    ghlContactId: text('ghl_contact_id'),
    // Detalle de contacto (página /dashboard/whatsapp/contacts/[id]).
    avatarUrl: text('avatar_url'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    email: text('email'),
    city: text('city'),
    country: text('country'),
    address: text('address'),
    company: text('company'),
    socialLinks: jsonb('social_links').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantPhoneUnique: unique('whatsapp_contacts_tenant_phone_unique').on(
      t.tenantId,
      t.phoneE164,
    ),
    ghlIdx: index('whatsapp_contacts_ghl_idx').on(t.tenantId, t.ghlContactId),
  }),
);

export const whatsappContactNotes = pgTable(
  'whatsapp_contact_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    contactId: uuid('contact_id')
      .references(() => whatsappContacts.id, { onDelete: 'cascade' })
      .notNull(),
    body: text('body').notNull(),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    contactIdx: index('whatsapp_contact_notes_tenant_contact_idx').on(
      t.tenantId,
      t.contactId,
      t.createdAt,
    ),
  }),
);

export const whatsappConversations = pgTable(
  'whatsapp_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    contactId: uuid('contact_id')
      .references(() => whatsappContacts.id, { onDelete: 'cascade' })
      .notNull(),
    channel: conversationChannelEnum('channel').notNull(),
    status: conversationStatusEnum('status').notNull().default('ACTIVE'),
    urgentFlag: boolean('urgent_flag').notNull().default(false),
    aiEnabled: boolean('ai_enabled').notNull().default(true),
    lastMsgAt: timestamp('last_msg_at', { withTimezone: true }),
    assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
    humanTakeoverAt: timestamp('human_takeover_at', { withTimezone: true }),
    humanTakeoverUntil: timestamp('human_takeover_until', { withTimezone: true }),
    lastHumanMsgAt: timestamp('last_human_msg_at', { withTimezone: true }),
    // Estado libre para handoff específicos (ej: { remindersResume: { reminderId,
    // action: 'reschedule', expiresAt } }). El agente WA lo lee para arrancar
    // reagendado proactivamente con sus tools check_availability / book_appointment.
    context: jsonb('context')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantStatusIdx: index('whatsapp_conversations_tenant_status_idx').on(t.tenantId, t.status),
    tenantLastMsgIdx: index('whatsapp_conversations_tenant_last_msg_idx').on(
      t.tenantId,
      t.lastMsgAt,
    ),
    contactIdx: index('whatsapp_conversations_contact_idx').on(t.contactId),
  }),
);

export const whatsappMessages = pgTable(
  'whatsapp_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    conversationId: uuid('conversation_id')
      .references(() => whatsappConversations.id, { onDelete: 'cascade' })
      .notNull(),
    externalId: text('external_id'),
    direction: messageDirectionEnum('direction').notNull(),
    type: messageTypeEnum('type').notNull().default('TEXT'),
    senderType: messageSenderEnum('sender_type').notNull().default('CONTACT'),
    senderUserId: uuid('sender_user_id').references(() => users.id, { onDelete: 'set null' }),
    deliveryStatus: messageDeliveryStatusEnum('delivery_status'),
    failureReason: text('failure_reason'),
    internalNote: boolean('internal_note').notNull().default(false),
    clientNonce: uuid('client_nonce'),
    contentText: text('content_text'),
    mediaUrl: text('media_url'),
    mediaType: text('media_type'),
    transcription: text('transcription'),
    mediaAnalysisJson: jsonb('media_analysis_json').notNull().default({}),
    rawJson: jsonb('raw_json').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    convExternalUnique: unique('whatsapp_messages_conv_external_unique').on(
      t.conversationId,
      t.externalId,
    ),
    convNonceUnique: unique('whatsapp_messages_conv_nonce_unique').on(
      t.conversationId,
      t.clientNonce,
    ),
    tenantConvCreatedIdx: index('whatsapp_messages_tenant_conv_created_idx').on(
      t.tenantId,
      t.conversationId,
      t.createdAt,
    ),
    tenantSenderCreatedIdx: index('whatsapp_messages_tenant_sender_created_idx').on(
      t.tenantId,
      t.senderType,
      t.createdAt,
    ),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp inbox extras: tags, conversation_tags, quick_replies
// ─────────────────────────────────────────────────────────────────────────────

export const whatsappTags = pgTable(
  'whatsapp_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    label: text('label').notNull(),
    color: text('color').notNull().default('#71717a'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantLabelUnique: unique('whatsapp_tags_tenant_label_unique').on(t.tenantId, t.label),
    tenantIdx: index('whatsapp_tags_tenant_idx').on(t.tenantId),
  }),
);

export const whatsappConversationTags = pgTable(
  'whatsapp_conversation_tags',
  {
    conversationId: uuid('conversation_id')
      .references(() => whatsappConversations.id, { onDelete: 'cascade' })
      .notNull(),
    tagId: uuid('tag_id')
      .references(() => whatsappTags.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.conversationId, t.tagId] }),
    tagIdx: index('whatsapp_conversation_tags_tag_idx').on(t.tagId),
  }),
);

export const whatsappQuickReplies = pgTable(
  'whatsapp_quick_replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    shortcut: text('shortcut').notNull(),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantShortcutUnique: unique('whatsapp_quick_replies_tenant_shortcut_unique').on(
      t.tenantId,
      t.shortcut,
    ),
    tenantIdx: index('whatsapp_quick_replies_tenant_idx').on(t.tenantId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp agent runs: audit trail de cada invocación del agente conversacional.
// Un run por ventana del debouncer (5s). Sirve para observabilidad, debugging,
// analytics e idempotencia (unique conversation_id + trigger_message_id).
// ─────────────────────────────────────────────────────────────────────────────

export const agentIntentEnum = pgEnum('agent_intent', [
  'SCHEDULING',
  'FAQ',
  'URGENT',
  'HANDOFF',
  'OTHER',
]);

export const whatsappAgentRuns = pgTable(
  'whatsapp_agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    conversationId: uuid('conversation_id')
      .references(() => whatsappConversations.id, { onDelete: 'cascade' })
      .notNull(),
    // Último mensaje inbound de la ráfaga que disparó el agente. La uniqueness
    // (conversation_id, trigger_message_id) bloquea doble respuesta si Inngest
    // reintenta el job o el webhook llega duplicado.
    triggerMessageId: uuid('trigger_message_id').references(() => whatsappMessages.id, {
      onDelete: 'set null',
    }),
    // Mensaje outbound generado por el agente. NULL si solo hizo handoff/silencio.
    responseMessageId: uuid('response_message_id').references(() => whatsappMessages.id, {
      onDelete: 'set null',
    }),
    // Identificador lógico del agente: por ahora 'main' (single agent + tools).
    // Sin enum para poder agregar 'classifier', 'scheduling', etc. sin migrar.
    agent: text('agent').notNull().default('main'),
    // Modelo LLM final usado (post-fallback): ej. gemini-2.5-flash, gpt-4o.
    model: text('model').notNull(),
    intent: agentIntentEnum('intent'),
    // 0.00..1.00. Si <0.7 forzamos handoff.
    intentConfidence: numeric('intent_confidence', { precision: 3, scale: 2 }),
    intentReasoning: text('intent_reasoning'),
    handoff: boolean('handoff').notNull().default(false),
    urgent: boolean('urgent').notNull().default(false),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    // true si el provider primario (Gemini) falló y se usó OpenAI como fallback.
    fallbackUsed: boolean('fallback_used').notNull().default(false),
    // Array de tool-calls. Cada item:
    // { name, args, ok, result, latencyMs, error? }
    toolsCalled: jsonb('tools_called').notNull().default([]),
    errorText: text('error_text'),
    // Reservado para integración con tracing externo (Langfuse, Axiom, etc.).
    traceId: text('trace_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    convTriggerUnique: unique('whatsapp_agent_runs_conv_trigger_unique').on(
      t.conversationId,
      t.triggerMessageId,
    ),
    tenantConvCreatedIdx: index('whatsapp_agent_runs_tenant_conv_created_idx').on(
      t.tenantId,
      t.conversationId,
      t.createdAt,
    ),
    tenantIntentIdx: index('whatsapp_agent_runs_tenant_intent_idx').on(t.tenantId, t.intent),
    triggerMessageIdx: index('whatsapp_agent_runs_trigger_message_idx').on(t.triggerMessageId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Analytics: slot-fill attribution
//
// cancelled_slots: cola de citas canceladas (recovered_at IS NULL = pendiente).
// scheduling_offers: cita nueva que llenó un cancelled_slot, atribuida al
// canal (outbound / inbound / whatsapp) que originó la recuperación.
// ─────────────────────────────────────────────────────────────────────────────

export const schedulingOfferSourceEnum = pgEnum('scheduling_offer_source', [
  'outbound',
  'inbound',
  'whatsapp',
]);

export const cancelledSlots = pgTable(
  'cancelled_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    ghlAppointmentId: text('ghl_appointment_id').notNull(),
    calendarId: text('calendar_id'),
    treatmentId: uuid('treatment_id').references(() => treatments.id),
    ghlContactId: text('ghl_contact_id'),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }).defaultNow().notNull(),
    recoveredAt: timestamp('recovered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantApptUnique: unique('cancelled_slots_tenant_appt_unique').on(
      t.tenantId,
      t.ghlAppointmentId,
    ),
    tenantRecoveredIdx: index('cancelled_slots_tenant_recovered_idx').on(
      t.tenantId,
      t.recoveredAt,
      t.cancelledAt,
    ),
  }),
);

export const schedulingOffers = pgTable(
  'scheduling_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    cancelledSlotId: uuid('cancelled_slot_id')
      .references(() => cancelledSlots.id, { onDelete: 'cascade' })
      .notNull(),
    source: schedulingOfferSourceEnum('source').notNull(),
    triggerCallId: uuid('trigger_call_id').references(() => calls.id, { onDelete: 'set null' }),
    triggerWhatsappConversationId: uuid('trigger_whatsapp_conversation_id').references(
      () => whatsappConversations.id,
      { onDelete: 'set null' },
    ),
    triggerCampaignId: uuid('trigger_campaign_id').references(() => outboundCampaigns.id, {
      onDelete: 'set null',
    }),
    treatmentId: uuid('treatment_id').references(() => treatments.id),
    ghlAppointmentId: text('ghl_appointment_id').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).defaultNow().notNull(),
    estimatedRevenueCents: integer('estimated_revenue_cents').notNull().default(0),
    currency: text('currency').notNull().default('EUR'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantApptUnique: unique('scheduling_offers_tenant_appt_unique').on(
      t.tenantId,
      t.ghlAppointmentId,
    ),
    tenantAcceptedIdx: index('scheduling_offers_tenant_accepted_idx').on(
      t.tenantId,
      t.acceptedAt,
    ),
    tenantSourceIdx: index('scheduling_offers_tenant_source_idx').on(t.tenantId, t.source),
    cancelledSlotIdx: index('scheduling_offers_cancelled_slot_idx').on(t.cancelledSlotId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Recordatorios de citas
//
// 6 tablas:
//   reminder_rule_sets       — 1 GLOBAL por tenant + N por tratamiento (override).
//   reminder_rules           — N reglas por set (offset + canal primario + fallback).
//   reminder_message_templates — 1 template por (regla, driverScope).
//   appointment_reminders    — instancia materializada (1 por cita+regla).
//   reminder_confirmations   — respuestas (botón, voz, manual).
//   reminder_skip_log        — citas no recordables con motivo.
// ─────────────────────────────────────────────────────────────────────────────

export const reminderChannelEnum = pgEnum('reminder_channel', ['WHATSAPP', 'VOICE']);
export const reminderRuleScopeEnum = pgEnum('reminder_rule_scope', ['GLOBAL', 'TREATMENT']);
export const reminderStatusEnum = pgEnum('reminder_status', [
  'SCHEDULED',
  'SENT',
  'DELIVERED',
  'CONFIRMED',
  'RESCHEDULE_REQUESTED',
  'CANCELLED',
  'NO_RESPONSE',
  'SKIPPED',
  'FAILED',
]);
export const reminderSkipReasonEnum = pgEnum('reminder_skip_reason', [
  'no_phone',
  'past_due',
  'no_rules',
  'no_whatsapp',
  'no_voice_agent',
  'no_template',
  'quiet_hours_full_day',
  'opt_out',
  'appointment_cancelled',
  'duplicate',
]);
export const reminderConfirmationActionEnum = pgEnum('reminder_confirmation_action', [
  'confirm',
  'reschedule',
  'cancel',
]);
export const reminderConfirmationSourceEnum = pgEnum('reminder_confirmation_source', [
  'button',
  'voice',
  'manual',
  'inbound_text',
]);
export const reminderQuietModeEnum = pgEnum('reminder_quiet_mode', [
  'SHIFT_INTO_HOURS',
  'SKIP',
]);

// driver_scope va como text (no enum) para permitir agregar nuevos drivers
// sin migración (futuro: 'sms_twilio', 'voice_telnyx', etc.).
export type ReminderDriverScope =
  | 'whatsapp_cloud'
  | 'whatsapp_twilio'
  | 'whatsapp_evolution'
  | 'voice_retell';

export type ReminderButton = { id: string; title: string };

export type ReminderTemplateParam =
  | { source: string } // path en vars: 'contact.first_name', 'appointment.date'
  | { literal: string }; // valor fijo

export const reminderRuleSets = pgTable(
  'reminder_rule_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    scope: reminderRuleScopeEnum('scope').notNull(),
    treatmentId: uuid('treatment_id').references(() => treatments.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    quietMode: reminderQuietModeEnum('quiet_mode').notNull().default('SHIFT_INTO_HOURS'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantEnabledIdx: index('reminder_rule_sets_tenant_enabled_idx').on(t.tenantId, t.enabled),
  }),
);

export const reminderRules = pgTable(
  'reminder_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    ruleSetId: uuid('rule_set_id')
      .references(() => reminderRuleSets.id, { onDelete: 'cascade' })
      .notNull(),
    // Minutos antes de la cita (positivo). 1440 = 24h, 4320 = 72h.
    offsetMinutes: integer('offset_minutes').notNull(),
    primaryChannel: reminderChannelEnum('primary_channel').notNull(),
    fallbackChannel: reminderChannelEnum('fallback_channel'),
    // Horas a esperar antes de disparar el fallback (1..72).
    fallbackWindowHours: integer('fallback_window_hours'),
    label: text('label'),
    order: integer('order').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    setOrderIdx: index('reminder_rules_set_order_idx').on(t.ruleSetId, t.order),
    tenantEnabledIdx: index('reminder_rules_tenant_enabled_idx').on(t.tenantId, t.enabled),
  }),
);

export const reminderMessageTemplates = pgTable(
  'reminder_message_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    ruleId: uuid('rule_id')
      .references(() => reminderRules.id, { onDelete: 'cascade' })
      .notNull(),
    channel: reminderChannelEnum('channel').notNull(),
    driverScope: text('driver_scope').notNull().$type<ReminderDriverScope>(),
    templateName: text('template_name'),
    templateLanguage: text('template_language').notNull().default('es'),
    templateParamsMap:
      jsonb('template_params_map').$type<ReminderTemplateParam[]>().notNull().default([]),
    freeText: text('free_text'),
    buttons: jsonb('buttons').$type<ReminderButton[]>().notNull().default([]),
    voicePromptOverride: text('voice_prompt_override'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    ruleDriverUnique: unique('reminder_message_templates_rule_driver_unique').on(
      t.ruleId,
      t.driverScope,
    ),
    tenantChannelIdx: index('reminder_message_templates_tenant_channel_idx').on(
      t.tenantId,
      t.channel,
    ),
  }),
);

export const appointmentReminders = pgTable(
  'appointment_reminders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    // text sin FK directa a appointments_cache (la cache puede rebuildearse
    // y queremos preservar el histórico de reminders).
    ghlAppointmentId: text('ghl_appointment_id').notNull(),
    ruleId: uuid('rule_id')
      .references(() => reminderRules.id, { onDelete: 'restrict' })
      .notNull(),
    ruleSetId: uuid('rule_set_id')
      .references(() => reminderRuleSets.id, { onDelete: 'restrict' })
      .notNull(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    channelPlanned: reminderChannelEnum('channel_planned').notNull(),
    channelUsed: reminderChannelEnum('channel_used'),
    status: reminderStatusEnum('status').notNull().default('SCHEDULED'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    bullJobId: text('bull_job_id'),
    bullFallbackJobId: text('bull_fallback_job_id'),
    externalCallId: text('external_call_id'),
    externalMessageId: uuid('external_message_id'),
    failureReason: text('failure_reason'),
    // Snapshot de variables al programar (firstName, fecha, etc.). Sobrevive
    // a cambios en appointments_cache para retry/debugging.
    payloadSnapshot:
      jsonb('payload_snapshot').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantApptRuleUnique: unique('appointment_reminders_tenant_appt_rule_unique').on(
      t.tenantId,
      t.ghlAppointmentId,
      t.ruleId,
    ),
    tenantStatusSchedIdx: index('appointment_reminders_tenant_status_sched_idx').on(
      t.tenantId,
      t.status,
      t.scheduledFor,
    ),
    tenantApptIdx: index('appointment_reminders_tenant_appt_idx').on(t.tenantId, t.ghlAppointmentId),
    externalCallIdx: index('appointment_reminders_external_call_idx').on(t.externalCallId),
  }),
);

export const reminderConfirmations = pgTable(
  'reminder_confirmations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    reminderId: uuid('reminder_id')
      .references(() => appointmentReminders.id, { onDelete: 'cascade' })
      .notNull(),
    action: reminderConfirmationActionEnum('action').notNull(),
    source: reminderConfirmationSourceEnum('source').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => ({
    tenantReminderIdx: index('reminder_confirmations_tenant_reminder_idx').on(
      t.tenantId,
      t.reminderId,
    ),
  }),
);

export const reminderSkipLog = pgTable(
  'reminder_skip_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    ghlAppointmentId: text('ghl_appointment_id').notNull(),
    ruleId: uuid('rule_id').references(() => reminderRules.id, { onDelete: 'set null' }),
    reason: reminderSkipReasonEnum('reason').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantCreatedIdx: index('reminder_skip_log_tenant_created_idx').on(t.tenantId, t.createdAt),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Waitlist (citas adelantadas / FIFO de slots liberados)
//
// 4 tablas + 1 columna en treatments (waitlist_eligible).
//   waitlist_settings        — 1 fila por tenant: canal, TTL, umbrales, filtros.
//   waitlist_entries         — cola FIFO de pacientes con cita futura elegibles.
//   waitlist_offers          — oferta puntual (entry × cancelled_slot) con TTL.
//   waitlist_message_templates — paralela a reminder_message_templates.
//
// Reusa cancelled_slots (0005) como fuente de huecos a llenar y scheduling_offers
// (0005) para atribuir revenue cuando una oferta cierra. Ver migración 0014_waitlist.sql.
// ─────────────────────────────────────────────────────────────────────────────

export const waitlistStatusEnum = pgEnum('waitlist_status', [
  'ACTIVE',
  'PAUSED',
  'FULFILLED',
  'REMOVED',
]);
export const waitlistOfferStatusEnum = pgEnum('waitlist_offer_status', [
  'PENDING',
  'SENT',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'SUPERSEDED',
]);
export const waitlistOfferChannelEnum = pgEnum('waitlist_offer_channel', ['WHATSAPP', 'VOICE']);
export const waitlistChannelModeEnum = pgEnum('waitlist_channel_mode', [
  'WHATSAPP_ONLY',
  'VOICE_ONLY',
  'WHATSAPP_THEN_VOICE',
]);
export const waitlistEntrySourceEnum = pgEnum('waitlist_entry_source', ['auto', 'manual']);
export const waitlistOfferResponseViaEnum = pgEnum('waitlist_offer_response_via', [
  'button',
  'text',
  'voice_tool',
  'manual',
]);

// driver_scope se comparte con reminders. Re-export del tipo para callers de waitlist.
export type WaitlistDriverScope = ReminderDriverScope;
export type WaitlistButton = ReminderButton;
export type WaitlistTemplateParam = ReminderTemplateParam;

export const waitlistSettings = pgTable('waitlist_settings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(true),
  channelMode: waitlistChannelModeEnum('channel_mode').notNull().default('WHATSAPP_ONLY'),
  ttlMinutesDefault: integer('ttl_minutes_default').notNull().default(240),
  ttlMinutesNearSlot: integer('ttl_minutes_near_slot').notNull().default(60),
  nearSlotHoursThreshold: integer('near_slot_hours_threshold').notNull().default(12),
  minSkipHoursThreshold: integer('min_skip_hours_threshold').notNull().default(2),
  whatsappToVoiceWindowMinutes: integer('whatsapp_to_voice_window_minutes').notNull().default(60),
  minAppointmentDistanceDays: integer('min_appointment_distance_days').notNull().default(7),
  // NULL = sin límite. Si está seteado, citas con start_time > now + N días
  // no entran a la waitlist automática.
  maxAppointmentDistanceDays: integer('max_appointment_distance_days'),
  minAdvanceDays: integer('min_advance_days').notNull().default(1),
  requireSameDentist: boolean('require_same_dentist').notNull().default(false),
  respectTimeWindow: boolean('respect_time_window').notNull().default(false),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const waitlistEntries = pgTable(
  'waitlist_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    ghlContactId: text('ghl_contact_id').notNull(),
    ghlAppointmentId: text('ghl_appointment_id').notNull(),
    treatmentId: uuid('treatment_id').references(() => treatments.id, { onDelete: 'set null' }),
    calendarId: text('calendar_id'),
    assignedDentistId: text('assigned_dentist_id'),
    originalStartTime: timestamp('original_start_time', { withTimezone: true }).notNull(),
    originalEndTime: timestamp('original_end_time', { withTimezone: true }),
    preferredTimeWindowStart: text('preferred_time_window_start'),
    preferredTimeWindowEnd: text('preferred_time_window_end'),
    status: waitlistStatusEnum('status').notNull().default('ACTIVE'),
    source: waitlistEntrySourceEnum('source').notNull().default('auto'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (t) => ({
    tenantApptUnique: unique('waitlist_entries_tenant_appt_unique').on(
      t.tenantId,
      t.ghlAppointmentId,
    ),
    tenantStatusIdx: index('waitlist_entries_tenant_status_idx').on(
      t.tenantId,
      t.status,
      t.createdAt,
    ),
    contactIdx: index('waitlist_entries_contact_idx').on(t.tenantId, t.ghlContactId),
  }),
);

export const waitlistOffers = pgTable(
  'waitlist_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    waitlistEntryId: uuid('waitlist_entry_id')
      .references(() => waitlistEntries.id, { onDelete: 'cascade' })
      .notNull(),
    cancelledSlotId: uuid('cancelled_slot_id')
      .references(() => cancelledSlots.id, { onDelete: 'cascade' })
      .notNull(),
    channel: waitlistOfferChannelEnum('channel').notNull(),
    driverScope: text('driver_scope').notNull().$type<WaitlistDriverScope>(),
    status: waitlistOfferStatusEnum('status').notNull().default('PENDING'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    responseVia: waitlistOfferResponseViaEnum('response_via'),
    externalMessageId: uuid('external_message_id'),
    externalCallId: text('external_call_id'),
    bullSendJobId: text('bull_send_job_id'),
    bullExpireJobId: text('bull_expire_job_id'),
    payloadSnapshot:
      jsonb('payload_snapshot').$type<Record<string, unknown>>().notNull().default({}),
    errorMessage: text('error_message'),
    previousOfferId: uuid('previous_offer_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantStatusIdx: index('waitlist_offers_tenant_status_idx').on(
      t.tenantId,
      t.status,
      t.expiresAt,
    ),
    cancelledSlotIdx: index('waitlist_offers_cancelled_slot_idx').on(t.cancelledSlotId, t.status),
    entryIdx: index('waitlist_offers_entry_idx').on(t.waitlistEntryId, t.createdAt),
  }),
);

export const waitlistMessageTemplates = pgTable(
  'waitlist_message_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    channel: waitlistOfferChannelEnum('channel').notNull(),
    driverScope: text('driver_scope').notNull().$type<WaitlistDriverScope>(),
    templateName: text('template_name'),
    templateLanguage: text('template_language').notNull().default('es'),
    templateParamsMap:
      jsonb('template_params_map').$type<WaitlistTemplateParam[]>().notNull().default([]),
    freeText: text('free_text'),
    buttons: jsonb('buttons').$type<WaitlistButton[]>().notNull().default([]),
    voicePromptOverride: text('voice_prompt_override'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantDriverUnique: unique('waitlist_message_templates_tenant_driver_unique').on(
      t.tenantId,
      t.driverScope,
    ),
    tenantChannelIdx: index('waitlist_message_templates_tenant_channel_idx').on(
      t.tenantId,
      t.channel,
    ),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// SQL helpers (RLS preparado pero NO activado en Fase 1; se enciende en Fase 7)
// ─────────────────────────────────────────────────────────────────────────────

export const setCurrentTenant = sql`set local app.current_tenant`;
