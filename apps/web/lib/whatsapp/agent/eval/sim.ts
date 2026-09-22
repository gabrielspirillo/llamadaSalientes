/**
 * Simulador conversacional del agente de WhatsApp.
 *
 * Pone a "pacientes" (un LLM por persona, ver personas.ts) a CONVERSAR turno a
 * turno con el agente REAL (mismo loop + mismo LLM + mismo prompt), con
 * grounding fixture y tools mockeadas — NO toca BD, GHL ni envía WhatsApp. Al
 * final, un LLM JUEZ lee cada transcripción y marca incoherencias, errores y
 * bajones de calidad. Sirve para cazar bugs que un caso de una sola respuesta no
 * ve: ambigüedad, cambios de idea, atribución de tratamientos, rubro, tono.
 *
 * Limitación: como las tools van mockeadas (fixtures), el simulador prueba el
 * comportamiento del PROMPT/LLM, no el motor de agenda real (disponibilidad,
 * fechas). Para eso están los tests de agenda y una corrida contra BD real.
 *
 * Uso (desde apps/web, con GEMINI_API_KEY u OPENAI_API_KEY en el entorno):
 *   pnpm eval:sim                     # todas las personas
 *   pnpm eval:sim -- --persona=semana-que-viene
 *   pnpm eval:sim -- --turns=8        # máximo de turnos por conversación
 *   pnpm eval:sim -- --mode=derive    # el asistente que NO agenda (modo DERIVE)
 *
 * En `--mode=derive` cambian tres cosas: el centro del fixture (no lleva su
 * agenda), las personas (diez pacientes de un centro de movimiento) y lo que
 * audita el juez — además de la conversación, el PARTE que se le manda al
 * profesional, que es la mitad del producto: si el resumen no sirve, la
 * conversación perfecta no vale de nada.
 */

import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DUMMY_ENV: Record<string, string> = {
  DATABASE_URL: 'postgres://eval:eval@localhost:5432/eval',
  DIRECT_URL: 'postgres://eval:eval@localhost:5432/eval',
  CLERK_SECRET_KEY: 'sk_test_eval',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_eval',
  CLERK_WEBHOOK_SIGNING_SECRET: 'whsec_eval',
  ENCRYPTION_KEY: '0'.repeat(64),
};
for (const [k, v] of Object.entries(DUMMY_ENV)) {
  if (!process.env[k]) process.env[k] = v;
}

const args = process.argv.slice(2);
const personaFilter = args.find((a) => a.startsWith('--persona='))?.split('=')[1];
const maxTurnsArg = Number(args.find((a) => a.startsWith('--turns='))?.split('=')[1]);
const modeArg = args
  .find((a) => a.startsWith('--mode='))
  ?.split('=')[1]
  ?.toLowerCase();
const DERIVE = modeArg === 'derive';

type Turn = { speaker: 'patient' | 'agent'; text: string };

interface Finding {
  severity: 'alta' | 'media' | 'baja';
  issue: string;
  evidence: string;
}

