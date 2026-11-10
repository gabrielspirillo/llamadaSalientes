-- 1. "Atendida" visible en las clínicas que ocultan estados (Respinens,
--    10/11/2026). Sin ese botón, la clínica pulsaba "Agendada" al terminar
--    cada sesión y la cita confirmada volvía a Agendada.
UPDATE tenant_care_profile
SET booking_policy = jsonb_set(
      booking_policy,
      '{visibleStatuses}',
      (booking_policy->'visibleStatuses') || '["COMPLETED"]'::jsonb
    ),
    updated_at = now()
WHERE jsonb_typeof(booking_policy->'visibleStatuses') = 'array'
  AND NOT (booking_policy->'visibleStatuses') ? 'COMPLETED';

-- 2. Novedades del panel: qué vio cada persona de cada aviso. El catálogo de
--    avisos vive en el código (lib/announcements/catalog.ts); aquí sólo el
--    estado por persona: ENTENDIDO (no vuelve a salir) o "recordar más tarde"
--    (vuelve a salir pasado snooze_until).
CREATE TABLE IF NOT EXISTS announcement_views (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  announcement_id text NOT NULL,
  status text NOT NULL,
  snooze_until timestamptz,
  times_shown integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, announcement_id)
);
