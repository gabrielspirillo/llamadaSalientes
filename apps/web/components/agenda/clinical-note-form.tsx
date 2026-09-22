'use client';

import { saveClinicalNoteAction } from '@/app/(dashboard)/dashboard/agenda/actions';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import {
  SESSION_BEHAVIORS,
  SESSION_BEHAVIOR_FACES,
  SESSION_BEHAVIOR_LABELS,
  type SessionBehavior,
} from '@/lib/care-profile/policy';
import { cn } from '@/lib/cn';
import { AlertTriangle, Check, Loader2, NotebookPen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/** Qué campos y con qué nombres. 'PEDIATRIC' es el de las clínicas con perfil. */
export type ClinicalNoteTemplate = 'DEFAULT' | 'PEDIATRIC';

/**
 * Nota clínica: lo que el profesional escribe DESPUÉS de atender.
 *
 * Se ata a la cita cuando la hay, pero puede ir suelta: una urgencia sin cita
 * previa también tiene que poder registrarse.
 *
 * Con plantilla pediátrica la visita se cuenta en el orden en que ocurre:
 * síntomas que trae la familia, exploración, tratamiento, diagnóstico,
 * observaciones y cómo se portó. Las columnas de base son las mismas; cambian
 * los campos que se enseñan y cómo se llaman.
 */
export function ClinicalNoteForm({
  patientKey,
  patientName,
  professionalId,
  appointments,
  defaultAppointmentId,
  template = 'DEFAULT',
}: {
  patientKey: string;
  patientName: string;
  professionalId: string;
  appointments: { id: string; label: string; professionalId: string }[];
  defaultAppointmentId?: string | null;
  template?: ClinicalNoteTemplate;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const pediatric = template === 'PEDIATRIC';

  const [appointmentId, setAppointmentId] = React.useState(defaultAppointmentId ?? '');
  const [symptoms, setSymptoms] = React.useState('');
  const [examination, setExamination] = React.useState('');
  const [summary, setSummary] = React.useState('');
  const [treatmentPerformed, setTreatmentPerformed] = React.useState('');
  const [observations, setObservations] = React.useState('');
  const [nextSteps, setNextSteps] = React.useState('');
  const [behavior, setBehavior] = React.useState<SessionBehavior | null>(null);
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
        symptoms: pediatric ? symptoms : '',
        examination: pediatric ? examination : '',
        sessionBehavior: pediatric ? behavior : null,
        private: isPrivate,
      });
      if (result.ok) {
        setSaved(true);
        setSymptoms('');
        setExamination('');
        setSummary('');
        setTreatmentPerformed('');
        setObservations('');
        setNextSteps('');
        setBehavior(null);
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

      {pediatric && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="cn-symptoms">Síntomas</Label>
            <Textarea
              id="cn-symptoms"
              className="min-h-[70px]"
              value={symptoms}
              onChange={(e) => setSymptoms(e.target.value)}
              placeholder="Lo que cuenta la familia: tos, mocos, fiebre, desde cuándo…"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cn-exam">Exploración</Label>
            <Textarea
              id="cn-exam"
              className="min-h-[70px]"
              value={examination}
              onChange={(e) => setExamination(e.target.value)}
              placeholder="Auscultación, saturación, frecuencia respiratoria…"
            />
          </div>
        </>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="cn-done">{pediatric ? 'Tratamiento' : 'Qué se hizo'}</Label>
        <Input
          id="cn-done"
          value={treatmentPerformed}
          onChange={(e) => setTreatmentPerformed(e.target.value)}
          placeholder={
            pediatric
              ? 'Drenaje, lavado nasal, técnicas espiratorias…'
              : 'Obturación de composite en 36'
          }
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="cn-summary">{pediatric ? 'Diagnóstico' : 'Motivo / diagnóstico'}</Label>
        <Input
          id="cn-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder={pediatric ? 'Bronquiolitis leve' : 'Dolor en 36, caries profunda'}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="cn-obs">Observaciones</Label>
        <Textarea
          id="cn-obs"
          className="min-h-[90px]"
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
          placeholder={
            pediatric
              ? 'Tolerancia, vómitos, indicaciones a la familia…'
              : 'Anestesia, hallazgos, material, incidencias…'
          }
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="cn-next">Próximo paso</Label>
        <Input
          id="cn-next"
          value={nextSteps}
          onChange={(e) => setNextSteps(e.target.value)}
          placeholder={
            pediatric
              ? 'Nueva sesión en 48 h; lavados en casa'
              : 'Revisión en 6 meses; presupuestar endodoncia'
          }
        />
        <p className="text-[12px] text-zinc-500">
          Esto es lo que recepción y los agentes virtuales pueden usar para el seguimiento.
        </p>
      </div>

      {pediatric && (
        <div className="grid gap-1.5">
          <Label>¿Cómo se portó en la sesión?</Label>
          <div className="flex flex-wrap gap-2">
            {SESSION_BEHAVIORS.map((b) => (
              <button
                key={b}
                type="button"
                aria-pressed={behavior === b}
                onClick={() => setBehavior(behavior === b ? null : b)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold ring-1 transition-colors',
                  behavior === b
                    ? 'bg-brand-600 text-white ring-brand-600'
                    : 'bg-white text-zinc-700 ring-[--color-border] hover:bg-brand-50',
                )}
              >
                <span aria-hidden className="text-base leading-none">
                  {SESSION_BEHAVIOR_FACES[b]}
                </span>
                {SESSION_BEHAVIOR_LABELS[b]}
              </button>
            ))}
          </div>
        </div>
      )}

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