async function main(): Promise<void> {
  if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error('\n✗ Falta key de LLM. Seteá GEMINI_API_KEY o OPENAI_API_KEY y reintentá.\n');
    process.exit(1);
  }

  const { runWhatsappAgent } = await import('../index');
  const { callLLM } = await import('../llm');
  const booking = await import('./fixtures');
  const derive = await import('./fixtures-derive');
  const { SIM_PERSONAS } = await import('./personas');
  const { DERIVE_PERSONAS, DERIVE_RED_FLAGS_COMUNES } = await import('./personas-derive');

  const loadGrounding = DERIVE ? derive.deriveLoadGrounding : booking.fixtureLoadGrounding;
  const executeTool = DERIVE ? derive.deriveExecuteTool : booking.fixtureExecuteTool;
  const now = DERIVE ? derive.DERIVE_NOW : booking.FIXTURE_NOW;
  const tenantId = DERIVE ? derive.DERIVE_TENANT_ID : booking.FIXTURE_TENANT_ID;
  // Los ajustes del tenant son lo que enciende el modo, igual que en producción.
  const loadAgentSettings = DERIVE
    ? async () => ({
        persona: null,
        agentName: null,
        mode: 'DERIVE' as const,
        deriveFallbackPhone: derive.DERIVE_TEST_PHONE,
      })
    : async () => null;

  const todas = DERIVE ? DERIVE_PERSONAS : SIM_PERSONAS;
  const personas = personaFilter ? todas.filter((p) => p.id === personaFilter) : todas;
  if (personas.length === 0) {
    console.error(`✗ No hay personas que matcheen --persona=${personaFilter}`);
    process.exit(1);
  }

  // Un resumen corto del grounding, para dárselo al juez como "verdad".
  const grounding = await loadGrounding();
  const groundingSummary = DERIVE
    ? derive.deriveGroundingSummary()
    : [
        `Clínica: ${grounding.clinic.name}`,
        `Tratamientos: ${grounding.treatments.map((t) => t.name).join(', ')}`,
        `Profesionales/agenda: ${grounding.professionals || '(sin agenda interna)'}`,
      ].join('\n');

  const maxTurnsDefault = Number.isFinite(maxTurnsArg) && maxTurnsArg > 0 ? maxTurnsArg : 6;
  const report: Record<
    string,
    { transcript: Turn[]; findings: Finding[]; derivaciones?: unknown[] }
  > = {};
  let totalHigh = 0;
  let sinDerivar = 0;

  for (const persona of personas) {
    console.log(`\n💬 Persona: ${persona.id}`);
    const transcript: Turn[] = [];
    const maxTurns = persona.maxTurns ?? maxTurnsDefault;
    // Cada conversación arranca con el registro de derivaciones limpio.
    if (DERIVE) derive.derivacionesCapturadas.length = 0;

    let patientMsg = persona.opening;
    for (let turn = 0; turn < maxTurns; turn++) {
      transcript.push({ speaker: 'patient', text: patientMsg });
      console.log(`   🧑 ${patientMsg}`);

      const agentOutput = await runWhatsappAgent(
        {
          tenantId,
          conversationId: `sim-${persona.id}`,
          contactId: 'sim-contact',
          contactPhoneE164: DERIVE ? '+34612345678' : '+34699111222',
          userText: patientMsg,
          history: transcript.slice(0, -1).map((t) => ({
            role: t.speaker === 'patient' ? ('user' as const) : ('assistant' as const),
            content: t.text,
          })),
          triggerMessageId: `sim-${persona.id}-${turn}`,
          remindersResume: null,
        },
        {
          loadGrounding,
          executeTool,
          now,
          loadLeadMemory: async () => null,
          loadAgentSettings,
        },
      );
      const agentMsg = agentOutput.responseText?.trim() || '(sin respuesta)';
      transcript.push({ speaker: 'agent', text: agentMsg });
      console.log(`   🤖 ${agentMsg}`);

      if (turn === maxTurns - 1) break;
      const next = await patientReply(callLLM, persona.brief, transcript);
      if (!next || /\[FIN\]/i.test(next)) break;
      patientMsg = next.replace(/\[FIN\]/gi, '').trim() || next;
    }

    const derivaciones = DERIVE ? [...derive.derivacionesCapturadas] : [];
    if (DERIVE) {
      if (derivaciones.length === 0) {
        console.log('   📭 No derivó nada');
      } else {
        for (const d of derivaciones) {
          console.log(
            `   📨 Derivada a ${d.professionalName ?? '(respaldo)'} → ${derive.DERIVE_TEST_PHONE} [${d.via}${d.urgent ? ', URGENTE' : ''}]`,
          );
          console.log(
            d.parte
              .split('\n')
              .map((l) => `      │ ${l}`)
              .join('\n'),
          );
        }
      }
    }

    const findings = await judge(
      callLLM,
      {
        ...persona,
        redFlags: DERIVE ? [...DERIVE_RED_FLAGS_COMUNES, ...persona.redFlags] : persona.redFlags,
      },
      groundingSummary,
      transcript,
      DERIVE ? derivaciones : null,
    );
    report[persona.id] = DERIVE ? { transcript, findings, derivaciones } : { transcript, findings };
    if (DERIVE && derivaciones.length === 0) sinDerivar++;
    for (const f of findings) {
      if (f.severity === 'alta') totalHigh++;
      const icon = f.severity === 'alta' ? '🔴' : f.severity === 'media' ? '🟠' : '🟡';
      console.log(`   ${icon} [${f.severity}] ${f.issue}`);
    }
    if (findings.length === 0) console.log('   ✅ Sin hallazgos');
  }

  const outDir = join(process.cwd(), '.sim-reports');
  await mkdir(outDir, { recursive: true });
  const outFile = join(outDir, `sim-${Date.now()}.json`);
  await writeFile(outFile, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n📄 Reporte completo: ${outFile}`);
  if (DERIVE) {
    console.log(
      `📊 Conversaciones que terminaron sin derivar: ${sinDerivar}/${personas.length} (algunas no tienen que derivar: sólo información, proveedor…)`,
    );
  }
  console.log(`\n${totalHigh === 0 ? '✅' : '❌'} Hallazgos de severidad alta: ${totalHigh}\n`);
  process.exit(totalHigh === 0 ? 0 : 1);
}

/** El LLM-paciente genera su siguiente mensaje dado el transcript. */
async function patientReply(
  callLLM: typeof import('../llm').callLLM,
  brief: string,
  transcript: Turn[],
): Promise<string | null> {
  const system = `${brief}

Estás escribiendo por WhatsApp a una clínica. Actuá como una persona real: mensajes cortos, naturales, uno por turno. NO te salgas del papel ni expliques que sos una IA. Cuando tu objetivo esté resuelto (te dieron la cita o una respuesta clara) o ya no tenga sentido seguir, respondé SOLO con [FIN]. No repitas literalmente lo mismo dos veces.`;
  // Para el paciente, SUS mensajes son 'assistant' y los del agente 'user'.
  const messages = [
    { role: 'system' as const, content: system },
    ...transcript.map((t) =>
      t.speaker === 'patient'
        ? { role: 'assistant' as const, content: t.text }
        : { role: 'user' as const, content: t.text },
    ),
  ];
  try {
    const res = await callLLM({ messages, tools: [], temperature: 0.8 });
    return res.text?.trim() ?? null;
  } catch {
    return null;
  }
}

/** El LLM-juez lee la conversación y devuelve hallazgos. */
async function judge(
  callLLM: typeof import('../llm').callLLM,
  persona: { id: string; brief: string; redFlags: string[] },
  groundingSummary: string,
  transcript: Turn[],
  derivaciones: Array<{ professionalName: string | null; parte: string }> | null,
): Promise<Finding[]> {
  const convo = transcript
    .map((t) => `${t.speaker === 'patient' ? 'PACIENTE' : 'AGENTE'}: ${t.text}`)
    .join('\n');
  const reglasDelModo = derivaciones
    ? `
CÓMO FUNCIONA ESTE ASISTENTE (no lo confundas con un fallo):
- Este centro NO lleva su agenda en la plataforma. El asistente NO puede ver huecos ni reservar, y no debe hacerlo.
- Su trabajo es entender la consulta, recoger los datos y pasársela al profesional que corresponde. El profesional contacta después al paciente.
- El mensaje de cierre ("le he pasado tu consulta a Fulano") lo escribe la APLICACIÓN con el nombre REAL de quien recibió el aviso, no el modelo. Decir ese nombre al final es CORRECTO y esperado: no es una invención ni implica que haya agenda.
- Pedir el nombre del paciente y su disponibilidad en franjas ("por las tardes") es correcto. Dar una HORA concreta o confirmar una cita, no.
`
    : '';
  const system = `Sos un auditor de calidad de un agente de atención al paciente por WhatsApp.${reglasDelModo} Te doy la VERDAD de la clínica, el perfil del paciente simulado, qué vigilar, y la conversación. Detectá SOLO problemas reales del AGENTE (no del paciente): incoherencias, datos inventados o contradictorios con la verdad, atribuir un tratamiento a quien no lo hace, reservar sin que el paciente eligiera, rechazar algo que sí es de la clínica, tono inadecuado, o bajones claros de calidad.

Antes de marcar algo, comprobá que de verdad está (o falta) en el texto que te doy: no marques como ausente un dato que sí aparece. Marcá "alta" sólo lo que perjudica al paciente o al centro de verdad.

Respondé EXCLUSIVAMENTE con un array JSON (sin texto alrededor). Cada elemento: {"severity":"alta|media|baja","issue":"qué está mal, 1 frase","evidence":"cita textual del mensaje del agente"}. Si no hay problemas, respondé [].`;
  const partes = derivaciones
    ? derivaciones.length > 0
      ? derivaciones
          .map(
            (d, i) =>
              `--- Aviso ${i + 1} (a ${d.professionalName ?? 'el número de respaldo'}) ---\n${d.parte}`,
          )
          .join('\n')
      : '(el asistente no le pasó la consulta a nadie)'
    : null;
  const bloqueParte = partes
    ? `\n\nAVISO(S) QUE SE LE MANDARON AL PROFESIONAL — audítalos también: ¿el resumen refleja lo que contó el paciente, sin inventar ni omitir lo importante? ¿el servicio elegido es el que corresponde? ¿llegó a la persona adecuada según quién hace qué?\n${partes}`
    : '';
  const user = `VERDAD DE LA CLÍNICA:\n${groundingSummary}\n\nPERFIL DEL PACIENTE:\n${persona.brief}\n\nQUÉ VIGILAR:\n- ${persona.redFlags.join('\n- ')}\n\nCONVERSACIÓN:\n${convo}${bloqueParte}`;
  try {
    const res = await callLLM({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      tools: [],
      temperature: 0,
    });
    return parseFindings(res.text);
  } catch {
    return [];
  }
}

function parseFindings(text: string | null): Finding[] {
  if (!text) return [];
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0]) as Finding[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((f) => f && typeof f.issue === 'string')
      .map((f) => ({
        severity: f.severity === 'alta' || f.severity === 'media' ? f.severity : 'baja',
        issue: f.issue,
        evidence: typeof f.evidence === 'string' ? f.evidence : '',
      }));
  } catch {
    return [];
  }
}

main().catch((err) => {
  console.error('Simulador crasheó:', err);
  process.exit(1);
});
