-- Rutinas que no se acumulan (14/11/2026).
--
-- Una rutina diaria que no se marcó se quedaba abierta para siempre y la del
-- día siguiente se sumaba encima: en Respinens había 35 «Cierre de clínica»
-- vencidos y el tablero era un scroll infinito. La apertura de ayer ya no se
-- puede hacer: cuando existe una ocurrencia más nueva de la misma rutina, las
-- anteriores sin hacer se ARCHIVAN (no se borran: siguen en la base como
-- registro de que no se hicieron). Desde ahora lo hace también
-- `materializeRoutinesForTenant` al crear cada ocurrencia nueva.
UPDATE tasks t
   SET archived_at = now(), updated_at = now()
 WHERE t.source = 'ROUTINE'
   AND t.template_id IS NOT NULL
   AND t.archived_at IS NULL
   AND t.status <> 'DONE'
   AND t.due_at IS NOT NULL
   -- Sólo días ya pasados: la de hoy sigue viva aunque ya exista la de mañana.
   AND t.due_at < (date_trunc('day', now() AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'Europe/Madrid')
   AND EXISTS (
     SELECT 1 FROM tasks n
      WHERE n.tenant_id = t.tenant_id
        AND n.template_id = t.template_id
        AND n.due_at > t.due_at
   );
