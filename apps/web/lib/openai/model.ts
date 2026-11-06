/**
 * El ÚNICO modelo de lenguaje de la plataforma: gpt-5.4 (OpenAI), desde el
 * 6/11/2026. Antes el asistente de WhatsApp, las imágenes y los resúmenes de
 * llamadas pasaban por Gemini Flash y fallaba al interpretar; la clínica pidió
 * no volver a usarlo para nada. Se cambia con OPENAI_AGENT_MODEL.
 */
export const OPENAI_MODEL = process.env.OPENAI_AGENT_MODEL || 'gpt-5.4';
