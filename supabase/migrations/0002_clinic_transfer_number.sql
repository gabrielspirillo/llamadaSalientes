-- Número compartido al que los agentes (inbound + outbound) transfieren la
-- llamada cuando el paciente pide hablar con un humano o el caso escala.
-- Se edita desde /dashboard/settings y se inyecta como dynamic var
-- {{clinic_transfer_number}} en cada llamada de Retell.

ALTER TABLE "clinic_settings"
  ADD COLUMN IF NOT EXISTS "transfer_number" text;
