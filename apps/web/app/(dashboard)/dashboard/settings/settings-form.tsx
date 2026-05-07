'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Loader2, Save } from 'lucide-react';
import { useState, useTransition } from 'react';
import { type ActionResult, updateClinicSettingsAction } from './actions';

type DayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
type Hours = { open: string; close: string } | null;
type WorkingHours = Record<DayKey, Hours>;

const DAYS: { key: DayKey; label: string }[] = [
  { key: 'monday', label: 'Lunes' },
  { key: 'tuesday', label: 'Martes' },
  { key: 'wednesday', label: 'Miércoles' },
  { key: 'thursday', label: 'Jueves' },
  { key: 'friday', label: 'Viernes' },
  { key: 'saturday', label: 'Sábado' },
  { key: 'sunday', label: 'Domingo' },
];

type Settings = {
  address: string | null;
  phones: string[] | null;
  timezone: string;
  defaultLanguage: string;
  afterHoursMessage: string | null;
  recordingConsentText: string;
  workingHours: WorkingHours | null;
};

const DEFAULT_HOURS: WorkingHours = {
  monday: { open: '09:00', close: '19:00' },
  tuesday: { open: '09:00', close: '19:00' },
  wednesday: { open: '09:00', close: '19:00' },
  thursday: { open: '09:00', close: '19:00' },
  friday: { open: '09:00', close: '19:00' },
  saturday: { open: '10:00', close: '14:00' },
  sunday: null,
};

export function SettingsForm({
  initial,
  ghlSlot,
}: {
  initial: Settings;
  ghlSlot: React.ReactNode;
}) {
  const [hours, setHours] = useState<WorkingHours>(initial.workingHours ?? DEFAULT_HOURS);
  const [phones, setPhones] = useState<string[]>(initial.phones ?? []);
  const [phoneDraft, setPhoneDraft] = useState('');
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null);

  function toggleDay(day: DayKey) {
    setHours((prev) => ({
      ...prev,
      [day]: prev[day] === null ? { open: '09:00', close: '19:00' } : null,
    }));
  }

  function setDayHours(day: DayKey, field: 'open' | 'close', value: string) {
    setHours((prev) => {
      const current = prev[day];
      if (!current) return prev;
      return { ...prev, [day]: { ...current, [field]: value } };
    });
  }

  function addPhone() {
    const trimmed = phoneDraft.trim();
    if (trimmed && !phones.includes(trimmed)) {
      setPhones([...phones, trimmed]);
      setPhoneDraft('');
    }
  }

  function removePhone(p: string) {
    setPhones(phones.filter((x) => x !== p));
  }

  function handleSubmit(formData: FormData) {
    setFeedback(null);
    const payload = {
      address: (formData.get('address') as string) || null,
      phones,
      timezone: formData.get('timezone') as string,
      defaultLanguage: formData.get('defaultLanguage') as string,
      afterHoursMessage: (formData.get('afterHoursMessage') as string) || null,
      recordingConsentText: formData.get('recordingConsentText') as string,
      workingHours: hours,
    };
    startTransition(async () => {
      const r: ActionResult = await updateClinicSettingsAction(payload);
      setFeedback(
        r.ok
          ? { kind: 'ok', msg: 'Cambios guardados correctamente' }
          : { kind: 'error', msg: r.error },
      );
    });
  }

  return (
    <form action={handleSubmit}>
      <div className="flex justify-end mb-6">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Guardar cambios
        </Button>
      </div>

      {feedback && (
        <div
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
            feedback.kind === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <div className="p-6 space-y-5">
              <h3 className="text-base font-semibold tracking-tight">Información general</h3>

              <div>
                <Label htmlFor="address">Dirección</Label>
                <Input
                  id="address"
                  name="address"
                  defaultValue={initial.address ?? ''}
                  placeholder="Av. Reforma 123, Col. Centro, CDMX"
                  className="mt-2"
                />
              </div>

              <div>
                <Label>Teléfonos de contacto</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {phones.map((p) => (
                    <span
                      key={p}
                      className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-sm"
                    >
                      {p}
                      <button
                        type="button"
                        onClick={() => removePhone(p)}
                        className="text-zinc-400 hover:text-zinc-700"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <Input
                    value={phoneDraft}
                    onChange={(e) => setPhoneDraft(e.target.value)}
                    placeholder="+52 555 100 2000"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addPhone();
                      }
                    }}
                  />
                  <Button type="button" variant="secondary" onClick={addPhone}>
                    Agregar
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="timezone">Zona horaria</Label>
                  <Input
                    id="timezone"
                    name="timezone"
                    required
                    defaultValue={initial.timezone}
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label htmlFor="defaultLanguage">Idioma del agente</Label>
                  <select
                    id="defaultLanguage"
                    name="defaultLanguage"
                    defaultValue={initial.defaultLanguage}
                    className="mt-2 flex h-10 w-full rounded-xl border border-zinc-200 bg-white px-3.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/15"
                  >
                    <option value="es">Español</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>

              <div>
                <Label htmlFor="afterHoursMessage">Mensaje fuera de horario</Label>
                <Textarea
                  id="afterHoursMessage"
                  name="afterHoursMessage"
                  defaultValue={initial.afterHoursMessage ?? ''}
                  className="mt-2"
                  placeholder="Gracias por llamar. Estamos cerrados…"
                />
              </div>
            </div>
          </Card>

          <Card>
            <div className="p-6">
              <h3 className="text-base font-semibold tracking-tight mb-4">Horarios de atención</h3>
              <div className="space-y-2">
                {DAYS.map((d) => {
                  const h = hours[d.key];
                  return (
                    <div key={d.key} className="flex items-center gap-4">
                      <input
                        type="checkbox"
                        checked={h !== null}
                        onChange={() => toggleDay(d.key)}
                        className="h-4 w-4 rounded border-zinc-300"
                        id={`day-${d.key}`}
                      />
                      <label
                        htmlFor={`day-${d.key}`}
                        className="w-24 text-sm font-medium cursor-pointer"
                      >
                        {d.label}
                      </label>
                      {h ? (
                        <>
                          <Input
                            type="time"
                            value={h.open}
                            onChange={(e) => setDayHours(d.key, 'open', e.target.value)}
                            className="w-32"
                          />
                          <span className="text-zinc-400 text-sm">a</span>
                          <Input
                            type="time"
                            value={h.close}
                            onChange={(e) => setDayHours(d.key, 'close', e.target.value)}
                            className="w-32"
                          />
                        </>
                      ) : (
                        <span className="text-sm text-zinc-400">Cerrado</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>

          <Card>
            <div className="p-6">
              <h3 className="text-base font-semibold tracking-tight">Texto de consentimiento</h3>
              <p className="text-sm text-zinc-500 mt-1 mb-4">
                Lo que el agente dice <span className="font-medium">verbatim</span> al inicio de
                cada llamada (compliance de grabación).
              </p>
              <Textarea
                name="recordingConsentText"
                required
                defaultValue={initial.recordingConsentText}
                className="min-h-[100px]"
              />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          {ghlSlot}

          <Card>
            <div className="p-6">
              <h3 className="text-base font-semibold tracking-tight">Tips</h3>
              <ul className="mt-3 space-y-2 text-sm text-zinc-600">
                <li>• La zona horaria afecta cómo el agente lee horarios al paciente.</li>
                <li>
                  • El mensaje de consentimiento es <span className="font-medium">obligatorio</span>{' '}
                  por compliance.
                </li>
                <li>• Podés tener múltiples teléfonos de contacto.</li>
              </ul>
            </div>
          </Card>
        </div>
      </div>
    </form>
  );
}
