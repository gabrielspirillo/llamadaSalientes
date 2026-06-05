/**
 * Runner del sandbox de evals del agente de WhatsApp.
 *
 * Corre el agente REAL (mismo loop + mismo LLM Gemini/OpenAI) contra el set
 * de casos dorados, con grounding fixture + tools mockeadas (NO toca BD, GHL
 * ni envía WhatsApp). Puntúa con el grader determinístico e imprime un
 * resumen. Sale con código 1 si algún caso falla (útil en pre-deploy / CI).
 *
 * Uso (desde apps/web):
 *   pnpm eval:agent                  # corre todos los casos
 *   pnpm eval:agent -- --case=urgencia-clinica   # un caso
 *   pnpm eval:agent -- --verbose     # imprime respuesta + tools de cada caso
 *
 * Requiere una key de LLM en el entorno: GEMINI_API_KEY o OPENAI_API_KEY.
 * El resto del env (DB/Clerk) se rellena con valores dummy porque el sandbox
 * no se conecta a nada de eso.
 */

import 'dotenv/config';

// El módulo @/lib/env valida vars requeridas al importar. El sandbox no usa
// BD ni Clerk (grounding y tools van mockeados), así que rellenamos dummies
// para que el import no crashee. Debe ir ANTES de importar el agente.
const DUMMY_ENV: Record<string, string> = {
  DATABASE_URL: 'postgres://eval:eval@localhost:5432/eval',
  DIRECT_URL: 'postgres://eval:eval@localhost:5432/eval',
  CLERK_SECRET_KEY: 'sk_test_eval',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_eval',
  CLERK_WEBHOOK_SIGNING_SECRET: 'whsec_eval',
  // 32 bytes en hex (no se usa: grounding y tools van mockeados, no hay
  // encrypt/decrypt), solo para pasar la validación de env al importar.
  ENCRYPTION_KEY: '0'.repeat(64),
};
for (const [k, v] of Object.entries(DUMMY_ENV)) {
  if (!process.env[k]) process.env[k] = v;
}

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const caseFilter = args.find((a) => a.startsWith('--case='))?.split('=')[1];

async function main(): Promise<void> {
  if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error(
      '\n✗ Falta key de LLM. Seteá GEMINI_API_KEY o OPENAI_API_KEY (en apps/web/.env o en el entorno) y reintentá.\n',
    );
    process.exit(1);
  }

  // Import dinámico DESPUÉS de fijar el env dummy.
  const { runWhatsappAgent } = await import('../index');
  const { EVAL_CASES } = await import('./cases');
  const { gradeCase } = await import('./grader');
  const { fixtureLoadGrounding, fixtureExecuteTool, FIXTURE_NOW, FIXTURE_TENANT_ID } = await import(
    './fixtures'
  );

  const cases = caseFilter ? EVAL_CASES.filter((c) => c.id === caseFilter) : EVAL_CASES;
  if (cases.length === 0) {
    console.error(`✗ No hay casos que matcheen --case=${caseFilter}`);
    process.exit(1);
  }

  console.log(`\n🧪 Eval agente WhatsApp — ${cases.length} caso(s)\n`);
  const results = [];
  for (const c of cases) {
    const output = await runWhatsappAgent(
      {
        tenantId: FIXTURE_TENANT_ID,
        conversationId: `eval-${c.id}`,
        contactId: 'eval-contact',
        contactPhoneE164: c.contactPhoneE164 ?? '+34699111222',
        userText: c.userText,
        history: c.history ?? [],
        triggerMessageId: `eval-trigger-${c.id}`,
        remindersResume: c.remindersResume ?? null,
      },
      {
        loadGrounding: fixtureLoadGrounding,
        executeTool: fixtureExecuteTool,
        now: FIXTURE_NOW,
      },
    );
    const result = gradeCase(c, output);
    results.push(result);

    const mark = result.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`${mark}  ${result.id} — ${result.description}`);
    for (const ck of result.checks) {
      if (!ck.ok || verbose) {
        console.log(`        ${ck.ok ? '·' : '✗'} ${ck.name}: ${ck.detail}`);
      }
    }
    if (verbose) {
      console.log(`        intent=${output.intent} model=${output.model} tools=[${output.toolsCalled.map((t) => t.name).join(', ') || '—'}]`);
      console.log(`        respuesta: ${JSON.stringify(output.responseText)}`);
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log(`\n${passed === total ? '✅' : '❌'} ${passed}/${total} casos OK\n`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error('Eval runner crasheó:', err);
  process.exit(1);
});
