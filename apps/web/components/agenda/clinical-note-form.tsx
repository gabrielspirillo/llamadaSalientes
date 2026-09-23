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
import { AlertTriangle, Check, Copy, History, Loader2, NotebookPen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/** Qué campos y con qué nombres. 'PEDIATRIC' es el de las clínicas con perfil. */
export type ClinicalNoteTemplate = 'DEFAULT' | 'PEDIATRIC';

/** La nota anterior, para "partir de la anterior" y para recordarla en móvil. */
export interface PreviousNote {
  whenLabel: string;
  summary: string;
  symptoms: string | null;
  examination: string | null;
  treatmentPerformed: string | null;
  observations: string | null;
  nextSteps: string | null;
}

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
 *
 * "Partir de la anterior" copia la última nota al formulario: en una sesión de
 * seguimiento cambia poco, y reescribir la exploración entera cada 48 h es lo
 * que hacía que la historia se quedara corta.
 */
export function ClinicalNoteForm({
  patientKey,
  patientName,
  professionalId,
  appointments,
  defaultAppointmentId,
  template = 'DEFAULT',
  title = 'Nueva nota clínica',
  subtitle,
  previous = null,
}: {
  patientKey: string;
  patientName: string;
  professionalId: string;
  appointments: { id: string; label: string; professionalId: string }[];
  defaultAppointmentId?: string | null;
  template?: ClinicalNoteTemplate;
  title?: string;
  subtitle?: string;
  previous?: PreviousNote | null;
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

  function copyPrevious() {
    if (!previous) return;
    setSymptoms(previous.symptoms ?? '');
    setExamination(previous.examination ?? '');
    setTreatmentPerformed(previous.treatmentPerformed ?? '');
    setSummary(previous.summary);
    setObservations(previous.observations ?? '');
    setNextSteps(previous.nextSteps ?? '');
    setSaved(false);
  }

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

  const canSave = !pending && summary.trim().length >= 3;

  return (
    <div className="flex flex-col gap-5 p-4 md:gap-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="min-w-[200px] flex-1">
          <h2 className="text-[18px] font-bold tracking-tight text-zinc-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-zinc-500">{subtitle}</p>}
        </div>
        {previous && (
          <Button variant="soft" size="sm" onClick={copyPrevious} className="min-h-11 md:min-h-9">
            <Copy className="h-3.5 w-3.5" /> Partir de la anterior
          </Button>
        )}
      </div>

      {previous && (
        <div className="flex items-start gap-2.5 rounded-[14px] bg-brand-50 px-3.5 py-3 text-[13px] text-brand-800 lg:hidden">
          <History className="mt-px h-4 w-4 shrink-0" aria-hidden />
          <span>
            <strong>La última vez ({previous.whenLabel}):</strong> {previous.summary}
            {previous.nextSteps ? ` Próximo paso: ${previous.nextSteps}` : ''}
          </span>
        </div>
      )}

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

      <div className="grid gap-5 md:grid-cols-[repeat(auto-fit,minmax(240px,1fr))] md:gap-4">
        {pediatric && (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="cn-symptoms">Síntomas</Label>
              <Textarea
                id="cn-symptoms"
                className="min-h-[80px] text-[16px]"
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
                placeholder="Lo que cuenta la familia: tos, mocos, fiebre…"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cn-exam">Exploración</Label>
              <Textarea
                id="cn-exam"
                className="min-h-[80px] text-[16px]"
                value={examination}
                onChange={(e) => setExamination(e.target.value)}
                placeholder="Auscultación, SatO2, FR…"
              />
            </div>
          </>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor="cn-done">{pediatric ? 'Tratamiento' : 'Qué se hizo'}</Label>
          <Input
            id="cn-done"
            className="text-[16px]"
            value={treatmentPerformed}
            onChange={(e) => setTreatmentPerformed(e.target.value)}
            placeholder={pediatric ? 'Drenaje, lavado nasal…' : 'Obturación de composite en 36'}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="cn-summary">{pediatric ? 'Diagnóstico' : 'Motivo / diagnóstico'}</Label>
          <Input
            id="cn-summary"
            className="text-[16px]"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder={pediatric ? 'Bronquiolitis leve' : 'Dolor en 36, caries profunda'}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="cn-obs">Observaciones</Label>
        <Textarea
          id="cn-obs"
          className="min-h-[70px] text-[16px]"
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
          className="text-[16px]"
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
        <div className="grid gap-2">
          <Label>¿Cómo se portó en la sesión?</Label>
          <div className="grid grid-cols-3 gap-2 md:max-w-[440px]">
            {SESSION_BEHAVIORS.map((b) => (
              <button
                key={b}
                type="button"
                aria-pressed={behavior === b}
                onClick={() => setBehavior(behavior === b ? null : b)}
                className={cn(
                  'inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[14px] font-semibold ring-1 transition-colors',
                  behavior === b
                    ? 'bg-brand-600 text-white ring-brand-600'
                    : 'bg-white text-zinc-700 ring-[--color-border] hover:bg-brand-50',
                )}
              >
                <span aria-hidden className="text-[17px] leading-none">
                  {SESSION_BEHAVIOR_FACES[b]}
                </span>
                {SESSION_BEHAVIOR_LABELS[b]}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="flex min-h-11 items-center gap-2.5 text-[14px] text-zinc-600">
        <input
          type="checkbox"
          checked={isPrivate}
          onChange={(e) => setIsPrivate(e.target.checked)}
          className="h-[18px] w-[18px]"
        />
        <span>Nota privada: sólo la ve quien la escribe. Los agentes virtuales nunca la leen.</span>
      </label>

      {error && (
        <p className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <div
        className={cn(
          'sticky bottom-0 -mx-4 -mb-4 flex items-center justify-end gap-2 border-t border-[--color-border] bg-white/[.92] px-4 py-3 backdrop-blur-xl',
          'md:static md:m-0 md:bg-transparent md:px-0 md:pb-0 md:pt-3.5 md:backdrop-blur-none',
        )}
      >
        {saved && (
          <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-600">
            <Check className="h-4 w-4" /> Nota guardada
          </span>
        )}
        <Button onClick={submit} disabled={!canSave} className="h-12 w-full md:h-11 md:w-auto">
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
