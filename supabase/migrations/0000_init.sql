CREATE TABLE "agent_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"retell_agent_id" text,
	"retell_llm_id" text,
	"prompt_version" integer DEFAULT 1,
	"current_prompt_text" text NOT NULL,
	"voice_id" text NOT NULL,
	"tone" text DEFAULT 'cercano',
	"transfer_number" text,
	"welcome_message" text,
	"published" boolean DEFAULT false,
	"last_test_call_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_configs_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "agent_prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_config_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"prompt_text" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "appointments_cache" (
	"tenant_id" uuid NOT NULL,
	"ghl_appointment_id" text NOT NULL,
	"contact_id" text,
	"calendar_id" text,
	"treatment_id" uuid,
	"start_time" timestamp with time zone,
	"end_time" timestamp with time zone,
	"status" text,
	"assigned_user_id" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_cache_tenant_id_ghl_appointment_id_pk" PRIMARY KEY("tenant_id","ghl_appointment_id")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_subscriptions" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text,
	"plan" text NOT NULL,
	"status" text NOT NULL,
	"current_period_end" timestamp with time zone,
	"included_minutes" integer NOT NULL,
	"used_minutes_period" integer DEFAULT 0,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"call_id" text NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "call_events_call_event_unique" UNIQUE("call_id","event")
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"retell_call_id" text NOT NULL,
	"from_number" text,
	"to_number" text,
	"ghl_contact_id" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"status" text,
	"intent" text,
	"sentiment" text,
	"transferred" boolean DEFAULT false,
	"transcript_enc" text,
	"recording_r2_key" text,
	"summary" text,
	"custom_data" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calls_retell_call_id_unique" UNIQUE("retell_call_id")
);
--> statement-breakpoint
CREATE TABLE "clinic_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"address" text,
	"phones" jsonb DEFAULT '[]'::jsonb,
	"working_hours" jsonb,
	"timezone" text DEFAULT 'America/Mexico_City' NOT NULL,
	"default_language" text DEFAULT 'es' NOT NULL,
	"after_hours_message" text,
	"recording_consent_text" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "faqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category" text,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"priority" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ghl_integrations" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"location_id" text NOT NULL,
	"company_id" text,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"scopes" text NOT NULL,
	"connected_by" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients_cache" (
	"tenant_id" uuid NOT NULL,
	"ghl_contact_id" text NOT NULL,
	"phone" text,
	"first_name" text,
	"last_name" text,
	"email" text,
	"last_visit_at" timestamp with time zone,
	"summary" text,
	"pending_treatment" text,
	"voice_agent_priority" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_cache_tenant_id_ghl_contact_id_pk" PRIMARY KEY("tenant_id","ghl_contact_id")
);
--> statement-breakpoint
CREATE TABLE "phone_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"e164" text NOT NULL,
	"twilio_sid" text NOT NULL,
	"retell_phone_id" text,
	"agent_id" uuid,
	"active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_numbers_e164_unique" UNIQUE("e164")
);
--> statement-breakpoint
CREATE TABLE "tenant_memberships" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_memberships_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan" text DEFAULT 'starter' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"clerk_organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_clerk_organization_id_unique" UNIQUE("clerk_organization_id")
);
--> statement-breakpoint
CREATE TABLE "treatments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"duration_minutes" integer NOT NULL,
	"price_min" numeric,
	"price_max" numeric,
	"currency" text DEFAULT 'USD',
	"ghl_calendar_id" text,
	"assigned_dentists" jsonb DEFAULT '[]'::jsonb,
	"active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"source" text NOT NULL,
	"event" text,
	"signature_valid" boolean,
	"status_code" integer,
	"body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_prompt_versions" ADD CONSTRAINT "agent_prompt_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_prompt_versions" ADD CONSTRAINT "agent_prompt_versions_agent_config_id_agent_configs_id_fk" FOREIGN KEY ("agent_config_id") REFERENCES "public"."agent_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_prompt_versions" ADD CONSTRAINT "agent_prompt_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments_cache" ADD CONSTRAINT "appointments_cache_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments_cache" ADD CONSTRAINT "appointments_cache_treatment_id_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."treatments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD CONSTRAINT "clinic_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faqs" ADD CONSTRAINT "faqs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ghl_integrations" ADD CONSTRAINT "ghl_integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ghl_integrations" ADD CONSTRAINT "ghl_integrations_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients_cache" ADD CONSTRAINT "patients_cache_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_agent_id_agent_configs_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_prompt_versions_tenant_idx" ON "agent_prompt_versions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "agent_prompt_versions_agent_idx" ON "agent_prompt_versions" USING btree ("agent_config_id");--> statement-breakpoint
CREATE INDEX "appointments_cache_start_idx" ON "appointments_cache" USING btree ("tenant_id","start_time");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_idx" ON "audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "call_events_tenant_idx" ON "call_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "calls_tenant_started_idx" ON "calls" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE INDEX "calls_intent_idx" ON "calls" USING btree ("intent");--> statement-breakpoint
CREATE INDEX "faqs_tenant_idx" ON "faqs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "patients_cache_phone_idx" ON "patients_cache" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE INDEX "phone_numbers_tenant_idx" ON "phone_numbers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_memberships_user_idx" ON "tenant_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "treatments_tenant_idx" ON "treatments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "webhook_logs_source_idx" ON "webhook_logs" USING btree ("source","created_at");