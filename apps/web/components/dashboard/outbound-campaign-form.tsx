'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Loader2, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const USE_CASES = [
  { value: 'payment', label: 'Cobranza' },
  { value: 'info', label: 'Información de la clínica' },
  { value: 'reminder', label: 'Recordatorio de cita' },
  { value: 'reactivation', label: 'Reactivación de paciente' },
  { value: 'custom', label: 'Personalizada' },
] as const;

type Target = {
  toNumber: string;
  patientName: string;
  email: string;
  dynamicVars: Record<string, string>;
};

export function OutboundCampaignForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [useCase, setUseCase] = useState<(typeof USE_CASES)[number]['value']>('payment');
  const [notes, setNotes] = useState('');
  const [csvText, setCsvText] = useState('');
  const [targets, setTargets] = useState<Target[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result ?? ''));
    };
    reader.readAsText(file);
  }

  function parseCsv() {
    setParsing(true);
    setError(null);
    try {
      const parsed = parseTargetsCsv(csvText);
      if (parsed.length === 0) {
        setError('No se detectó ningún destinatario válido en el CSV.');
      }
      setTargets(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSV inválido');
    } finally {
      setParsing(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (!name.trim()) throw new Error('La campaña necesita un nombre.');
      if (targets.length === 0) throw new Error('Cargá un CSV con los destinatarios.');

      const res = await fetch('/api/outbound/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          useCase,
          notes: notes.trim() || null,
          targets: targets.map((t) => ({
            toNumber: t.toNumber,
            patientName: t.patientName || null,
            email: t.email || null,
            dynamicVars: t.dynamicVars,
          })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ? JSON.stringify(body.error) : `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { campaignId: string };
      router.push(`/dashboard/outbound/${data.campaignId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear la campaña');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Card className="p-6 space-y-4">
        <div>
          <Label htmlFor="campaign-name">Nombre</Label>
          <Input
            id="campaign-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Cobranza octubre 2026"
            required
          />
        </div>

        <div>
          <Label htmlFor="campaign-use-case">Caso de uso</Label>
          <select
            id="campaign-use-case"
            value={useCase}
            onChange={(e) => setUseCase(e.target.value as typeof useCase)}
            className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3.5 text-sm"
          >
            {USE_CASES.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-zinc-500">
            Se pasa al agente como variable dinámica <code>{'{{use_case}}'}</code> para que adapte
            el guión.
          </p>
        </div>

        <div>
          <Label htmlFor="campaign-notes">Notas internas (opcional)</Label>
          <Textarea
            id="campaign-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Contexto para tu equipo, no se manda al agente."
          />
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <div>
          <Label>Destinatarios (CSV)</Label>
          <p className="mt-1 text-xs text-zinc-500">
            Cabeceras esperadas: <code>to_number,patient_name,email</code> + cualquier variable
            dinámica adicional (ej. <code>monto_pendiente</code>, <code>fecha_cita</code>). Mínimo 1
            fila, máximo 5000.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3.5 text-sm hover:bg-zinc-50">
            <Upload className="h-4 w-4" />
            Elegir archivo
            <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
          </label>
          <Button
            type="button"
            variant="secondary"
            onClick={parseCsv}
            disabled={parsing || !csvText}
          >
            {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Validar CSV
          </Button>
        </div>

        <Textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder="to_number,patient_name,monto_pendiente&#10;+5491140001234,Juan Pérez,12500"
          className="font-mono text-xs"
        />

        {targets.length > 0 && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            ✓ {targets.length} destinatario{targets.length === 1 ? '' : 's'} listo
            {targets.length === 1 ? '' : 's'} para llamar.
            <div className="mt-2 text-xs text-emerald-900/70">
              Variables detectadas:{' '}
              {Array.from(new Set(targets.flatMap((t) => Object.keys(t.dynamicVars))))
                .slice(0, 8)
                .map((k) => `{{${k}}}`)
                .join(', ') || '—'}
            </div>
          </div>
        )}
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={submitting || targets.length === 0}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Crear campaña
        </Button>
      </div>
    </form>
  );
}

// CSV mínimo: split por líneas, separador coma, primera línea es header.
// Soporta valores entrecomillados simples.
function parseTargetsCsv(text: string): Target[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const headerLine = lines[0] ?? '';
  const header = splitCsvLine(headerLine).map((h) => h.trim().toLowerCase());
  const phoneIdx = header.indexOf('to_number');
  if (phoneIdx === -1) {
    throw new Error('Falta la columna to_number en el CSV.');
  }
  const nameIdx = header.indexOf('patient_name');
  const emailIdx = header.indexOf('email');

  const reservedIdx = new Set([phoneIdx, nameIdx, emailIdx].filter((i) => i !== -1));

  const out: Target[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cells = splitCsvLine(line);
    const phone = cells[phoneIdx]?.trim();
    if (!phone) continue;
    const dynamicVars: Record<string, string> = {};
    header.forEach((key, idx) => {
      if (reservedIdx.has(idx)) return;
      const v = cells[idx]?.trim();
      if (v) dynamicVars[key] = v;
    });
    out.push({
      toNumber: phone,
      patientName: nameIdx === -1 ? '' : (cells[nameIdx]?.trim() ?? ''),
      email: emailIdx === -1 ? '' : (cells[emailIdx]?.trim() ?? ''),
      dynamicVars,
    });
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}
