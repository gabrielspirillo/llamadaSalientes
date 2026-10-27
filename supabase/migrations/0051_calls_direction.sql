-- Dirección de la llamada. Sin ella, una saliente mostraba el número de la
-- clínica como paciente, contaba en "Entrantes" y, si caía en el buzón,
-- publicaba una "llamada perdida" falsa en #Urgencias.
ALTER TABLE calls ADD COLUMN IF NOT EXISTS direction text;

-- Las ya guardadas: saliente si el origen es un número de la propia clínica.
UPDATE calls c
SET direction = CASE
  WHEN EXISTS (
    SELECT 1 FROM phone_numbers p WHERE p.tenant_id = c.tenant_id AND p.e164 = c.from_number
  ) OR EXISTS (
    SELECT 1 FROM tenant_telephony t
    WHERE t.tenant_id = c.tenant_id
      AND c.from_number IN (t.inbound_number_e164, t.caller_id_e164)
  ) THEN 'outbound'
  ELSE 'inbound'
END
WHERE c.direction IS NULL;
