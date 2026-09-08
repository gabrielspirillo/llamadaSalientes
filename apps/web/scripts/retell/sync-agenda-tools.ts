/* eslint-disable no-console */
// Deja los agentes de voz de TODAS las clínicas al día con la agenda interna.
//
// Las tools de Retell no viven en este repo: se declaran en el LLM de cada
// agente, dentro de Retell. Por eso, aunque la app ya sepa responder
// `list_professionals`, un agente cuyo LLM no la tenga declarada no la va a
// llamar nunca. Este script recorre los `agent_configs` de todos los tenants y,
// para cada LLM:
//
//   · añade `list_professionals` si falta;
//   · añade `professional_name` a `check_availability`;
//   · añade `professional_id`, `patient_name` y `email` a `book_appointment`.
//
// Es idempotente: lo que ya está no se toca, y se puede volver a correr cada vez
// que se dé de alta una clínica.
//
// Uso:
//   tsx --import ./worker/preload.ts scripts/retell/sync-agenda-tools.ts          (aplica)
//   tsx --import ./worker/preload.ts scripts/retell/sync-agenda-tools.ts --check  (sólo comprueba)
//
// En --check devuelve código 1 si a algún LLM le falta algo, para poder usarlo
// como verificación desde fuera.

import { pathToFileURL } from 'node:url';

import { db } from '@/lib/db/client';
import { agentConfigs, tenants } from '@/lib/db/schema';
import { eq, isNotNull } from 'drizzle-orm';

const RETELL_API = 'https://api.retellai.com';
const TOOLS_URL = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.futuradigital.es'}/api/retell/tools`;

