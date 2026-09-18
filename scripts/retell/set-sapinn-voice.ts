/**
 * Ajusta el agente de voz que atiende la landing de Sapinn (/sapinn) para que
 * hable SIEMPRE en español de España y salude por el nombre cuando lo tenga.
 *
 * Por qué existe: el "vos" y el saludo raro no vienen de la landing (que solo
 * pasa variables) sino del PROMPT del agente, que vive dentro de Retell. Este
 * script parchea ese prompt de forma idempotente.
 *
 * Uso (necesita RETELL_API_KEY en el entorno; se corre desde el contenedor de
 * cliniq-web o cliniq-worker, que ya la tienen):
 *
 *   tsx scripts/retell/set-sapinn-voice.ts --check          # solo muestra el prompt actual
 *   tsx scripts/retell/set-sapinn-voice.ts                  # aplica sobre FUTURA_DEMO_RETELL_AGENT_ID
 *   tsx scripts/retell/set-sapinn-voice.ts --agent <id>     # aplica sobre un agente concreto
 *
 * ⚠️ Por defecto toca el agente de demo (FUTURA_DEMO_RETELL_AGENT_ID), que es
 * COMPARTIDO. Como todo el producto es ahora España, "español de España" suele
 * ser correcto para todos, pero si querés aislar la demo de Sapinn, creá/cloná
 * un agente propio en Retell y pasáselo con --agent.
 */
import Retell from 'retell-sdk';

const START = '=== ESPAÑOL DE ESPAÑA · sapinn (gestionado por script, no editar a mano) ===';
const END = '=== FIN ESPAÑOL DE ESPAÑA · sapinn ===';

const DIRECTIVE = [
  START,
  'Habla SIEMPRE en español de España peninsular. Usa "tú" y "vosotros".',
  'Nunca uses "vos", "che", "acá", "allá", "recién" (por "hace un momento") ni ningún',
  'voseo o modismo rioplatense. Vocabulario y giros de España ("vale", "de acuerdo",',
  '"os parece", "vuestro", "¿me oyes?").',
  '',
  'Al empezar, saluda y preséntate como un asistente de voz de IA en la primera frase.',
  'Si {{patient_name}} trae un nombre, salúdalo por su nombre (p. ej. "Hola Adrián, …");',
  'si viene vacío, saluda sin nombre y no digas la palabra "name" ni ningún hueco.',
  'Sé breve y natural, y acepta que te interrumpan a media frase.',
  END,
].join('\n');

function stripOldBlock(prompt: string): string {
  const s = prompt.indexOf(START);
  if (s === -1) return prompt.trim();
  const e = prompt.indexOf(END);
  if (e === -1) return prompt.trim();
  return (prompt.slice(0, s) + prompt.slice(e + END.length)).trim();
}

async function main() {
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) throw new Error('Falta RETELL_API_KEY en el entorno.');

  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const agentArgIdx = args.indexOf('--agent');
  // Por defecto, el agente DEDICADO de la demo de Sapinn (aislado de Futura).
  const SAPINN_DEMO_AGENT_ID = 'agent_e8d27609a342f597ba3e5ef329';
  const agentId =
    agentArgIdx !== -1
      ? args[agentArgIdx + 1]
      : (process.env.SAPINN_RETELL_AGENT_ID ?? SAPINN_DEMO_AGENT_ID);
  if (!agentId) {
    throw new Error('No hay agente: pasá --agent <id> o seteá SAPINN_RETELL_AGENT_ID.');
  }

  const client = new Retell({ apiKey });

  // Las formas del SDK varían por versión; tipamos lo justo que usamos.
  const agent = (await client.agent.retrieve(agentId)) as unknown as {
    response_engine?: { type?: string; llm_id?: string };
  };
  const engine = agent.response_engine ?? {};
  const llmId = engine.llm_id;
  if (!llmId) {
    throw new Error(
      `El agente ${agentId} no usa un Retell LLM (response_engine.type = ${engine.type ?? '?'}). Este script solo ajusta agentes con Retell LLM.`,
    );
  }

  const llm = (await client.llm.retrieve(llmId)) as unknown as {
    general_prompt?: string;
    begin_message?: string;
  };
  const current: string = llm.general_prompt ?? '';

  if (check) {
    console.log(`Agente:      ${agentId}`);
    console.log(`LLM:         ${llmId}`);
    console.log(`begin_message: ${JSON.stringify(llm.begin_message ?? '')}`);
    console.log('--- general_prompt (primeros 1200 chars) ---');
    console.log(current.slice(0, 1200));
    console.log(
      current.includes(START)
        ? '\n[✓] Ya tiene el bloque de español de España.'
        : '\n[ ] Sin el bloque todavía.',
    );
    return;
  }

  const base = stripOldBlock(current);
  const next = `${DIRECTIVE}\n\n${base}`.trim();

  await client.llm.update(llmId, {
    general_prompt: next,
    // Dejamos que el LLM genere el saludo según el prompt (así respeta el
    // nombre y el idioma); un begin_message fijo se saltaría esas reglas.
    begin_message: '',
  });

  console.log(`[✓] Agente ${agentId} (LLM ${llmId}) actualizado a español de España.`);
  console.log('    Volvé a probar la llamada en /sapinn.');
}

main().catch((err) => {
  console.error('[set-sapinn-voice] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
