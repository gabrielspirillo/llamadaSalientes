'use client';

import {
  createPatientAction,
  updatePatientAction,
} from '@/app/(dashboard)/dashboard/agenda/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import {
  GUARDIAN_ROLES,
  GUARDIAN_ROLE_LABELS,
  type Guardian,
  type GuardianRole,
} from '@/lib/care-profile/policy';
import { AlertTriangle, Baby, Loader2, Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

export interface PatientDialogValues {
  id: string;
  firstName: string;
  lastName: string | null;
  birthDate: string | null;
  guardians: Guardian[];
  contactPhone: string | null;
  contactName: string | null;
  notes: string | null;
}

const DEFAULT_GUARDIANS: Guardian[] = [
  { role: 'MADRE', name: '' },
  { role: 'PADRE', name: '' },
];

/**
 * Alta y edición del paciente como persona (clínicas con perfil).
 *
 * El niño no es el contacto: se le pide su nombre y su fecha de nacimiento, y
 * aparte el teléfono del tutor —que es a quien se llama y a quien se le manda
 * el recordatorio— y quiénes son mamá y papá. Cada uno de los dos huecos de
 * tutor admite "No hay": una familia monomarental o un caso especial no puede
 * obligar a inventarse un nombre.
 */
export function PatientDialog({
  mode,
  patient,
  trigger,
}: {
  mode: 'create' | 'edit';
  patient?: PatientDialogValues;
  /** Botón que abre el diálogo. Si no se da, uno por defecto según el modo. */
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const [firstName, setFirstName] = React.useState(patient?.firstName ?? '');
  const [lastName, setLastName] = React.useState(patient?.lastName ?? '');
  const [birthDate, setBirthDate] = React.useState(patient?.birthDate ?? '');
  const [contactPhone, setContactPhone] = React.useState(patient?.contactPhone ?? '');
  const [contactName, setContactName] = React.useState(patient?.contactName ?? '');
  const [notes, setNotes] = React.useState(patient?.notes ?? '');
  const [guardians, setGuardians] = React.useState<Guardian[]>(
    patient?.guardians?.length ? padGuardians(patient.guardians) : DEFAULT_GUARDIANS,
  );

  function setGuardian(index: number, patch: Partial<Guardian>) {
    setGuardians((prev) =>
      prev.map((g, i) => {
        if (i !== index) return g;
        const next = { ...g, ...patch };
        if (next.role === 'NINGUNO') next.name = '';
        return next;
      }),
    );
  }

  function submit() {
    setError(null);
    const input = {
      firstName,
      lastName,
      birthDate: birthDate || null,
      guardians,
      contactPhone,
      contactName,
      notes,
    };
    startTransition(async () => {
      if (mode === 'edit' && patient) {
        const result = await updatePatientAction(patient.id, input);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setOpen(false);
        router.refresh();
        return;
      }
      const result = await createPatientAction(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      // Recién creado, lo natural es seguir en su ficha: anamnesis y primera cita.
      router.push(`/dashboard/agenda/pacientes/${encodeURIComponent(`pat:${result.data.id}`)}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant={mode === 'create' ? 'primary' : 'secondary'} size="sm">
            {mode === 'create' ? <Baby className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            {mode === 'create' ? 'Nuevo paciente' : 'Editar datos'}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Nuevo paciente' : 'Datos del paciente'}</DialogTitle>
          <DialogDescription>
            El paciente es el niño o la niña. El teléfono es el del tutor: a ese número se le
            recuerda la cita.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="pt-first">Nombre</Label>
              <Input
                id="pt-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Martina"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pt-last">Apellidos</Label>
              <Input
                id="pt-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Ruiz Gómez"
              />
            </div>
          </div>

          <div className="grid gap-1.5 sm:max-w-[220px]">
            <Label htmlFor="pt-birth">Fecha de nacimiento</Label>
            <Input
              id="pt-birth"
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
            />
            <p className="text-[12px] text-zinc-500">
              Con ella la agenda y la ficha enseñan la edad con número.
            </p>
          </div>

          <div className="grid gap-2">
            <Label>Madre y padre</Label>
            {guardians.map((g, i) => (
              <div key={`g-${i.toString()}`} className="grid gap-2 sm:grid-cols-[150px_1fr]">
                <Select
                  aria-label={`Tutor ${i + 1}: relación`}
                  value={g.role}
                  onChange={(e) => setGuardian(i, { role: e.target.value as GuardianRole })}
                >
                  {GUARDIAN_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {GUARDIAN_ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label={`Tutor ${i + 1}: nombre`}
                  value={g.name}
                  disabled={g.role === 'NINGUNO'}
                  onChange={(e) => setGuardian(i, { name: e.target.value })}
                  placeholder={g.role === 'NINGUNO' ? '—' : 'Nombre'}
                />
              </div>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="pt-phone">Teléfono del tutor</Label>
              <Input
                id="pt-phone"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="+34 600 000 000"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pt-contact">Titular del teléfono</Label>
              <Input
                id="pt-contact"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Quien llama"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="pt-notes">Notas</Label>
            <Textarea
              id="pt-notes"
              className="min-h-[70px]"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Avisos para el equipo"
            />
          </div>

          {error && (
            <p className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </p>
          )}
        </div>

        <DialogFooter className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !firstName.trim()}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Baby className="h-4 w-4" />}
            {mode === 'create' ? 'Crear paciente' : 'Guardar cambios'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Siempre dos huecos en el formulario, aunque se guardara uno solo. */
function padGuardians(list: Guardian[]): Guardian[] {
  const out = list.slice(0, 2).map((g) => ({ role: g.role, name: g.name ?? '' }));
  while (out.length < 2) out.push({ role: 'NINGUNO', name: '' });
  return out;
}
