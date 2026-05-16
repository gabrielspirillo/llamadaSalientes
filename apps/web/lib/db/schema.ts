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
    currency: text('currency').default('USD'),
    ghlCalendarId: text('ghl_calendar_id'),
    assignedDentists: jsonb('assigned_dentists').$type<string[]>().default([]),
    active: boolean('active').default(true),
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
    lastMsgAt: timestamp('last_msg_at', { withTimezone: true }),
    assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
    humanTakeoverAt: timestamp('human_takeover_at', { withTimezone: true }),
    humanTakeoverUntil: timestamp('human_takeover_until', { withTimezone: true }),
    lastHumanMsgAt: timestamp('last_human_msg_at', { withTimezone: true }),
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
// SQL helpers (RLS preparado pero NO activado en Fase 1; se enciende en Fase 7)
// ─────────────────────────────────────────────────────────────────────────────

export const setCurrentTenant = sql`set local app.current_tenant`;
