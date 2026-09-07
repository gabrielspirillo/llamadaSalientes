'use client';

import { saveClinicalNoteAction } from '@/app/(dashboard)/dashboard/agenda/actions';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { AlertTriangle, Check, Loader2, NotebookPen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/**
 * Nota clínica: lo que el profesional escribe DESPUÉS de atender.
 *
 * Se ata a la cita cuando la hay, pero puede ir suelta: una urgencia sin cita
 * previa también tiene que poder registrarse.
 */
export function ClinicalNoteForm({
  patientKey,
  patientName,
  professionalId,
  appointments,
  defaultAppointmentId,
}: {
  patientKey: string;
  patientName: string;
  professionalId: string;
  appointments: { id: string; label: string; professionalId: string }[];
  defaultAppointmentId?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const [appointmentId, setAppointmentId] = React.useState(defaultAppointmentId ?? '');
  const [summary, setSummary] = React.useState('');
  const [treatmentPerformed, setTreatmentPerformed] = React.useState('');
  const [observations, setObservations] = React.useState('');
  const [nextSteps, setNextSteps] = React.useState('');
  const [isPrivate, setIsPrivate] = React.useState(false);

  function submit() {
    setError(null);
    setSaved(false);
    // La nota se guarda contra el profesional de la cita elegida: si no, una
    // nota de la Dra. Ruiz podría acabar firmada por quien la teclea.
    const linked = appointments.find((a) => a.id === appointmentId);
    startTransition(async () => {
      const result = await saveClinicalNoteAction({
        appointmentId: appointmentId || null,
        professionalId: linked?.professionalId ?? professionalId,
        patientKey,
        patientName,
        summary,
        treatmentPerformed,
        observations,
        nextSteps,
        private: isPrivate,
      });
      if (result.ok) {
        setSaved(true);
        setSummary('');
        setTreatmentPerformed('');
        setObservations('');
        setNextSteps('');
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="grid gap-4">
      {appointments.length > 0 && (
        <div className="grid gap-1.5">
          <Label htmlFor="cn-appt">Cita relacionada</Label>
          <Select
            id="cn-appt"
            value={appointmentId}
            onChange={(e) => setAppointmentId(e.target.value)}
          >
            <option value="">Sin cita (urgencia o consulta suelta)</option>
            {appointments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="cn-summary">Motivo / diagnóstico</Label>
        <Input
          id="cn-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Dolor en 36, caries profunda"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="cn-done">Qué se hizo</Label>
        <Input
          id="cn-done"
          value={treatmentPerformed}
          onChange={(e) => setTreatmentPerformed(e.target.value)}
          placeholder="Obturación de composite en 36"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="cn-obs">Observaciones</Label>
        <Textarea
          id="cn-obs"
          className="min-h-[90px]"
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
          placeholder="Anestesia, hallazgos, material, incidencias…"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="cn-next">Próximo paso</Label>
        <Input
          id="cn-next"
          value={nextSteps}
          onChange={(e) => setNextSteps(e.target.value)}
          placeholder="Revisión en 6 meses; presupuestar endodoncia"
        />
        <p className="text-[12px] text-zinc-500">
          Esto es lo que recepción y los agentes virtuales pueden usar para el seguimiento.
        </p>
      </div>

      <label className="flex items-start gap-2 text-[13px] text-zinc-600">
        <input
          type="checkbox"
          checked={isPrivate}
          onChange={(e) => setIsPrivate(e.target.checked)}
          className="mt-0.5"
        />
        <span>Nota privada: sólo la ve quien la escribe. Los agentes virtuales nunca la leen.</span>
      </label>

      {error && (
        <p className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        {saved && (
          <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-600">
            <Check className="h-4 w-4" /> Nota guardada
          </span>
        )}
        <Button onClick={submit} disabled={pending || summary.trim().length < 3}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <NotebookPen className="h-4 w-4" />
          )}
          Guardar nota
        </Button>
      </div>
    </div>
  );
}
