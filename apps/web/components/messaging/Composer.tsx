'use client';

import { type MentionIndex, PersonAvatar, formatBytes } from '@/components/messaging/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { MAX_ATTACHMENT_BYTES, MAX_BODY_LENGTH, REACTION_EMOJIS } from '@/lib/messaging/constants';
import type { ImAttachment, ImPerson } from '@/lib/messaging/types';
import {
  AtSign,
  FileText,
  ListTodo,
  type LucideIcon,
  Paperclip,
  Phone,
  Send,
  Smile,
  Sparkles,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* ============================================================================
   Composer con comandos (`/`) y menciones (`@`).

   El popover filtra a medida que escribes, se navega con flechas, se acepta
   con Enter o Tab y se cierra con Escape. Enter envía; Shift+Enter salta de
   línea. El aviso de "está escribiendo" sale como mucho una vez cada 3 s.
   ========================================================================== */

interface CommandDef {
  key: string;
  token: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}

const COMMANDS: CommandDef[] = [
  {
    key: 'tarea',
    token: '/tarea ',
    label: '/tarea',
    hint: 'Crear una tarea con lo que escribas a continuación',
    icon: ListTodo,
  },
  {
    key: 'llamar',
    token: '/llamar ',
    label: '/llamar',
    hint: 'Crear una tarea de llamada, con el paciente en el título',
    icon: Phone,
  },
  {
    key: 'paciente',
    token: '/paciente ',
    label: '/paciente',
    hint: 'Traer la ficha de un paciente al hilo',
    icon: Users,
  },
  {
    key: 'decision',
    token: '/decision ',
    label: '/decision',
    hint: 'Dejar registrada una decisión del equipo',
    icon: Sparkles,
  },
];

/**
 * ¿El texto empieza por un comando conocido? Devuelve la clave y el resto.
 * Exige un espacio detrás para que "/tareas pendientes" no se coma el `/tarea`.
 */
export function matchCommand(body: string): { key: string; arg: string } | null {
  const m = /^\/([a-záéíóúñ]+)(?:\s+([\s\S]*))?$/i.exec(body.trim());
  if (!m) return null;
  const key = (m[1] ?? '').toLowerCase();
  const def = COMMANDS.find((c) => c.key === key);
  if (!def) return null;
  return { key: def.key, arg: (m[2] ?? '').trim() };
}

const TYPING_THROTTLE_MS = 3000;

type MenuKind = '/' | '@';

interface MenuState {
  kind: MenuKind;
  query: string;
  /** Índice en el texto donde arranca el token (incluye el `/` o el `@`). */
  start: number;
}

export interface ComposerProps {
  channelName: string;
  people: ImPerson[];
  mentions: MentionIndex;
  currentUserId?: string | null;
  disabled?: boolean;
  placeholder?: string;
  /** Cambia al cambiar de canal: re-enfoca y limpia el borrador en curso. */
  resetKey?: string;
  /** Archivos soltados sobre el hilo; se suben y se adjuntan. */
  droppedFiles?: File[] | null;
  onDroppedHandled?: () => void;
  onSend: (body: string, attachments: ImAttachment[]) => void;
  /**
   * Ejecuta un comando de la barra. Sin esto, escribir `/tarea algo` mandaba un
   * mensaje literal con ese texto y no creaba nada: el popover era decoración.
   */
  onCommand?: (command: string, arg: string) => void;
  onTyping: () => void;
  compact?: boolean;
  className?: string;
}

export function Composer({
  channelName,
  people,
  mentions,
  currentUserId,
  disabled,
  placeholder,
  resetKey,
  droppedFiles,
  onDroppedHandled,
  onSend,
  onCommand,
  onTyping,
  compact,
  className,
}: ComposerProps) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<ImAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingRef = useRef(0);

  // Al cambiar de canal: borrador limpio y foco en la caja.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `resetKey` es el disparador del efecto, no un valor que se lea dentro
  useEffect(() => {
    setValue('');
    setAttachments([]);
    setMenu(null);
    setUploadError(null);
    textareaRef.current?.focus();
  }, [resetKey]);

  // Autosize: la caja crece con el texto hasta un tope, después scrollea.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hay que recalcular la altura en cada cambio de `value`
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(compact ? 140 : 200, el.scrollHeight)}px`;
  }, [value, compact]);

  const upload = useCallback(async (files: File[]) => {
    const usable = files.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
    if (usable.length !== files.length) {
      setUploadError(`Algún archivo supera ${formatBytes(MAX_ATTACHMENT_BYTES)} y se descartó.`);
    }
    if (usable.length === 0) return;

    setUploading((n) => n + usable.length);
    for (const file of usable) {
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/messages/attachments', { method: 'POST', body: form });
        const data = (await res.json().catch(() => ({}))) as {
          attachment?: ImAttachment;
          attachments?: ImAttachment[];
          key?: string;
          url?: string;
          name?: string;
          mime?: string;
          size?: number;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? 'No se pudo subir el archivo');

        const incoming: ImAttachment[] = data.attachments
          ? data.attachments
          : data.attachment
            ? [data.attachment]
            : [
                {
                  key: data.key ?? data.url ?? '',
                  name: data.name ?? file.name,
                  mime: data.mime ?? file.type,
                  size: data.size ?? file.size,
                },
              ];
        setAttachments((prev) => [...prev, ...incoming.filter((a) => a.key)]);
        setUploadError(null);
      } catch (err) {
        setUploadError((err as Error).message);
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    }
  }, []);

  // Archivos soltados sobre el hilo → misma tubería que el clip.
  useEffect(() => {
    if (!droppedFiles || droppedFiles.length === 0) return;
    void upload(droppedFiles);
    onDroppedHandled?.();
  }, [droppedFiles, upload, onDroppedHandled]);

  // ── Popover ────────────────────────────────────────────────────────────────

  const options = useMemo(() => {
    if (!menu)
      return [] as Array<{
        id: string;
        label: string;
        hint: string;
        node: React.ReactNode;
        insert: string;
      }>;
    const q = menu.query.toLowerCase();

    if (menu.kind === '/') {
      return COMMANDS.filter((c) => c.key.startsWith(q)).map((c) => ({
        id: c.key,
        label: c.label,
        hint: c.hint,
        insert: c.token,
        node: (
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-[10px] bg-brand-50 text-brand-600">
            <c.icon className="h-3.5 w-3.5" />
          </span>
        ),
      }));
    }

    const everyone = {
      id: '__todos__',
      label: '@todos',
      hint: 'Avisar a todo el canal',
      insert: '@todos ',
      node: (
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-white">
          <Users className="h-3.5 w-3.5" />
        </span>
      ),
    };

    const matches = people
      .filter((p) => p.userId !== currentUserId)
      .filter((p) => {
        const handle = mentions.forPerson.get(p.userId) ?? p.name;
        return (
          handle.toLowerCase().startsWith(q) ||
          p.name.toLowerCase().includes(q) ||
          p.email.toLowerCase().startsWith(q)
        );
      })
      .slice(0, 8)
      .map((p) => ({
        id: p.userId,
        label: `@${mentions.forPerson.get(p.userId) ?? p.name}`,
        hint: p.name,
        insert: `@${mentions.forPerson.get(p.userId) ?? p.name} `,
        node: <PersonAvatar name={p.name} seed={p.userId} size={28} />,
      }));

    return 'todos'.startsWith(q) ? [everyone, ...matches] : matches;
  }, [menu, people, mentions, currentUserId]);

  const detectMenu = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    // `@` en cualquier posición precedida de espacio; `/` solo al principio.
    const mention = /(?:^|\s)@([\p{L}\p{N}._-]*)$/u.exec(before);
    if (mention) {
      setMenu({ kind: '@', query: mention[1] ?? '', start: caret - (mention[1] ?? '').length - 1 });
      setActiveIndex(0);
      return;
    }
    const command = /^\/([\p{L}\p{N}._-]*)$/u.exec(before);
    if (command) {
      setMenu({ kind: '/', query: command[1] ?? '', start: 0 });
      setActiveIndex(0);
      return;
    }
    setMenu(null);
  };

  /** Inserta texto (un emoji) donde esté el cursor y devuelve el foco. */
  const insertAtCaret = (text: string) => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? value.length;
    const next = `${value.slice(0, caret)}${text}${value.slice(caret)}`.slice(0, MAX_BODY_LENGTH);
    setValue(next);
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      const pos = Math.min(caret + text.length, next.length);
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const applyOption = (index: number) => {
    const opt = options[index];
    if (!opt || !menu) return;
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? value.length;
    const next = `${value.slice(0, menu.start)}${opt.insert}${value.slice(caret)}`;
    setValue(next);
    setMenu(null);
    requestAnimationFrame(() => {
      const pos = menu.start + opt.insert.length;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  useEffect(() => {
    if (!emojiOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-composer-emoji]')) setEmojiOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEmojiOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [emojiOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value.slice(0, MAX_BODY_LENGTH);
    setValue(text);
    detectMenu(text, e.target.selectionStart ?? text.length);

    const now = Date.now();
    if (text.trim() && now - lastTypingRef.current > TYPING_THROTTLE_MS) {
      lastTypingRef.current = now;
      onTyping();
    }
  };

  const submit = () => {
    const body = value.trim();
    if ((!body && attachments.length === 0) || disabled || uploading > 0) return;

    // Un comando al principio de la línea se ejecuta en vez de enviarse. Solo
    // si hay adonde despacharlo y no lleva adjuntos: un comando con un archivo
    // colgando sería ambiguo, así que en ese caso va como mensaje normal.
    const cmd = onCommand && attachments.length === 0 ? matchCommand(body) : null;
    if (cmd) {
      onCommand?.(cmd.key, cmd.arg);
      setValue('');
      setAttachments([]);
      setMenu(null);
      lastTypingRef.current = 0;
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    onSend(body, attachments);
    setValue('');
    setAttachments([]);
    setMenu(null);
    lastTypingRef.current = 0;
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menu && options.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % options.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + options.length) % options.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applyOption(activeIndex);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenu(null);
        return;
      }
    }

    if (e.key === 'Escape') {
      setMenu(null);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const canSend =
    (value.trim().length > 0 || attachments.length > 0) && !disabled && uploading === 0;

  return (
    <div className={cn('relative', className)}>
      {/* Popover de comandos / menciones */}
      {menu && options.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 z-30 mb-2 animate-zoom-in overflow-hidden rounded-[18px] border border-[--color-border] bg-white shadow-[var(--shadow-lifted)]">
          <div className="flex items-center gap-1.5 border-b border-[--color-border-subtle] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">
            {menu.kind === '/' ? <Zap className="h-3 w-3" /> : <AtSign className="h-3 w-3" />}
            {menu.kind === '/' ? 'Comandos' : 'Mencionar a'}
          </div>
          <ul className="max-h-52 overflow-y-auto p-1.5">
            {options.map((opt, i) => (
              <li key={opt.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => applyOption(i)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-[14px] px-2.5 py-2 text-left transition-colors duration-150',
                    i === activeIndex ? 'bg-brand-50' : 'hover:bg-zinc-50',
                  )}
                >
                  {opt.node}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-zinc-900">
                      {opt.label}
                    </span>
                    <span className="block truncate text-[13px] text-zinc-500">{opt.hint}</span>
                  </span>
                  {i === activeIndex && (
                    <span className="shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-400 ring-1 ring-[--color-border]">
                      Enter
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Adjuntos en cola */}
      {(attachments.length > 0 || uploading > 0) && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {attachments.map((a) => (
            <span
              key={a.key}
              className="inline-flex animate-pop items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[13px] font-medium text-zinc-700 ring-1 ring-[--color-border]"
            >
              <FileText className="h-3 w-3 text-brand-500" />
              <span className="max-w-[160px] truncate">{a.name}</span>
              <span className="text-zinc-400">{formatBytes(a.size)}</span>
              <button
                type="button"
                aria-label={`Quitar ${a.name}`}
                onClick={() => setAttachments((prev) => prev.filter((x) => x.key !== a.key))}
                className="press rounded-full p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {Array.from({ length: uploading }, (_, i) => `up-${i}`).map((id) => (
            <span key={id} className="skeleton inline-block h-6 w-28 rounded-full" />
          ))}
        </div>
      )}

      {uploadError && <p className="mb-2 text-[13px] font-medium text-rose-600">{uploadError}</p>}

      {/* Caja */}
      <div
        className={cn(
          'relative flex items-end gap-1 rounded-[22px] border border-[--color-border] bg-white p-2 shadow-[var(--shadow-soft)]',
          // La caja se enfoca sola al entrar en un canal: un halo de color ahí
          // hace que la pantalla parezca pulsada nada más abrirla. Queda una
          // pista sobria, que quien navega con teclado necesita ver el foco.
          'transition-all duration-300 focus-within:border-brand-300 focus-within:shadow-[0_0_0_4px_rgba(95,168,150,0.10)]',
          disabled && 'opacity-60',
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) void upload(files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          aria-label="Adjuntar archivo"
          title="Adjuntar archivo"
          className="press mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors duration-200 hover:bg-brand-50 hover:text-brand-600"
        >
          <Paperclip className="h-4 w-4" />
        </button>

        <textarea
          ref={textareaRef}
          value={value}
          disabled={disabled}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onClick={(e) => detectMenu(value, e.currentTarget.selectionStart ?? 0)}
          rows={1}
          placeholder={placeholder ?? `Escribe en ${channelName}…  (/ comandos · @ menciones)`}
          aria-label={`Mensaje para ${channelName}`}
          className="scrollbar-none max-h-[200px] min-h-[36px] flex-1 resize-none border-0 bg-transparent px-1 py-2 text-[14px] leading-relaxed text-zinc-900 outline-none ring-0 placeholder:text-zinc-400 focus:outline-none focus:ring-0 focus-visible:outline-none"
        />

        <div className="relative mb-0.5 shrink-0" data-composer-emoji>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setEmojiOpen((v) => !v)}
            aria-label="Insertar un emoji"
            title="Insertar un emoji"
            aria-expanded={emojiOpen}
            className={cn(
              'press inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-200',
              emojiOpen
                ? 'bg-brand-100 text-brand-700'
                : 'text-zinc-400 hover:bg-brand-50 hover:text-brand-600',
            )}
          >
            <Smile className="h-4 w-4" />
          </button>

          {emojiOpen && (
            <div
              data-composer-emoji
              className="absolute bottom-full right-0 z-30 mb-2 grid w-[228px] animate-zoom-in grid-cols-6 gap-0.5 rounded-[18px] border border-[--color-border] bg-white p-2 shadow-[var(--shadow-lifted)]"
            >
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => insertAtCaret(emoji)}
                  aria-label={`Insertar ${emoji}`}
                  className="press inline-flex h-8 w-8 items-center justify-center rounded-full text-[18px] transition-transform duration-200 hover:scale-125 hover:bg-brand-50"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            const el = textareaRef.current;
            const caret = el?.selectionStart ?? value.length;
            const next = `${value.slice(0, caret)}@${value.slice(caret)}`;
            setValue(next);
            requestAnimationFrame(() => {
              el?.focus();
              el?.setSelectionRange(caret + 1, caret + 1);
              detectMenu(next, caret + 1);
            });
          }}
          aria-label="Mencionar a alguien"
          title="Mencionar a alguien"
          className="press mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors duration-200 hover:bg-brand-50 hover:text-brand-600"
        >
          <AtSign className="h-4 w-4" />
        </button>

        <Button
          size={compact ? 'sm' : 'md'}
          onClick={submit}
          disabled={!canSend}
          aria-label="Enviar mensaje"
          className={cn('mb-0.5 shrink-0', compact ? 'h-9 w-9 p-0' : 'h-10 w-10 p-0')}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      <p className="mt-1.5 px-2 text-[12px] text-zinc-400">
        <kbd className="rounded bg-zinc-100 px-1 font-sans font-semibold">Enter</kbd> envía ·{' '}
        <kbd className="rounded bg-zinc-100 px-1 font-sans font-semibold">Shift+Enter</kbd> salta de
        línea
        {value.length > MAX_BODY_LENGTH - 500 && (
          <span className="ml-2 font-semibold text-amber-600">
            {MAX_BODY_LENGTH - value.length} caracteres restantes
          </span>
        )}
      </p>
    </div>
  );
}
