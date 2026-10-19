// Texto con formato para la historia clínica. Puro e isomorfo (servidor y
// navegador), con tests.
//
// La clínica quería negrita y rojo en las notas (y algo más: cursiva,
// subrayado, colores, resaltado y listas). Se guarda en las mismas columnas de
// texto con un subconjunto MUY pequeño de etiquetas:
//
//   <b> <i> <u> <mark> <span data-c="red|orange|green|blue"> <br> <ul> <ol> <li>
//
// Nunca se inyecta como HTML: `parseRich` lo convierte en un árbol y quien lo
// pinta crea los elementos uno a uno. Cualquier otra etiqueta, atributo o
// `<` suelto ("SatO2 < 95") es texto. Las notas viejas, sin etiquetas, se leen
// igual que siempre. Quien necesita texto plano (agentes, barridos, avisos)
// usa `richToPlain`.

export const RICH_COLORS = {
  red: { label: 'Rojo', hex: '#dc2626' },
  orange: { label: 'Naranja', hex: '#ea580c' },
  green: { label: 'Verde', hex: '#16a34a' },
  blue: { label: 'Azul', hex: '#2563eb' },
} as const;
export type RichColor = keyof typeof RICH_COLORS;

export type RichNode =
  | { type: 'text'; text: string }
  | { type: 'br' }
  | {
      type: 'b' | 'i' | 'u' | 'mark' | 'ul' | 'ol' | 'li';
      children: RichNode[];
    }
  | { type: 'color'; color: RichColor; children: RichNode[] };

type ContainerType = 'b' | 'i' | 'u' | 'mark' | 'ul' | 'ol' | 'li' | 'color';

const TAG_RE = /^<(\/?)(b|i|u|mark|ul|ol|li|br|span)(\s+data-c="(red|orange|green|blue)")?\s*\/?>/i;

function decode(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

export function escapeRichText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** El árbol del texto. Etiquetas desconocidas o mal cerradas se toleran. */
export function parseRich(input: string | null | undefined): RichNode[] {
  const root: RichNode[] = [];
  const stack: { type: ContainerType; node: RichNode & { children: RichNode[] } }[] = [];
  const current = () => (stack.length ? (stack[stack.length - 1]?.node.children ?? root) : root);
  let buffer = '';
  const flush = () => {
    if (!buffer) return;
    current().push({ type: 'text', text: decode(buffer) });
    buffer = '';
  };

  const src = input ?? '';
  let i = 0;
  while (i < src.length) {
    if (src[i] === '<') {
      const m = TAG_RE.exec(src.slice(i));
      if (m) {
        flush();
        const closing = m[1] === '/';
        const tag = (m[2] ?? '').toLowerCase();
        if (tag === 'br') {
          current().push({ type: 'br' });
        } else if (closing) {
          const type: ContainerType = tag === 'span' ? 'color' : (tag as ContainerType);
          // Cierra hasta la etiqueta que corresponde; si no estaba abierta, se ignora.
          const at = stack.map((s) => s.type).lastIndexOf(type);
          if (at >= 0) stack.length = at;
        } else if (tag === 'span') {
          const color = (m[4] ?? '').toLowerCase() as RichColor;
          const node = {
            type: 'color' as const,
            color: color in RICH_COLORS ? color : 'red',
            children: [],
          };
          if (!m[4]) {
            // <span> sin color: no aporta nada, se trata como texto.
            buffer += m[0];
            i += m[0].length;
            continue;
          }
          current().push(node);
          stack.push({ type: 'color', node });
        } else {
          const node = { type: tag as Exclude<ContainerType, 'color'>, children: [] as RichNode[] };
          current().push(node);
          stack.push({ type: tag as ContainerType, node });
        }
        i += m[0].length;
        continue;
      }
    }
    buffer += src[i];
    i += 1;
  }
  flush();
  return root;
}

/** ¿Lleva formato? Las notas sin etiquetas se pintan como texto llano. */
export function isRich(input: string | null | undefined): boolean {
  return Boolean(input && /<\/?(b|i|u|mark|ul|ol|li|br|span data-c=)/i.test(input));
}

function serializeNodes(nodes: RichNode[]): string {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text') out += escapeRichText(n.text);
    else if (n.type === 'br') out += '<br>';
    else if (n.type === 'color') {
      const inner = serializeNodes(n.children);
      if (inner) out += `<span data-c="${n.color}">${inner}</span>`;
    } else {
      const inner = serializeNodes(n.children);
      if (inner || n.type === 'li') out += `<${n.type}>${inner}</${n.type}>`;
    }
  }
  return out;
}

/** Vuelve a escribir el texto con SÓLO las etiquetas permitidas (lo que se guarda). */
export function sanitizeRich(input: string | null | undefined): string {
  return serializeNodes(parseRich(input))
    .replace(/(<br>)+$/g, '')
    .trim();
}

function plainNodes(nodes: RichNode[], out: string[]): void {
  for (const n of nodes) {
    if (n.type === 'text') out.push(n.text);
    else if (n.type === 'br') out.push('\n');
    else if (n.type === 'li') {
      out.push('\n- ');
      plainNodes(n.children, out);
    } else if (n.type === 'ul' || n.type === 'ol') {
      plainNodes(n.children, out);
      out.push('\n');
    } else plainNodes(n.children, out);
  }
}

/** El texto sin formato: lo que leen los asistentes, los barridos y los avisos. */
export function richToPlain(input: string | null | undefined): string {
  if (!input) return '';
  const out: string[] = [];
  plainNodes(parseRich(input), out);
  return out
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
