'use client';

import { useState, useTransition } from 'react';
import { createQuickReply, deleteQuickReply, updateQuickReply } from '../inbox-actions';

interface Row {
  id: string;
  shortcut: string;
  text: string;
  updatedAt: Date;
}

export function QuickRepliesAdmin({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Form crear nuevo.
  const [shortcut, setShortcut] = useState('');
  const [text, setText] = useState('');

  // Inline edit.
  const [editId, setEditId] = useState<string | null>(null);
  const [editShortcut, setEditShortcut] = useState('');
  const [editText, setEditText] = useState('');

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createQuickReply({ shortcut: shortcut.trim(), text: text.trim() });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setRows((prev) => [
        { id: res.data.id, shortcut: shortcut.trim(), text: text.trim(), updatedAt: new Date() },
        ...prev,
      ]);
      setShortcut('');
      setText('');
    });
  }

  function startEdit(r: Row) {
    setEditId(r.id);
    setEditShortcut(r.shortcut);
    setEditText(r.text);
  }

  function cancelEdit() {
    setEditId(null);
    setError(null);
  }

  function saveEdit(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await updateQuickReply({
        id,
        shortcut: editShortcut.trim(),
        text: editText.trim(),
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, shortcut: editShortcut.trim(), text: editText.trim(), updatedAt: new Date() }
            : r,
        ),
      );
      setEditId(null);
    });
  }

  function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta respuesta rápida?')) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteQuickReply({ id });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== id));
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      <form
        onSubmit={handleCreate}
        className="rounded-xl border border-zinc-200 bg-white p-4"
      >
        <p className="mb-3 text-sm font-semibold text-zinc-900">Nueva respuesta rápida</p>
        <div className="grid gap-2 sm:grid-cols-[200px_1fr_auto]">
          <input
            type="text"
            value={shortcut}
            onChange={(e) => setShortcut(e.target.value.replace(/[^a-z0-9_-]/gi, '').slice(0, 32))}
            placeholder="atajo (ej: saludo)"
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-400 focus:outline-none"
            required
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Texto que se insertará al escribir /saludo"
            rows={2}
            maxLength={4096}
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-400 focus:outline-none"
            required
          />
          <button
            type="submit"
            disabled={pending || !shortcut.trim() || !text.trim()}
            className="self-start rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            {pending ? 'Guardando…' : 'Crear'}
          </button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-medium">Atajo</th>
              <th className="px-4 py-2 font-medium">Texto</th>
              <th className="px-4 py-2 font-medium">Actualizado</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-zinc-500">
                  No hay respuestas rápidas. Crea la primera arriba.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const editing = editId === r.id;
              return (
                <tr key={r.id}>
                  <td className="px-4 py-2 align-top font-mono text-xs text-emerald-700">
                    {editing ? (
                      <input
                        type="text"
                        value={editShortcut}
                        onChange={(e) =>
                          setEditShortcut(e.target.value.replace(/[^a-z0-9_-]/gi, '').slice(0, 32))
                        }
                        className="w-full rounded border border-zinc-200 px-2 py-1 text-xs"
                      />
                    ) : (
                      `/${r.shortcut}`
                    )}
                  </td>
                  <td className="px-4 py-2 align-top">
                    {editing ? (
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={2}
                        className="w-full rounded border border-zinc-200 px-2 py-1 text-xs"
                      />
                    ) : (
                      <span className="line-clamp-2 text-zinc-700">{r.text}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 align-top text-xs text-zinc-500">
                    {new Date(r.updatedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 align-top">
                    {editing ? (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => saveEdit(r.id)}
                          disabled={pending || !editShortcut.trim() || !editText.trim()}
                          className="rounded-lg bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="rounded-lg border border-zinc-200 px-2 py-1 text-xs"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          className="rounded-lg border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(r.id)}
                          disabled={pending}
                          className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Borrar
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
