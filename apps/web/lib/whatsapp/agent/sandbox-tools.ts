import 'server-only';

import { type ExecuteToolInput, executeAgentTool } from './tools';
import type { ToolCallTrace } from './types';

/**
 * Ejecutor de tools para el PROBADOR del agente. Las tools de lectura
 * (disponibilidad, info de paciente, tratamientos, FAQs) corren de verdad
 * contra los datos del tenant; las que MUTAN se SIMULAN (no tocan GHL ni crean
 * nada). Así se prueba el flujo completo sin efectos secundarios reales.
 */
const SIMULATED: Record<string, string> = {
  book_appointment: 'Cita agendada correctamente. (SIMULADO en el probador — no se creó nada real.)',
  cancel_appointment: 'La cita fue cancelada correctamente. (SIMULADO en el probador.)',
  register_patient: 'Paciente registrado. (SIMULADO en el probador, contact_id: sandbox-test.)',
  set_lead_email: 'Email guardado. (SIMULADO en el probador.)',
};

export async function sandboxExecuteTool(input: ExecuteToolInput): Promise<ToolCallTrace> {
  const simulated = SIMULATED[input.toolName];
  if (simulated) {
    return {
      name: input.toolName,
      args:
        input.rawArgs && typeof input.rawArgs === 'object'
          ? (input.rawArgs as Record<string, unknown>)
          : {},
      ok: true,
      result: simulated,
      latencyMs: 0,
    };
  }
  // Read-only y terminales: ejecución real.
  return executeAgentTool(input);
}
