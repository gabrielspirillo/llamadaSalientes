# Evals + sandbox del agente de WhatsApp

Corre el agente **real** (mismo loop + mismo LLM Gemini/OpenAI) contra un set de
casos dorados, con **grounding fixture + tools mockeadas**. NO toca BD, GHL ni
envía WhatsApp. Sirve para validar el prompt/agente **antes de deployar**.

## Cómo correr

Desde `apps/web` (necesita una key de LLM en el entorno: `GEMINI_API_KEY` o
`OPENAI_API_KEY` — el resto del env se rellena con dummies porque el sandbox no
se conecta a nada):

```bash
pnpm eval:agent                       # todos los casos
pnpm eval:agent -- --case=urgencia-clinica   # un caso
pnpm eval:agent -- --verbose          # imprime respuesta + tools de cada caso
```

Sale con código `1` si algún caso falla (apto para pre-deploy / CI).

## Archivos

- `fixtures.ts` — clínica/tratamientos/FAQs ficticios + ejecutor de tools mockeado + `now` fijo.
- `cases.ts` — casos dorados (`EvalCase[]`) con expectativas determinísticas.
- `grader.ts` — chequea intent, handoff/urgent, tools llamadas y regex de la respuesta.
- `run.ts` — runner CLI.

## Agregar un caso

Añadir un objeto a `EVAL_CASES` en `cases.ts`. Declarar solo las expectativas
que importan (todas opcionales): `expectIntent`, `expectHandoff`, `expectUrgent`,
`expectToolsAny`, `expectToolsNone`, `responseMustMatch`, `responseMustNotMatch`.

Si una tool nueva necesita un resultado mockeado, agregarlo en `fixtureExecuteTool`.

## Notas

- El grader es determinístico (sin LLM-as-judge todavía). Apunta a señales de
  alta confianza, no al wording exacto (el LLM varía).
- Las expectativas reflejan el comportamiento **razonable** del agente, no el
  ideal: si un caso falla, puede ser un bug del agente **o** una expectativa mal
  puesta — revisar ambos.
