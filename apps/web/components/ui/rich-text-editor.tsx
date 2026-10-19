'use client';

import { cn } from '@/lib/cn';
import {
  RICH_COLORS,
  type RichColor,
  type RichNode,
  escapeRichText,
  parseRich,
  richToPlain,
  sanitizeRich,
} from '@/lib/rich-text';
import { Bold, Highlighter, Italic, List, ListOrdered, Paintbrush, Underline } from 'lucide-react';
import * as React from 'react';

/**
 * Campo de texto con formato: negrita, cursiva, subrayado, colores, resaltado
 * y listas. Lo que se escribe se guarda en el formato reducido y seguro de
 * `lib/rich-text.ts` (nunca HTML tal cual). Se pega siempre como texto plano:
 * lo que viene de Word o de un correo trae estilos que romperían la ficha.
 *
 * Las herramientas van recogidas tras el pincel: el campo se ve limpio y el
 * formato aparece sólo cuando se pide. Los atajos funcionan siempre:
 * ⌘/Ctrl+B, ⌘/Ctrl+I, ⌘/Ctrl+U.
 */
export function RichTextEditor({
  id,
  value,
  onChange,
  placeholder,
  minHeight = 72,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Alto mínimo del área, en px. */
  minHeight?: number;
  ariaLabel?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const lastEmitted = React.useRef<string | null>(null);
  const [empty, setEmpty] = React.useState(!richToPlain(value));
  const [active, setActive] = React.useState<Record<string, boolean>>({});
  const [focused, setFocused] = React.useState(false);
  const [tools, setTools] = React.useState(false);

  // Lo que viene de fuera ("Partir de la anterior", nota guardada) se carga en
  // el área; lo que acabamos de emitir nosotros no, o el cursor saltaría.
  React.useEffect(() => {
    const el = ref.current;
    if (!el || value === lastEmitted.current) return;
    el.innerHTML = toEditorHtml(value);
    lastEmitted.current = value;
    setEmpty(!richToPlain(value));
  }, [value]);

  function emit() {
    const el = ref.current;
    if (!el) return;
    const next = sanitizeRich(serializeDom(el).replace(/<\/mark><mark>/g, ''));
    lastEmitted.current = next;
    setEmpty(!richToPlain(next));
    onChange(next);
  }

  function refreshActive() {
    if (typeof document === 'undefined') return;
    const state = (cmd: string) => {
      try {
        return document.queryCommandState(cmd);
      } catch {
        return false;
      }
    };
    setActive({
      bold: state('bold'),
      italic: state('italic'),
      underline: state('underline'),
      insertUnorderedList: state('insertUnorderedList'),
      insertOrderedList: state('insertOrderedList'),
      highlight: highlightValue() === HIGHLIGHT_HEX,
    });
  }

  function highlightValue(): string | null {
    try {
      // Chrome y Safari lo responden por backColor; Firefox, por hiliteColor.
      return (
        hexOf(String(document.queryCommandValue('backColor') || '')) ??
        hexOf(String(document.queryCommandValue('hiliteColor') || ''))
      );
    } catch {
      return null;
    }
  }

  // El resaltado es un interruptor: sobre texto resaltado lo quita. Va con
  // styleWithCSS para que el navegador lo escriba como estilo en línea, que es
  // lo que sabe partir y anular con 'transparent'.
  function toggleHighlight() {
    ref.current?.focus();
    const on = highlightValue() === HIGHLIGHT_HEX;
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand('hiliteColor', false, on ? 'transparent' : HIGHLIGHT_HEX);
    document.execCommand('styleWithCSS', false, 'false');
    emit();
    refreshActive();
  }

  function exec(command: string, arg?: string) {
    ref.current?.focus();
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand(command, false, arg);
    emit();
    refreshActive();
  }

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[14px] border bg-white transition-shadow',
        focused
          ? 'border-brand-400 ring-4 ring-brand-100'
          : 'border-(--color-border) hover:border-zinc-300',
      )}
    >
      <button
        type="button"
        title={tools ? 'Ocultar formato' : 'Dar formato al texto'}
        aria-label={tools ? 'Ocultar formato' : 'Dar formato al texto'}
        aria-expanded={tools}
        // mousedown: que abrir el pincel no le quite la selección al texto.
        onMouseDown={(e) => {
          e.preventDefault();
          setTools((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setTools((v) => !v);
          }
        }}
        className={cn(
          'press absolute right-1.5 top-1 z-10 grid h-8 w-8 place-items-center rounded-full transition-all',
          tools
            ? 'bg-[linear-gradient(120deg,#37766a_0%,#479183_45%,#5fa896_100%)] text-white shadow-[0_6px_16px_-8px_rgba(55,118,106,0.8)]'
            : 'bg-white text-brand-700 ring-1 ring-(--color-border) hover:-translate-y-0.5 hover:bg-brand-50 hover:ring-brand-200',
        )}
      >
        <Paintbrush className="h-4 w-4" />
        {!tools && (
          <span
            aria-hidden
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white"
            style={{
              background: `conic-gradient(${Object.values(RICH_COLORS)
                .map((c) => c.hex)
                .join(',')},${RICH_COLORS.red.hex})`,
            }}
          />
        )}
      </button>

      {tools && (
        <div
          className="flex animate-fade-up flex-wrap items-center gap-0.5 border-b border-(--color-border-subtle) bg-zinc-50/80 py-1 pl-1.5 pr-11"
          role="toolbar"
          aria-label="Formato del texto"
        >
          <ToolButton label="Negrita (⌘B)" active={active.bold} onClick={() => exec('bold')}>
            <Bold className="h-4 w-4" />
          </ToolButton>
          <ToolButton label="Cursiva (⌘I)" active={active.italic} onClick={() => exec('italic')}>
            <Italic className="h-4 w-4" />
          </ToolButton>
          <ToolButton
            label="Subrayado (⌘U)"
            active={active.underline}
            onClick={() => exec('underline')}
          >
            <Underline className="h-4 w-4" />
          </ToolButton>
          <Divider />
          {(Object.keys(RICH_COLORS) as RichColor[]).map((c) => (
            <ToolButton
              key={c}
              label={`Texto en ${RICH_COLORS[c].label.toLowerCase()}`}
              onClick={() => exec('foreColor', RICH_COLORS[c].hex)}
            >
              <span
                className="h-4 w-4 rounded-full ring-2 ring-white"
                style={{ backgroundColor: RICH_COLORS[c].hex, boxShadow: '0 0 0 1px #d4d4d8' }}
                aria-hidden
              />
            </ToolButton>
          ))}
          <ToolButton label="Quitar color" onClick={() => exec('foreColor', NEUTRAL_HEX)}>
            <span
              className="h-4 w-4 rounded-full bg-zinc-900 ring-2 ring-white"
              style={{ boxShadow: '0 0 0 1px #d4d4d8' }}
              aria-hidden
            />
          </ToolButton>
          <ToolButton
            label={active.highlight ? 'Quitar resaltado' : 'Resaltar'}
            active={active.highlight}
            onClick={toggleHighlight}
          >
            <Highlighter className="h-4 w-4" />
          </ToolButton>
          <Divider />
          <ToolButton
            label="Lista con viñetas"
            active={active.insertUnorderedList}
            onClick={() => exec('insertUnorderedList')}
          >
            <List className="h-4 w-4" />
          </ToolButton>
          <ToolButton
            label="Lista numerada"
            active={active.insertOrderedList}
            onClick={() => exec('insertOrderedList')}
          >
            <ListOrdered className="h-4 w-4" />
          </ToolButton>
        </div>
      )}

      <div className="relative">
        {empty && placeholder && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-3.5 right-12 top-2.5 truncate text-[16px] text-zinc-400"
          >
            {placeholder}
          </span>
        )}
        <div
          id={id}
          ref={ref}
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel ?? placeholder}
          contentEditable
          suppressContentEditableWarning
          tabIndex={0}
          className="rich-editor py-2.5 pl-3.5 pr-12 text-[16px] leading-relaxed text-zinc-900 outline-none [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
          // El foco ya lo marca el marco; el contorno global quedaría como una raya.
          style={{ minHeight, outline: 'none' }}
          onInput={emit}
          onBlur={() => {
            setFocused(false);
            emit();
          }}
          onFocus={() => {
            setFocused(true);
            refreshActive();
          }}
          onKeyUp={refreshActive}
          onMouseUp={refreshActive}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData('text/plain');
            document.execCommand('insertText', false, text);
            emit();
          }}
        />
      </div>
    </div>
  );
}

function ToolButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      // mousedown: que el clic no le quite la selección al texto.
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'grid h-8 w-8 place-items-center rounded-lg text-zinc-600 transition-colors hover:bg-white hover:text-zinc-900',
        active && 'bg-white text-brand-700 shadow-sm ring-1 ring-(--color-border)',
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-zinc-200" />;
}

const NEUTRAL_HEX = '#18181b';
const HIGHLIGHT_HEX = '#fef08a';

// ─── Del formato guardado al área editable, y vuelta ────────────────────────

function nodesToHtml(nodes: RichNode[]): string {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text') out += escapeRichText(n.text).replace(/\n/g, '<br>');
    else if (n.type === 'br') out += '<br>';
    else if (n.type === 'color') {
      out += `<font color="${RICH_COLORS[n.color].hex}">${nodesToHtml(n.children)}</font>`;
    } else if (n.type === 'mark') {
      // Como estilo en línea, no <mark>: es lo que el navegador sabe quitar.
      out += `<span style="background-color: ${HIGHLIGHT_HEX}">${nodesToHtml(n.children)}</span>`;
    } else out += `<${n.type}>${nodesToHtml(n.children)}</${n.type}>`;
  }
  return out;
}

function toEditorHtml(value: string): string {
  return nodesToHtml(parseRich(value));
}

function hexOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v.startsWith('#')) {
    return v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v;
  }
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(v);
  if (!m) return null;
  if (m[4] !== undefined && Number(m[4]) === 0) return null;
  return `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`;
}

function colorKey(raw: string | null | undefined): RichColor | null {
  const hex = hexOf(raw);
  if (!hex) return null;
  for (const [k, c] of Object.entries(RICH_COLORS)) {
    if (c.hex === hex) return k as RichColor;
  }
  return null;
}

/**
 * El contenido del área en el formato reducido (se sanea después). El
 * resaltado se resuelve por tramo de texto (`highlighted` se hereda y un fondo
 * 'transparent' lo corta), porque el navegador lo quita anidando un fondo
 * transparente dentro del amarillo en vez de partir el amarillo.
 */
function serializeDom(root: Node, highlighted = false): string {
  let out = '';
  root.childNodes.forEach((child, index) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = escapeRichText(
        (child.textContent ?? '').replace(/ /g, ' ').replace(/\u200b/g, ''),
      );
      out += highlighted && text ? `<mark>${text}</mark>` : text;
      return;
    }
    if (!(child instanceof HTMLElement)) return;
    const tag = child.tagName;
    if (tag === 'BR') {
      out += '<br>';
      return;
    }
    const style = child.style;
    const childHighlighted =
      tag === 'MARK' ||
      (style.backgroundColor ? hexOf(style.backgroundColor) !== null : highlighted);
    let inner = serializeDom(child, childHighlighted);
    const color = colorKey(tag === 'FONT' ? child.getAttribute('color') : style.color);
    if (color) inner = `<span data-c="${color}">${inner}</span>`;
    if (
      tag === 'B' ||
      tag === 'STRONG' ||
      style.fontWeight === 'bold' ||
      Number(style.fontWeight) >= 600
    ) {
      inner = `<b>${inner}</b>`;
    }
    if (tag === 'I' || tag === 'EM' || style.fontStyle === 'italic') inner = `<i>${inner}</i>`;
    if (tag === 'U' || style.textDecorationLine?.includes('underline')) inner = `<u>${inner}</u>`;
    if (tag === 'UL' || tag === 'OL' || tag === 'LI') {
      out += `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>`;
      return;
    }
    if (tag === 'DIV' || tag === 'P') {
      // Cada línea nueva que crea el navegador es un bloque: va a <br>.
      out += (index > 0 && !out.endsWith('<br>') ? '<br>' : '') + inner;
      return;
    }
    out += inner;
  });
  return out;
}
