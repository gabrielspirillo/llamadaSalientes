-- ─────────────────────────────────────────────────────────────────────────────
-- WhatsApp contact details: agregar campos para una página de detalle
-- estilo "CRM" del contacto (avatar, name partes, email, dirección, redes).
--
-- Estrategia:
--   - El campo `name` sigue existiendo (compat back, se mantiene como
--     display name). Cuando se editan first_name/last_name desde el form,
--     `name` se sincroniza como "first last".
--   - social_links es jsonb para no proliferar columnas por cada red.
--     Forma: { linkedin?: string, facebook?: string, instagram?: string,
--              twitter?: string, github?: string }
--   - avatar_url es la URL pública (de Evolution `/chat/fetchProfilePictureUrl`
--     o, en el futuro, un fallback de GHL). En Cloud/Twilio queda null —
--     la UI muestra iniciales.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE whatsapp_contacts
  ADD COLUMN IF NOT EXISTS avatar_url   text,
  ADD COLUMN IF NOT EXISTS first_name   text,
  ADD COLUMN IF NOT EXISTS last_name    text,
  ADD COLUMN IF NOT EXISTS email        text,
  ADD COLUMN IF NOT EXISTS city         text,
  ADD COLUMN IF NOT EXISTS country      text,
  ADD COLUMN IF NOT EXISTS address      text,
  ADD COLUMN IF NOT EXISTS company      text,
  ADD COLUMN IF NOT EXISTS social_links jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Backfill: si `name` ya tiene algo, partirlo en first/last best-effort
-- (split por primer whitespace). Solo aplica donde first_name está null.
UPDATE whatsapp_contacts
SET
  first_name = split_part(name, ' ', 1),
  last_name  = NULLIF(substring(name FROM position(' ' IN name) + 1), '')
WHERE name IS NOT NULL
  AND first_name IS NULL;