interface RetellTool {
  name: string;
  type: string;
  description?: string;
  url?: string;
  method?: 'POST' | 'GET';
  parameters?: {
    type: string;
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  speak_during_execution?: boolean;
  speak_after_execution?: boolean;
  timeout_ms?: number;
}

const LIST_PROFESSIONALS: RetellTool = {
  name: 'list_professionals',
  type: 'custom',
  description:
    'Los profesionales de la clínica: qué tratamientos hace cada uno, en qué días y horas atiende y si tiene alguna ausencia próxima. Úsala cuando el paciente pregunte por un profesional concreto ("¿está la doctora Ruiz?", "¿qué días atiende?"), cuando quiera elegir con quién se atiende, o cuando pregunte quién hace un tratamiento. No inventes nombres de profesionales: sólo los que devuelva esta tool.',
  url: TOOLS_URL,
  method: 'POST',
  parameters: { type: 'object', properties: {}, required: [] },
  speak_during_execution: true,
  speak_after_execution: false,
  timeout_ms: 120000,
};

/** Campos que la agenda interna añadió a tools que ya existían. */
const CAMPOS_NUEVOS: Record<string, Record<string, { type: string; description?: string }>> = {
  check_availability: {
    professional_name: {
      type: 'string',
      description:
        'Opcional. Nombre del profesional si el paciente pide uno concreto. Consúltalos con list_professionals.',
    },
  },
  book_appointment: {
    professional_id: {
      type: 'string',
      description:
        'Cópialo EXACTAMENTE del corchete [professional_id=...] del hueco que eligió el paciente en check_availability.',
    },
    patient_name: {
      type: 'string',
      description: 'Nombre y apellidos del paciente, para dejar la cita a su nombre.',
    },
    email: { type: 'string', description: 'Opcional. Email del paciente.' },
  },
};

interface Resultado {
  llmId: string;
  clinicas: string[];
  faltaba: string[];
}

/** El LLM que hay detrás de un agente. Retell los guarda por separado. */
async function llmDeAgente(apiKey: string, agentId: string): Promise<string | null> {
  const res = await fetch(`${RETELL_API}/get-agent/${agentId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    console.error(`[retell] get-agent ${agentId}: ${res.status}`);
    return null;
  }
  const agent = (await res.json()) as {
    response_engine?: { llm_id?: string; type?: string };
  };
  return agent.response_engine?.llm_id ?? null;
}

async function getLlm(apiKey: string, llmId: string): Promise<{ general_tools?: RetellTool[] }> {
  const res = await fetch(`${RETELL_API}/get-retell-llm/${llmId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`get-retell-llm ${llmId}: ${res.status} ${await res.text()}`);
  return (await res.json()) as { general_tools?: RetellTool[] };
}

/** Devuelve las tools ya corregidas y qué hizo falta cambiar. */
export function reconciliar(existentes: RetellTool[]): { tools: RetellTool[]; faltaba: string[] } {
  const faltaba: string[] = [];
  const tools = existentes.map((t) => ({ ...t }));

  if (!tools.some((t) => t.name === LIST_PROFESSIONALS.name)) {
    tools.push({ ...LIST_PROFESSIONALS });
    faltaba.push('list_professionals');
  }

  for (const [nombre, campos] of Object.entries(CAMPOS_NUEVOS)) {
    const tool = tools.find((t) => t.name === nombre);
    if (!tool) continue;
    // Una tool sin `parameters` es una tool que no acepta argumentos: no se le
    // inventa un esquema, se deja como está.
    if (!tool.parameters?.properties) continue;
    for (const [campo, def] of Object.entries(campos)) {
      if (!(campo in tool.parameters.properties)) {
        tool.parameters.properties[campo] = def;
        faltaba.push(`${nombre}.${campo}`);
      }
    }
  }

  return { tools, faltaba };
}

async function main() {
  const soloComprobar = process.argv.includes('--check');
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) {
    console.error('[retell] falta RETELL_API_KEY');
    process.exit(2);
  }

  const filas = await db
    .select({
      llmId: agentConfigs.retellLlmId,
      agentId: agentConfigs.retellAgentId,
      role: agentConfigs.role,
      clinica: tenants.name,
    })
    .from(agentConfigs)
    .innerJoin(tenants, eq(tenants.id, agentConfigs.tenantId));

  const porLlm = new Map<string, string[]>();
  const anota = (llmId: string, quien: string) => {
    const lista = porLlm.get(llmId) ?? [];
    lista.push(quien);
    porLlm.set(llmId, lista);
  };

  for (const f of filas) {
    const quien = `${f.clinica} (${f.role})`;
    if (f.llmId) {
      anota(f.llmId, quien);
      continue;
    }
    // La clínica puede tener sólo el agente: el LLM se resuelve en Retell.
    if (f.agentId) {
      const llmId = await llmDeAgente(apiKey, f.agentId);
      if (llmId) anota(llmId, quien);
    }
  }

  // Las clínicas que no tienen agente propio caen a los agentes por defecto de
  // env (ver `resolveRetellAgentId`). Son los que hoy atienden a todo el mundo,
  // así que también tienen que conocer la agenda.
  const porDefecto: [string, string | undefined][] = [
    ['agente por defecto (inbound)', process.env.RETELL_DEFAULT_AGENT_ID],
    ['agente por defecto (outbound)', process.env.RETELL_OUTBOUND_DEFAULT_AGENT_ID],
    ['agente de la demo', process.env.FUTURA_DEMO_RETELL_AGENT_ID],
  ];
  for (const [etiqueta, agentId] of porDefecto) {
    if (!agentId) continue;
    const llmId = await llmDeAgente(apiKey, agentId);
    if (llmId) anota(llmId, etiqueta);
  }

  if (porLlm.size === 0) {
    console.log('[retell] no hay ningún agente de voz configurado; nada que hacer');
    // En --check eso NO es un éxito: significa que no se pudo comprobar nada.
    process.exit(soloComprobar ? 3 : 0);
  }

  const resultados: Resultado[] = [];
  let fallos = 0;

  for (const [llmId, clinicas] of porLlm) {
    try {
      const llm = await getLlm(apiKey, llmId);
      const { tools, faltaba } = reconciliar(llm.general_tools ?? []);
      resultados.push({ llmId, clinicas, faltaba });

      if (faltaba.length === 0) {
        console.log(`[retell] ${llmId} ya estaba al día · ${clinicas.join(', ')}`);
        continue;
      }
      if (soloComprobar) {
        console.error(`[retell] ${llmId} le falta: ${faltaba.join(', ')} · ${clinicas.join(', ')}`);
        fallos += 1;
        continue;
      }

      const res = await fetch(`${RETELL_API}/update-retell-llm/${llmId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ general_tools: tools }),
      });
      if (!res.ok) throw new Error(`update-retell-llm: ${res.status} ${await res.text()}`);
      console.log(`[retell] ${llmId} actualizado: ${faltaba.join(', ')} · ${clinicas.join(', ')}`);
    } catch (err) {
      fallos += 1;
      console.error(`[retell] ${llmId} falló:`, (err as Error).message);
    }
  }

  console.log(
    `[retell] ${resultados.length} LLM revisados, ${resultados.filter((r) => r.faltaba.length > 0).length} con cambios, ${fallos} con problemas`,
  );
  process.exit(fallos > 0 ? 1 : 0);
}

// Sólo corre cuando se le invoca como script: el test importa `reconciliar`
// desde aquí y no debe disparar la sincronización de paso.
const invocadoDirectamente = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (invocadoDirectamente) {
  main().catch((err) => {
    console.error('[retell] fatal', err);
    process.exit(2);
  });
}
