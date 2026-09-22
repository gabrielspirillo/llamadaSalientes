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
 * El SALUDO y el prompt viven en Retell, como texto literal, NO aquí.
 *
 * Antes inyectábamos el saludo desde el código como `{{greeting}}` en el
 * `begin_message` del agente. Eso lo ataba a que la llamada saliera de esta
 * app: cualquier prueba hecha desde el panel de Retell arrancaba diciendo
 * "{{greeting}}" en voz alta, y `{{brand}}` se leía como "mil". Desde que la
 * página no pide el nombre, el saludo es siempre idéntico, así que inyectarlo
 * no aportaba nada y sólo añadía una forma de romperse.
 *
 * Si alguien vuelve a poner `{{...}}` en el prompt del agente, tiene que
 * añadir aquí la variable correspondiente o volverá a leerse en crudo.
 */

/** Variables dinámicas disponibles para el prompt, iguales en ambos caminos. */
export function sapinnDynamicVars(displayName = ''): Record<string, string> {
  return {
    brand: SAPINN_BRAND,
    lead_name: displayName,
    current_date: new Date().toISOString().slice(0, 10),
    direction: 'outbound',
    lead_source: 'sapinn-landing',
    use_case: 'prueba',
    campaign_name: 'Prueba desde la propuesta',
    demo_flow: 'sapinn',
  };
}
