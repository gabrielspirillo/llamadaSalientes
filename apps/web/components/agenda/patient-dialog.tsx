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
  type AnamnesisAnswers,
  type AnamnesisItem,
  CONTACT_CHANNELS,
  CONTACT_CHANNEL_LABELS,
  GUARDIAN_ROLES,
  GUARDIAN_ROLE_LABELS,
  type Guardian,
  type GuardianRole,
  describeAge,
} from '@/lib/care-profile/policy';
import { cn } from '@/lib/cn';
import { AlertTriangle, Baby, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
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

/** Relaciones que se ofrecen en el desplegable: "No hay" ya no es una opción, se quita la fila. */
const RELATIONS = GUARDIAN_ROLES.filter((r) => r !== 'NINGUNO') as Exclude<
  GuardianRole,
  'NINGUNO'
>[];

const MAX_GUARDIANS = 4;

function emptyGuardian(role: GuardianRole = 'MADRE'): Guardian {
  return { role, name: '', phone: '', email: '', channel: null, primary: false };
}

/**
 * Los tutores como llegan de la ficha, listos para el formulario: sin las
 * filas "No hay", con las claves nuevas puestas y, si ninguno tiene el
 * teléfono de contacto (datos de antes), colgándoselo al titular que se
 * deduce del nombre o de la relación que decía el texto libre de antes.
 */
function seedGuardians(values?: PatientDialogValues): Guardian[] {
  const base: Guardian[] = (values?.guardians ?? [])
    .filter((g) => g.role !== 'NINGUNO')
    .map((g) => ({
      role: g.role,
      name: g.name ?? '',
      phone: g.phone ?? '',
      email: g.email ?? '',
      channel: g.channel ?? null,
      primary: Boolean(g.primary),
    }));
  if (base.length === 0) base.push(emptyGuardian('MADRE'), emptyGuardian('PADRE'));

  const phone = values?.contactPhone?.trim() ?? '';
  if (phone && !base.some((g) => g.primary) && !base.some((g) => g.phone)) {
    const holder = (values?.contactName ?? '').trim().toLocaleLowerCase('es');
    const byName = base.find((g) => g.name.trim().toLocaleLowerCase('es') === holder && holder);
    const byRole = base.find(
      (g) => GUARDIAN_ROLE_LABELS[g.role].toLocaleLowerCase('es') === holder && holder,
    );
    const target = byName ?? byRole ?? base[0];
    if (target) {
      target.phone = phone;
      target.primary = true;
    }
  }
  return base;
}

/**
 * Alta y edición del paciente como persona (clínicas con perfil).
 *
 * El niño no es el contacto: se le pide su nombre y su fecha de nacimiento, y
 * aparte quiénes son sus tutores —madre, padre, abuela, tutor legal—, cómo se
 * localiza a cada uno y cuál es el titular del teléfono de la ficha: a ése se
 * le llama, se le escribe y se le manda el consentimiento. Las alertas
 * clínicas (los ítems de la anamnesis marcados como alerta) también se
 * editan desde aquí, para que lo que sale en la cabecera se corrija donde se
 * corrige el resto.
 */
export function PatientDialog({
  mode,
  patient,
  trigger,
  alertItems = [],
  answers = {},
}: {
  mode: 'create' | 'edit';
  patient?: PatientDialogValues;
  /** Botón que abre el diálogo. Si no se da, uno por defecto según el modo. */
  trigger?: React.ReactNode;
  /** Ítems de la anamnesis con `alert`: se editan aquí como "alertas clínicas". */
  alertItems?: AnamnesisItem[];
  answers?: AnamnesisAnswers;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const [firstName, setFirstName] = React.useState(patient?.firstName ?? '');
  const [lastName, setLastName] = React.useState(patient?.lastName ?? '');
  const [birthDate, setBirthDate] = React.useState(patient?.birthDate ?? '');
  const [notes, setNotes] = React.useState(patient?.notes ?? '');
  const [guardians, setGuardians] = React.useState<Guardian[]>(() => seedGuardians(patient));
  const [alerts, setAlerts] = React.useState<AnamnesisAnswers>(() => {
    const out: AnamnesisAnswers = {};
    for (const item of alertItems) out[item.key] = answers[item.key] ?? { value: null, detail: '' };
    return out;
  });

  const todayKey = React.useMemo(() => new Date().toISOString().slice(0, 10), []);
  const birthPreview = React.useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
    const label = new Intl.DateTimeFormat('es-ES', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(`${birthDate}T00:00:00Z`));
    const age = describeAge(birthDate, todayKey);
    return age ? `${label} · ${age}` : label;
  }, [birthDate, todayKey]);

  function setGuardian(index: number, patch: Partial<Guardian>) {
    setGuardians((prev) => prev.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }
  function setPrimary(index: number) {
    setGuardians((prev) => prev.map((g, i) => ({ ...g, primary: i === index })));
  }
  function removeGuardian(index: number) {
    setGuardians((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }
  function addGuardian() {
    setGuardians((prev) =>
      prev.length >= MAX_GUARDIANS
        ? prev
        : [...prev, emptyGuardian(prev.length === 1 ? 'PADRE' : 'TUTOR')],
    );
  }
  function setAlert(key: string, patch: Partial<{ value: boolean | null; detail: string }>) {
    setAlerts((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? { value: null, detail: '' }), ...patch },
    }));
  }

  const primary = guardians.find((g) => g.primary) ?? null;
  const primaryMissingPhone = primary !== null && !primary.phone?.trim();

  function submit() {
    setError(null);
    if (primaryMissingPhone) {
      setError('El titular del teléfono necesita un teléfono.');
      return;
    }
    const cleanGuardians = guardians.filter((g) => g.name.trim() || g.phone?.trim());
    const input = {
      firstName,
      lastName,
      birthDate: birthDate || null,
      guardians: cleanGuardians,
      contactPhone: primary?.phone ?? '',
      contactName: primary?.name ?? '',
      notes,
      ...(alertItems.length > 0 ? { anamnesisPatch: alerts } : {}),
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
      <DialogContent className="flex max-w-2xl flex-col overflow-hidden">
        <DialogHeader className="mb-3">
          <DialogTitle>{mode === 'create' ? 'Nuevo paciente' : 'Datos del paciente'}</DialogTitle>
          <DialogDescription>
            El paciente es el niño o la niña. Los tutores son a quien se llama; el titular del
            teléfono es a quien se le recuerda la cita y se le manda el consentimiento.
          </DialogDescription>
        </DialogHeader>

        {/* El cuerpo hace scroll y el pie queda siempre a la vista. */}
        <div className="-mr-2 grid max-h-[min(62vh,640px)] gap-4 overflow-y-auto pr-2">
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

          <div className="grid gap-1.5 sm:max-w-[320px]">
            <Label htmlFor="pt-birth">Fecha de nacimiento</Label>
            <Input
              id="pt-birth"
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
            />
            <p className="text-[12px] text-zinc-600">
              {birthPreview ?? 'Con ella la agenda y la ficha enseñan la edad con número.'}
            </p>
          </div>

          <fieldset className="grid gap-2.5 border-0 p-0">
            <div className="flex items-center justify-between gap-2">
              <legend className="text-[14px] font-semibold tracking-tight text-zinc-700">
                Tutores
              </legend>
              {guardians.length < MAX_GUARDIANS && (
                <Button type="button" variant="ghost" size="xs" onClick={addGuardian}>
                  <Plus className="h-3.5 w-3.5" /> Añadir tutor
                </Button>
              )}
            </div>
            {guardians.map((g, i) => (
              <div
                key={`g-${i.toString()}`}
                className={cn(
                  'grid gap-2 rounded-[14px] border p-3',
                  g.primary ? 'border-brand-200 bg-brand-50/60' : 'border-(--color-border)',
                )}
              >
                <div className="grid gap-2 sm:grid-cols-[150px_1fr_auto]">
                  <Select
                    aria-label={`Tutor ${i + 1}: relación`}
                    value={g.role}
                    onChange={(e) => setGuardian(i, { role: e.target.value as GuardianRole })}
                  >
                    {RELATIONS.map((r) => (
                      <option key={r} value={r}>
                        {GUARDIAN_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                  <Input
                    aria-label={`Tutor ${i + 1}: nombre`}
                    value={g.name}
                    onChange={(e) => setGuardian(i, { name: e.target.value })}
                    placeholder="Nombre y apellidos"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Quitar tutor ${i + 1}`}
                    disabled={guardians.length <= 1}
                    onClick={() => removeGuardian(i)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_140px]">
                  <Input
                    aria-label={`Tutor ${i + 1}: teléfono`}
                    value={g.phone ?? ''}
                    onChange={(e) => setGuardian(i, { phone: e.target.value })}
                    placeholder="+34 600 000 000"
                    inputMode="tel"
                  />
                  <Input
                    aria-label={`Tutor ${i + 1}: email`}
                    type="email"
                    value={g.email ?? ''}
                    onChange={(e) => setGuardian(i, { email: e.target.value })}
                    placeholder="correo (opcional)"
                  />
                  <Select
                    aria-label={`Tutor ${i + 1}: canal preferido`}
                    value={g.channel ?? ''}
                    onChange={(e) =>
                      setGuardian(i, {
                        channel: (e.target.value || null) as Guardian['channel'],
                      })
                    }
                  >
                    <option value="">Canal: cualquiera</option>
                    {CONTACT_CHANNELS.map((c) => (
                      <option key={c} value={c}>
                        {CONTACT_CHANNEL_LABELS[c]}
                      </option>
                    ))}
                  </Select>
                </div>
                <label className="flex items-center gap-2 text-[13px] text-zinc-700">
                  <input
                    type="radio"
                    name="pt-primary"
                    checked={g.primary === true}
                    onChange={() => setPrimary(i)}
                    className="h-4 w-4"
                  />
                  Titular del teléfono de la ficha
                </label>
              </div>
            ))}
            {!primary && (
              <p className="text-[12px] text-amber-800">
                Marca quién es el titular del teléfono: sin él no hay a quién recordarle la cita.
              </p>
            )}
          </fieldset>

          {alertItems.length > 0 && (
            <fieldset className="grid gap-2 border-0 p-0">
              <legend className="text-[14px] font-semibold tracking-tight text-zinc-700">
                Alertas clínicas
              </legend>
              <p className="-mt-1 text-[12px] text-zinc-600">
                Lo que sale en la cabecera de la ficha. El resto de la anamnesis se contesta en su
                pestaña.
              </p>
              {alertItems.map((item) => {
                const a = alerts[item.key] ?? { value: null, detail: '' };
                return (
                  <div
                    key={item.key}
                    className="grid items-center gap-2 rounded-[14px] border border-(--color-border) px-3 py-2 sm:grid-cols-[170px_auto_1fr]"
                  >
                    <span className="text-[13px] font-semibold text-zinc-800" title={item.fullName}>
                      {item.label}
                    </span>
                    <div className="flex gap-1.5">
                      <MiniToggle
                        active={a.value === true}
                        onClick={() =>
                          setAlert(item.key, { value: a.value === true ? null : true })
                        }
                      >
                        Sí
                      </MiniToggle>
                      <MiniToggle
                        active={a.value === false}
                        onClick={() =>
                          setAlert(item.key, {
                            value: a.value === false ? null : false,
                            detail: '',
                          })
                        }
                      >
                        No
                      </MiniToggle>
                    </div>
                    {a.value === true && !item.noDetail ? (
                      <Input
                        aria-label={`${item.label}: cuál`}
                        value={a.detail}
                        onChange={(e) => setAlert(item.key, { detail: e.target.value })}
                        placeholder={item.hint ?? '¿Cuál?'}
                        className="h-9"
                      />
                    ) : (
                      <span className="text-[12px] text-zinc-500">
                        {a.value === null ? 'Sin contestar' : ''}
                      </span>
                    )}
                  </div>
                );
              })}
            </fieldset>
          )}

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

        <DialogFooter className="mt-4 flex justify-end gap-2">
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

function MiniToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1 text-[12px] font-semibold ring-1 transition-colors',
        active
          ? 'bg-brand-600 text-white ring-brand-600'
          : 'bg-white text-zinc-700 ring-(--color-border) hover:bg-brand-50',
      )}
    >
      {children}
    </button>
  );
}
