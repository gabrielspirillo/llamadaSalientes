-- Consentimiento informado con firma digital, por WhatsApp.
--
-- Una clínica con firma digital (hoy sólo Respinens) manda desde la ficha del
-- paciente el consentimiento al móvil del tutor, que lo lee y lo firma desde
-- el teléfono. La firma la pone una instancia de Documenso propia de la
-- clínica; la app genera el PDF con los datos ya rellenos, lo crea allí por
-- API y manda el enlace por el WhatsApp de la clínica.
--
-- Tres tablas y ninguna cambia nada para quien no las use:
--   1. `esign_integrations`: la instancia de Documenso de la clínica (URL,
--      token de API y secreto del webhook, cifrados). Sin fila, la ficha no
--      enseña el botón.
--   2. `consent_templates`: el texto del consentimiento, en bloques. Es de la
--      clínica: lo redactó ella y lo cambia ella, no vive en el código.
--   3. `patient_consents`: cada envío, con su estado, el enlace de firma y el
--      PDF firmado cuando Documenso avisa.

CREATE TABLE IF NOT EXISTS esign_integrations (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'DOCUMENSO',
  -- https://consentimiento.respinens.es, sin barra final.
  base_url text NOT NULL,
  -- Cifrados con ENCRYPTION_KEY (lib/crypto.ts), como las credenciales de GHL.
  api_token_enc text NOT NULL,
  webhook_secret_enc text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (provider IN ('DOCUMENSO'))
);

CREATE TABLE IF NOT EXISTS consent_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Una clínica puede tener varios (menores, adultos…). Hoy: CONSENTIMIENTO_MENOR.
  key text NOT NULL,
  title text NOT NULL,
  -- [{ type: 'heading' | 'paragraph' | 'bullets' | 'numbered', ... }]. La
  -- forma la fija `lib/consents/template.ts`.
  body jsonb NOT NULL,
  -- Lo que el tutor declara al firmar. Se imprime antes de la firma.
  acknowledgments jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Texto del WhatsApp: {{tutor}}, {{paciente}}, {{clinica}}, {{enlace}}.
  message_template text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS patient_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  template_id uuid REFERENCES consent_templates(id) ON DELETE SET NULL,
  template_key text NOT NULL,
  provider text NOT NULL DEFAULT 'DOCUMENSO',
  -- Id del documento en la instancia de Documenso de la clínica.
  provider_document_id integer,
  -- Quién firma: el tutor. Lo que se imprimió en el PDF.
  recipient_name text NOT NULL,
  recipient_email text,
  recipient_phone text NOT NULL,
  recipient_dni text,
  recipient_address text,
  signing_url text,
  status text NOT NULL DEFAULT 'SENT',
  sent_at timestamptz,
  signed_at timestamptz,
  -- Key del PDF firmado en el bucket interno (S3_BUCKET_INTERNAL).
  pdf_key text,
  whatsapp_message_id text,
  sent_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('SENT', 'SIGNED', 'CANCELLED', 'ERROR'))
);

CREATE INDEX IF NOT EXISTS patient_consents_patient_idx
  ON patient_consents (tenant_id, patient_id, created_at DESC);
-- El webhook llega con el id del documento de Documenso: por aquí se encuentra.
CREATE UNIQUE INDEX IF NOT EXISTS patient_consents_provider_doc_uniq
  ON patient_consents (tenant_id, provider_document_id)
  WHERE provider_document_id IS NOT NULL;
