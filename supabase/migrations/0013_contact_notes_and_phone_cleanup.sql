-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Cleanup retroactivo del bug del sufijo ":NN" en phone_e164.
--
-- Contexto: el webhook Evolution dejaba el sufijo ":17" (lid Multi-Device)
-- pegado en phone_e164 cuando JID venía como "5499:17@s.whatsapp.net".
-- El fix del normalizador ya está en main (commit 5a02efa). Esta migration
-- limpia los datos viejos:
--
--   a) Si existe un contacto "bueno" (sin ":") con el mismo número, mergeamos:
--      re-apuntamos sus conversations al bueno y borramos el sufijado.
--   b) Si no hay gemelo limpio, le strippeamos el sufijo in-place y reseteamos
--      ghl_contact_id para que el próximo inbound dispare sync GHL.
-- ─────────────────────────────────────────────────────────────────────────────

-- Paso 1.a: re-apuntar conversaciones de contactos sufijados → gemelo limpio.
WITH duplicates AS (
  SELECT bad.id AS bad_id, good.id AS good_id
  FROM whatsapp_contacts bad
  JOIN whatsapp_contacts good
    ON good.tenant_id = bad.tenant_id
   AND good.phone_e164 = split_part(bad.phone_e164, ':', 1)
  WHERE bad.phone_e164 LIKE '%:%'
)
UPDATE whatsapp_conversations c
SET contact_id = d.good_id, updated_at = NOW()
FROM duplicates d
WHERE c.contact_id = d.bad_id;

-- Paso 1.b: ahora que no hay refs, borrar contactos sufijados con gemelo limpio.
DELETE FROM whatsapp_contacts bad
WHERE bad.phone_e164 LIKE '%:%'
  AND EXISTS (
    SELECT 1 FROM whatsapp_contacts good
    WHERE good.tenant_id = bad.tenant_id
      AND good.phone_e164 = split_part(bad.phone_e164, ':', 1)
  );

-- Paso 1.c: strippear los sufijados sin gemelo + resetear ghl_contact_id
-- para que el próximo mensaje re-corra el sync GHL con el phone correcto.
UPDATE whatsapp_contacts
SET
  phone_e164 = split_part(phone_e164, ':', 1),
  ghl_contact_id = NULL,
  updated_at = NOW()
WHERE phone_e164 LIKE '%:%';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Tabla whatsapp_contact_notes.
--
-- Notas asociadas al contacto (no a una conversación específica). Las
-- "notas internas" pre-existentes (whatsapp_messages.internal_note=true)
-- siguen viviendo en su lugar — se usan para anotar dentro del thread.
-- Esta tabla nueva guarda notas a nivel de contacto/paciente, accesibles
-- desde el tab "Notas" de la página de detalle.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS whatsapp_contact_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id      uuid NOT NULL REFERENCES whatsapp_contacts(id) ON DELETE CASCADE,
  body            text NOT NULL,
  author_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS whatsapp_contact_notes_tenant_contact_idx
  ON whatsapp_contact_notes(tenant_id, contact_id, created_at DESC);
