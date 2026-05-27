'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { sendManualMessage } from '../actions';
import { addInternalNote, searchQuickReplies, sendMediaMessage } from '../inbox-actions';

interface Props {
  conversationId: string;
  disabled?: boolean;
}

type Mode = 'reply' | 'note';

interface QuickReply {
  id: string;
  shortcut: string;
  text: string;
}

const EMOJIS = [
  '😀','😁','😂','🤣','😊','😍','😘','😎','😉','🙂',
  '🙃','😇','🥰','😋','😌','😏','😴','🤔','🤗','🤩',
  '😢','😭','😡','😱','😳','😬','🤐','🤫','🙄','😴',
  '👍','👎','👏','🙏','💪','👋','🤝','✌️','🤞','🤟',
  '❤️','💔','💕','💖','💯','🔥','✨','⭐','🎉','🎊',
  '✅','❌','⚠️','📌','📍','📞','📱','💬','📧','📅',
];

function generateNonce(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function MessageComposer({ conversationId, disabled }: Props) {
  const [mode, setMode] = useState<Mode>('reply');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Slash command popup state.
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashResults, setSlashResults] = useState<QuickReply[]>([]);
  const [slashIndex, setSlashIndex] = useState(0);

  // Emoji picker.
  const [emojiOpen, setEmojiOpen] = useState(false);

  // Audio recording.
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Buscar respuestas rápidas cuando hay query "/".
  useEffect(() => {
    if (!slashOpen) return;
    let cancelled = false;
    void (async () => {
      const res = await searchQuickReplies(slashQuery);
      if (cancelled) return;
      if (res.success) {
        setSlashResults(res.data);
        setSlashIndex(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slashOpen, slashQuery]);

  // Detectar "/" al inicio para abrir el popup.
  function handleTextChange(value: string) {
    setText(value);
    if (mode === 'reply' && value.startsWith('/')) {
      setSlashOpen(true);
      setSlashQuery(value.slice(1));
    } else {
      setSlashOpen(false);
    }
  }

  function applyQuickReply(qr: QuickReply) {
    setText(qr.text);
    setSlashOpen(false);
    textareaRef.current?.focus();
  }

  function insertEmoji(emoji: string) {
    const ta = textareaRef.current;
    if (!ta) {
      setText((prev) => prev + emoji);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    // Reposicionar caret tras inserción.
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  function submitText() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const res =
        mode === 'note'
          ? await addInternalNote({ conversationId, text: trimmed })
          : await sendManualMessage({
              conversationId,
              text: trimmed,
              clientNonce: generateNonce(),
              takeoverHours: 2,
            });
      if (res.success) {
        setText('');
      } else {
        setError(res.error);
      }
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (slashOpen && slashResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, slashResults.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        applyQuickReply(slashResults[slashIndex]!);
        return;
      }
      if (e.key === 'Escape') {
        setSlashOpen(false);
        return;
      }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submitText();
    }
  }

  // Subida de archivo (imagen / documento / video).
  async function onFileSelected(file: File) {
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.append('conversationId', conversationId);
    fd.append('file', file);
    if (text.trim()) fd.append('caption', text.trim());
    startTransition(async () => {
      const res = await sendMediaMessage(fd);
      if (res.success) {
        setText('');
      } else {
        setError(res.error);
      }
    });
  }

  // Audio recording (MediaRecorder API).
  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mr = new MediaRecorder(stream, { mimeType: pickAudioMime() });
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType });
        setAudioBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (err) {
      setError(`No se pudo iniciar la grabación: ${(err as Error).message}`);
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  function discardAudio() {
    setAudioBlob(null);
  }

  async function sendAudio() {
    if (!audioBlob) return;
    setError(null);
    let blobToSend = audioBlob;
    let mime = audioBlob.type;
    let ext = 'mp3';

    if (mime.startsWith('audio/ogg')) {
      ext = 'ogg';
    } else if (!mime.startsWith('audio/mpeg')) {
      try {
        setError('Convirtiendo audio a MP3…');
        const { encodeBlobToMp3 } = await import('./audio-encode');
        blobToSend = await encodeBlobToMp3(audioBlob);
        mime = 'audio/mpeg';
        ext = 'mp3';
        setError(null);
      } catch (err) {
        setError(`No se pudo convertir el audio: ${(err as Error).message}`);
        return;
      }
    }

    const file = new File([blobToSend], `audio-${Date.now()}.${ext}`, { type: mime });
    onFileSelected(file);
    setAudioBlob(null);
  }

  const isNote = mode === 'note';
  const placeholderBase = disabled
    ? 'Conversación cerrada — no se pueden enviar mensajes'
    : isNote
      ? 'Escribe una nota interna (no se envía al contacto)…'
      : 'Escribe un mensaje. Usa "/" para respuestas rápidas.';

  return (
    <div className="relative rounded-xl border border-zinc-200 bg-white">
      {error && (
        <div className="border-b border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-100 px-2 pt-2">
        <button
          type="button"
          onClick={() => setMode('reply')}
          className={`rounded-t-md px-3 py-1.5 text-xs font-medium ${
            mode === 'reply'
              ? 'border-b-2 border-emerald-500 text-emerald-700'
              : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          Responder
        </button>
        <button
          type="button"
          onClick={() => setMode('note')}
          className={`rounded-t-md px-3 py-1.5 text-xs font-medium ${
            mode === 'note'
              ? 'border-b-2 border-amber-500 text-amber-700'
              : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          Nota interna
        </button>
      </div>

      {/* Slash command popup */}
      {slashOpen && slashResults.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 z-20 mb-1 max-h-60 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg">
          <p className="border-b border-zinc-100 px-3 py-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
            Respuestas rápidas · ↑↓ para navegar, Enter para usar
          </p>
          <ul>
            {slashResults.map((qr, i) => (
              <li key={qr.id}>
                <button
                  type="button"
                  onClick={() => applyQuickReply(qr)}
                  className={`block w-full px-3 py-2 text-left text-sm ${
                    i === slashIndex ? 'bg-emerald-50' : 'hover:bg-zinc-50'
                  }`}
                >
                  <div className="font-mono text-xs text-emerald-700">/{qr.shortcut}</div>
                  <div className="truncate text-xs text-zinc-600">{qr.text}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Audio preview */}
      {audioBlob && (
        <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50 px-3 py-2">
          <audio src={URL.createObjectURL(audioBlob)} controls className="h-8 flex-1" />
          <button
            type="button"
            onClick={discardAudio}
            className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs hover:bg-zinc-50"
          >
            Descartar
          </button>
          <button
            type="button"
            onClick={sendAudio}
            disabled={pending}
            className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? 'Enviando…' : 'Enviar audio'}
          </button>
        </div>
      )}

      {/* Textarea + controls */}
      <div className={`px-3 py-2 ${isNote ? 'bg-amber-50/40' : ''}`}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          placeholder={placeholderBase}
          disabled={disabled || pending}
          rows={2}
          onKeyDown={onKeyDown}
          className={`w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none disabled:bg-zinc-50 ${
            isNote
              ? 'border-amber-200 bg-amber-50 focus:border-amber-400'
              : 'border-zinc-200 bg-white focus:border-zinc-400'
          }`}
        />

        <div className="mt-2 flex items-center gap-1">
          {/* Emoji */}
          <button
            type="button"
            onClick={() => setEmojiOpen((v) => !v)}
            disabled={disabled || pending}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50"
            title="Emoji"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
          </button>

          {/* Adjuntar archivo (imagen/documento/video) */}
          {!isNote && (
            <>
              <label
                className={`rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 ${
                  disabled || pending ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                }`}
                title="Adjuntar archivo"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.49" />
                </svg>
                <input
                  type="file"
                  className="hidden"
                  disabled={disabled || pending}
                  accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onFileSelected(f);
                    e.currentTarget.value = '';
                  }}
                />
              </label>

              {/* Grabar audio */}
              {!recording ? (
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={disabled || pending}
                  className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50"
                  title="Grabar audio"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                    <path d="M19 10v2a7 7 0 01-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                >
                  <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                  Detener
                </button>
              )}
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] text-zinc-400">
              {isNote ? 'Solo visible para tu equipo' : 'Ctrl+Enter para enviar'}
            </span>
            <button
              type="button"
              onClick={submitText}
              disabled={disabled || pending || !text.trim()}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300 ${
                isNote ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {pending ? 'Enviando…' : isNote ? 'Guardar nota' : 'Enviar'}
            </button>
          </div>
        </div>
      </div>

      {/* Emoji popover */}
      {emojiOpen && (
        <div className="absolute bottom-full left-3 z-20 mb-1 grid w-72 grid-cols-10 gap-1 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                insertEmoji(e);
                setEmojiOpen(false);
              }}
              className="rounded p-1 text-lg hover:bg-zinc-100"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function pickAudioMime(): string {
  // ORDEN IMPORTANTE: preferimos formatos que WhatsApp acepta nativamente
  // para evitar transcodificación cliente. Firefox da ogg/opus, Safari da
  // mp4. Chrome/Edge solo soporta webm → transcodificamos a mp3 al enviar.
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const candidates = [
    'audio/ogg;codecs=opus', // Firefox — aceptado por WhatsApp ✅
    'audio/mp4', // Safari — aceptado por WhatsApp ✅
    'audio/webm;codecs=opus', // Chrome/Edge — necesita transcode a mp3
    'audio/webm',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'audio/webm';
}
