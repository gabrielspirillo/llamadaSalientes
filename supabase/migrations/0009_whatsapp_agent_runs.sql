-- ─────────────────────────────────────────────────────────────────────────────
-- WhatsApp agent runs: audit trail de cada invocación del agente conversacional
-- de WhatsApp (LLM call + tools ejecutadas + respuesta enviada).
--
-- Un "run" se crea por cada ventana del debouncer (5s) que dispara el agente.
-- Sirve para:
--   - Observabilidad (qué intent, qué modelo, latencia, tokens, fallback)
--   - Debugging (qué tools llamó el LLM y con qué args/result)
--   - Analytics (% handoff, % URGENT, costo por tenant)
--   - Idempotencia (un run por trigger_message_id evita doble respuesta)
--
-- Multi-tenant: tenant_id en cada fila. RLS se activará en Fase 7 junto con el
-- resto del módulo WhatsApp.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "agent_intent" AS ENUM (
  'SCHEDULING',
  'FAQ',
  'URGENT',
  'HANDOFF',
  'OTHER'
);

CREATE TABLE "whatsapp_agent_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "conversation_id" uuid NOT NULL REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE,
  -- Último mensaje inbound de la ráfaga que disparó este run. Idempotencia:
  -- unique(conversation_id, trigger_message_id) evita doble proceso si Inngest
  -- reintenta el job o si el webhook se duplica.
  "trigger_message_id" uuid REFERENCES "whatsapp_messages"("id") ON DELETE SET NULL,
  -- Mensaje outbound que generó el agente (NULL si solo hubo handoff/silencio).
  "response_message_id" uuid REFERENCES "whatsapp_messages"("id") ON DELETE SET NULL,
  -- Identificador lógico del agente. Por ahora 'main' (single agent + tools).
  -- En el futuro: 'classifier', 'scheduling', etc. — sin migrar enum.
  "agent" text NOT NULL DEFAULT 'main',
  -- Modelo LLM efectivamente usado (ej: gemini-2.5-flash, gpt-4o). Si hay
  -- fallback queda el modelo final (no el primario).
  "model" text NOT NULL,
  "intent" "agent_intent",
  -- Numérico (3,2): valores 0.00..1.00. Si <0.7 forzamos handoff.
  "intent_confidence" numeric(3, 2),
  "intent_reasoning" text,
  -- Flags de comportamiento del run.
  "handoff" boolean NOT NULL DEFAULT false,
  "urgent" boolean NOT NULL DEFAULT false,
  -- Tokens y latencia. Para costo / SLA.
  "tokens_in" integer NOT NULL DEFAULT 0,
  "tokens_out" integer NOT NULL DEFAULT 0,
  "latency_ms" integer NOT NULL DEFAULT 0,
  -- true si el provider primario (Gemini) falló y se usó OpenAI como fallback.
  "fallback_used" boolean NOT NULL DEFAULT false,
  -- Array de tool-calls del LLM. Cada item:
  -- { name: string, args: object, ok: boolean, result: string, latencyMs: number, error?: string }
  "tools_called" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "error_text" text,
  -- Reservado para integrar tracing externo (Langfuse, Axiom traces, etc).
  "trace_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "whatsapp_agent_runs_conv_trigger_unique"
    UNIQUE ("conversation_id", "trigger_message_id")
);

CREATE INDEX "whatsapp_agent_runs_tenant_conv_created_idx"
  ON "whatsapp_agent_runs" ("tenant_id", "conversation_id", "created_at");
CREATE INDEX "whatsapp_agent_runs_tenant_intent_idx"
  ON "whatsapp_agent_runs" ("tenant_id", "intent");
CREATE INDEX "whatsapp_agent_runs_trigger_message_idx"
  ON "whatsapp_agent_runs" ("trigger_message_id");
