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

/**
 * Formato de WhatsApp (*negrita*, _cursiva_, ~tachado~) en trozos, para que el
 * inbox lo pinte como el móvil en vez de enseñar los asteriscos. Puro y sin
 * HTML: el componente convierte cada trozo en un elemento.
 *
 * Un marcador sólo cuenta si no está pegado a una letra o número por fuera
 * (así `snake_case` o una URL con guiones bajos no se vuelven cursiva) y si
 * no empieza ni acaba en espacio. Puede ocupar varias líneas, pero no un
 * párrafo vacío entre medio.
 */
export type WaSegment = { text: string; bold?: boolean; italic?: boolean; strike?: boolean };

const MARKS: Record<string, keyof Omit<WaSegment, 'text'>> = {
  '*': 'bold',
  _: 'italic',
  '~': 'strike',
};
const RE = /(?<![\p{L}\p{N}])([*_~])(?=\S)((?:(?!\n\s*\n)[\s\S])*?\S)\1(?![\p{L}\p{N}])/gu;

export function parseWhatsappFormatting(
  text: string,
  inherited: Omit<WaSegment, 'text'> = {},
): WaSegment[] {
  const out: WaSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ text: text.slice(last, start), ...inherited });
    const mark = MARKS[m[1] ?? ''];
    if (mark) out.push(...parseWhatsappFormatting(m[2] ?? '', { ...inherited, [mark]: true }));
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), ...inherited });
  return out.filter((s) => s.text.length > 0);
}
