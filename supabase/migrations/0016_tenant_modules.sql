-- Módulos activables por tenant. Fase 1: bloqueo solo visual en UI.
-- Las APIs/webhooks/crons NO consultan este flag todavía.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS enabled_modules jsonb NOT NULL DEFAULT '{
    "whatsapp": false,
    "outbound": false,
    "inbound": false
  }'::jsonb;

-- Futura Solutions es el tenant demo: arranca con los 3 módulos activos
-- para poder mostrar el producto completo a prospects.
UPDATE tenants
SET enabled_modules = '{"whatsapp": true, "outbound": true, "inbound": true}'::jsonb
WHERE id = 'f6c01830-6a8b-44e3-8cfb-38bee10a2b10';
