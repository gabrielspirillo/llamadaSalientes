'use client';

/** Sube un comprobante a un movimiento del libro. Lanza con el mensaje del servidor. */
export async function uploadEntryFile(entryId: string, file: File, kind?: string): Promise<void> {
  const body = new FormData();
  body.set('entryId', entryId);
  if (kind) body.set('kind', kind);
  body.set('file', file);
  const res = await fetch('/api/finanzas/files', { method: 'POST', body });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? 'No se pudo subir el comprobante.');
  }
}
