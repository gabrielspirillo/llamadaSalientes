import 'server-only';
import { env } from '@/lib/env';

/**
 * Configuración del agente de voz que atiende la demo de Sapinn (/sapinn).
 *
 * Vive en un solo sitio porque lo comparten los DOS caminos de la demo:
 * la llamada por navegador (WebRTC) y la llamada al teléfono del visitante.
 * Cuando estaban separados, el camino telefónico acabó usando el agente de
 * clínicas de Futura: el visitante pedía una llamada de una marca de
 * nutrición infantil y le atendía un agente hablando de odontología.
 */

// Agente DEDICADO de la demo de Sapinn (marca de alimentación infantil que
// llama a farmacias, español de España). Es un agente propio en Retell,
// aislado de los de Futura: no comparte prompt ni LLM con el agente de demo
// de Futura, así que ajustarlo no afecta al resto del dashboard.
const SAPINN_DEMO_AGENT_ID = 'agent_e8d27609a342f597ba3e5ef329';

/** Marca de la demo (placeholder profesional; se cambia aquí, en un sitio). */
export const SAPINN_BRAND = 'Nutrialia';

export function sapinnAgentId(): string {
  return env.SAPINN_RETELL_AGENT_ID || SAPINN_DEMO_AGENT_ID;
}

/**
 * Saludo que inyectamos en `begin_message` ({{greeting}}) del agente.
 *
 * Lo componemos NOSOTROS para que la agente hable primero: con
 * `begin_message` vacío Retell espera a que hable el visitante y la demo
 * arranca en silencio, que es justo lo que no puede pasar delante de un
 * cliente. Declara IA en la primera frase, como exige el pliego.
 *
 * Sin nombre (el caso normal: la página ya no lo pide) la agente lo pregunta;
 * si llegara uno, saluda por él y no lo vuelve a pedir.
 */
export function sapinnGreeting(displayName: string): string {
  const hello = displayName ? `Buenos días, ${displayName}.` : 'Buenos días.';
  const ask = displayName
    ? '¿Tiene un momento para hablar?'
    : '¿Con quién tengo el gusto de hablar?';
  return `${hello} Soy Lucía, un asistente de voz con inteligencia artificial de ${SAPINN_BRAND}, nutrición infantil. ${ask}`;
}

/** Variables dinámicas que lee el prompt del agente, iguales en ambos caminos. */
export function sapinnDynamicVars(displayName = ''): Record<string, string> {
  return {
    greeting: sapinnGreeting(displayName),
    brand: SAPINN_BRAND,
    lead_name: displayName,
    name: displayName,
    patient_name: displayName,
    current_date: new Date().toISOString().slice(0, 10),
    direction: 'outbound',
    lead_source: 'sapinn-landing',
    use_case: 'prueba',
    campaign_name: 'Prueba desde la propuesta',
    demo_flow: 'sapinn',
  };
}
