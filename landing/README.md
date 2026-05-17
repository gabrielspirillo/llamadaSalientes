# Landing FUTURA + agente de llamadas demo

Esta carpeta contiene la landing estática (Hostinger) y la documentación para conectarla al agente de llamadas outbound de FUTURA hosteado en Vercel.

## Qué se montó

1. **`landing/index.html`** — landing limpia (UTF-8, sin caracteres rotos) con un formulario funcional "Recibir llamada" que:
   - Acepta nombre opcional + teléfono.
   - Normaliza el teléfono a E.164 (acepta `+34611...`, `0034611...`, o `611...` de móvil ES).
   - POSTea a `https://llamada-salientes-web.vercel.app/api/public/demo-call`.
   - Muestra estado de carga, éxito y error con feedback visual.

2. **`apps/web/app/api/public/demo-call/route.ts`** — endpoint público (CORS) que:
   - Acepta `{ phone, name? }`.
   - Rate-limita 1 llamada / 3 min al mismo número (vía tabla `calls`).
   - Dispara `triggerCallback()` contra el tenant `FUTURA_DEMO_TENANT_ID`.
   - Pasa `lead_name` como dynamic var al agente Sofía.

3. **`apps/web/middleware.ts`** — agregado `/api/public/(.*)` a la lista pública (sin Clerk).

4. **Agente Retell** — ya creado vía API:
   - `agent_id = agent_b7c4de5748c40e118d193db2f6` (FUTURA — Demo Outbound (Sofía))
   - `llm_id  = llm_b7548a5a95b73561e5c65e550264`
   - Voz: `custom_voice_f823c5f8e830f233c09930e612` (la misma del agente dental existente).
   - Tools: `register_patient`, `check_availability`, `book_appointment`, `end_call`.
   - Prompt: pitch corto sobre Futura → tras 2 preguntas del usuario invita a agendar demo → agenda en GHL via `book_appointment` con `treatment_name="Demo Futura"`.

5. **`apps/web/scripts/setup-futura-demo-agent.ts`** — script idempotente que asocia ese agente al tenant demo:
   ```bash
   pnpm tsx apps/web/scripts/setup-futura-demo-agent.ts <FUTURA_DEMO_TENANT_ID>
   ```

---

## Tenant demo elegido: Clínica Sonrisas

| Campo | Valor |
|---|---|
| Tenant ID | `523e195b-a417-45c1-b76c-ebe0f5d829f9` |
| Clerk org | `org_3DPj5m8J9lGStm3zXUpQzKBWdFd` |
| Número outbound | `+19706844968` (activo) |
| GHL location | `q7VOAZDKoyJGYy6dva78` (conectado) |
| Calendario demo | `cD23AIKuRsV2uLNrYkev` (mismo que el widget público de la landing) |
| Agent outbound (Sofía) | `agent_b7c4de5748c40e118d193db2f6` (asociado al tenant en `agent_configs`) |

## Checklist de puesta en marcha

### 1. Setear env vars en Vercel (ÚNICO paso que te queda)
En el dashboard de Vercel → Project Settings → Environment Variables, agregá:
```
FUTURA_DEMO_TENANT_ID=523e195b-a417-45c1-b76c-ebe0f5d829f9
FUTURA_DEMO_ALLOWED_ORIGINS=https://cliniq.futuradigital.es,https://www.cliniq.futuradigital.es
```
Redeploy para que tomen efecto.

### 2. Subir el HTML a Hostinger
- Subir `landing/index.html` reemplazando el actual.
- Si el dominio de la app no es `https://llamada-salientes-web.vercel.app`, editá la constante `FUTURA_API_BASE` al principio del `<script>` del HTML.

### Lo que ya está hecho (no toques)
- ✅ Tenant Clínica Sonrisas tiene `phone_numbers` activo y `ghl_integrations` conectado.
- ✅ Insertado `agent_configs(role='outbound')` apuntando al agente Sofía (`agent_b7c4de5748c40e118d193db2f6`).
- ✅ Insertado `treatments` "Demo Futura" con `ghl_calendar_id='cD23AIKuRsV2uLNrYkev'` y duración 30 min — el agente lo resuelve por fuzzy match cuando llama a `book_appointment(treatment_name="Demo Futura")`.
- ✅ Agente Retell Sofía creado con prompt "info → invitar a demo tras 2 preguntas → agendar en GHL".

> **Aviso sobre el calendario:** asumí que `cD23AIKuRsV2uLNrYkev` (el ID del widget público de la landing) es también el `calendarId` interno en GHL. Si la primera prueba falla al agendar, verificá el ID exacto en GHL → Calendars y actualizá `treatments.ghl_calendar_id` para "Demo Futura".

---

## Probar el flujo end-to-end

1. Abrir la landing (Hostinger).
2. Bajar hasta "Pruébalo en vivo".
3. Tipear nombre + número propio.
4. Click "Recibir llamada".
5. En menos de 10s debería sonar tu teléfono con Sofía.
6. Probá: dejá que pregunte → hacé 2 preguntas → debería transicionar a "agendamos 30 min".
7. Confirmá agenda → debería crearse el contacto en GHL y la cita en el calendario "Demo Futura".

### Diagnóstico si falla

| Síntoma | Probable causa | Dónde mirar |
|---|---|---|
| `503 Demo no disponible` | Falta `FUTURA_DEMO_TENANT_ID` | Vercel env vars |
| `503 no_agent` | El tenant no tiene `agent_configs(role='outbound')` | Correr el setup script |
| `503 no_phone` | Sin `phone_numbers` activo | Insertar fila en DB |
| `429 rate_limited` | Mismo número llamado < 3 min antes | Esperar o usar otro número |
| `502 telephony_provider_permission_denied` | Twilio bloquea el país | Twilio Console → Voice → Geo Permissions |
| Llamada conecta pero agente no agenda | GHL no conectado o calendario no llamado "Demo Futura" | `/dashboard → Integraciones → GHL`, crear calendar |
| Browser bloquea por CORS | Origin no está en `FUTURA_DEMO_ALLOWED_ORIGINS` | Agregar el dominio en Vercel env y redeploy |

---

## Costos a vigilar

Cada llamada disparada cuesta dinero (Retell + Twilio). El rate-limit de 3 min/número evita doble-click accidental, pero **no protege de spam masivo desde múltiples teléfonos**. Si la landing recibe mucho tráfico, considerá:

- Agregar hCaptcha/Turnstile en el form antes de habilitar `Recibir llamada`.
- Reducir el límite de duración del agente (`max_call_duration_ms` ya está en 10 min — bajar a 5 min si querés más cap).
- Agregar rate-limit por IP en el endpoint (hoy es por número).
