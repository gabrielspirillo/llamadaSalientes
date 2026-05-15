'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Loader2, Phone, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

const USE_CASES = [
  { value: 'payment', label: 'Cobranza' },
  { value: 'info', label: 'Información de la clínica' },
  { value: 'reminder', label: 'Recordatorio de cita' },
  { value: 'reactivation', label: 'Reactivación de paciente' },
  { value: 'custom', label: 'Personalizada' },
] as const;

type UseCase = (typeof USE_CASES)[number]['value'];

type VarRow = { id: string; key: string; value: string };

let _varIdCounter = 0;
const nextVarId = () => `v${++_varIdCounter}`;

const SUGGESTED_BY_USE_CASE: Record<UseCase, string[]> = {
  payment: ['monto_pendiente', 'tratamiento'],
  info: [],
  reminder: ['fecha_cita', 'hora_cita', 'dentista'],
  reactivation: ['ultima_visita'],
  custom: [],
};

export function OutboundQuickCall() {
  const [toNumber, setToNumber] = useState('');
  const [patientName, setPatientName] = useState('');
  const [useCase, setUseCase] = useState<UseCase>('payment');
  const [vars, setVars] = useState<VarRow[]>(() => [
    { id: nextVarId(), key: 'monto_pendiente', value: '' },
    { id: nextVarId(), key: 'tratamiento', value: '' },
  ]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function changeUseCase(next: UseCase) {
    setUseCase(next);
    // Si el usuario no tocó las variables, pre-poblar las sugeridas
    const allEmpty = vars.every((v) => v.value.trim() === '');
    if (allEmpty) {
      const suggested = SUGGESTED_BY_USE_CASE[next];
      setVars(
        suggested.length > 0
          ? suggested.map((k) => ({ id: nextVarId(), key: k, value: '' }))
          : [{ id: nextVarId(), key: '', value: '' }],
      );
    }
  }

  function updateVar(id: string, patch: Partial<Omit<VarRow, 'id'>>) {
    setVars((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }
  function addVar() {
    setVars((vs) => [...vs, { id: nextVarId(), key: '', value: '' }]);
  }
  function removeVar(id: string) {
    setVars((vs) => vs.filter((v) => v.id !== id));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!toNumber.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const dynamicVars: Record<string, string> = {};
      for (const v of vars) {
        const k = v.key.trim();
        const val = v.value.trim();
        if (k && val) dynamicVars[k] = val;
      }
      const res = await fetch('/api/calls/outbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toNumber: toNumber.trim(),
          patientName: patientName.trim() || null,
          useCase,
          dynamicVars,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({
          ok: false,
          message: typeof body.error === 'string' ? body.error : `HTTP ${res.status}`,
        });
      } else {
        setResult({
          ok: true,
          message: `Llamada iniciada (call_id: ${body.callId}, status: ${body.status})`,
        });
      }
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : 'Error inesperado' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-6 mb-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-base font-semibold tracking-tight flex items-center gap-2">
          <Phone className="h-4 w-4 text-violet-600" /> Llamada rápida
        </h3>
      </div>
      <p className="text-sm text-zinc-500 mb-5">
        Probá una llamada 1 a 1 con tu agente outbound. Ideal para tests o callbacks puntuales sin
        crear una campaña.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="qc-phone">Teléfono (E.164)</Label>
            <Input
              id="qc-phone"
              value={toNumber}
              onChange={(e) => setToNumber(e.target.value)}
              placeholder="+5491140001234"
              required
              autoComplete="off"
            />
          </div>
          <div>
            <Label htmlFor="qc-name">Nombre del paciente (opcional)</Label>
            <Input
              id="qc-name"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              placeholder="Juan Pérez"
              autoComplete="off"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="qc-usecase">Caso de uso</Label>
          <select
            id="qc-usecase"
            value={useCase}
            onChange={(e) => changeUseCase(e.target.value as UseCase)}
            className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3.5 text-sm"
          >
            {USE_CASES.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Variables dinámicas</Label>
            <button
              type="button"
              onClick={addVar}
              className="inline-flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700"
            >
              <Plus className="h-3 w-3" /> Agregar variable
            </button>
          </div>
          <div className="space-y-2">
            {vars.map((v) => (
              <div key={v.id} className="flex items-center gap-2">
                <Input
                  value={v.key}
                  onChange={(e) => updateVar(v.id, { key: e.target.value })}
                  placeholder="nombre_variable"
                  className="flex-1 font-mono text-xs"
                />
                <span className="text-zinc-400 text-sm">=</span>
                <Input
                  value={v.value}
                  onChange={(e) => updateVar(v.id, { value: e.target.value })}
                  placeholder="valor"
                  className="flex-1 text-xs"
                />
                <button
                  type="button"
                  onClick={() => removeVar(v.id)}
                  className="text-zinc-400 hover:text-red-600"
                  title="Quitar"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-zinc-500 mt-2">
            Se inyectan al prompt del agente como{' '}
            <code className="text-[11px]">{'{{nombre_variable}}'}</code>. Vacías se ignoran.
          </p>
        </div>

        {result && (
          <div
            className={`rounded-lg border p-3 text-sm ${
              result.ok
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {result.message}
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={loading || !toNumber.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
            Llamar ahora
          </Button>
        </div>
      </form>
    </Card>
  );
}
