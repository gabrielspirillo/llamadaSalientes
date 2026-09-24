/**
 * Formato de WhatsApp para lo que escribe el asistente.
 *
 * WhatsApp no entiende Markdown: su negrita es UN asterisco a cada lado
 * (`*así*`). El modelo, entrenado con Markdown, devuelve `**así**`, y el
 * paciente recibe los asteriscos tal cual —"**Fisioterapia**: 45 min"— en vez
 * de la palabra en negrita.
 *
 * Es una traducción de canal, no un guardrail: el prompt puede pedir lo que
 * quiera, pero un modelo se va a saltar la instrucción tarde o temprano y
 * quien lo paga es el paciente. Por eso se aplica siempre, al final.
 *
 * Puro y sin dependencias, con tests en `tests/unit/whatsapp-formato.test.ts`.
 */
export function toWhatsappFormatting(text: string): string {
  return (
    text
      // `**negrita**` → `*negrita*`. Exigimos contenido que no empiece ni acabe
      // en espacio para no tocar un `**` suelto (una multiplicación, un asterisco
      // de nota al pie), que no marca nada y quedaría peor convertido.
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '*$1*')
      // `__negrita__` es la otra forma de Markdown. `_cursiva_` de un solo guion
      // ya es cursiva en WhatsApp, así que esa se deja como está.
      .replace(/__(?=\S)([\s\S]*?\S)__/g, '*$1*')
  );
}
