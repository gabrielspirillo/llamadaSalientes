'use client';

import {
  createProfessionalAction,
  updateProfessionalAction,
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
import { Input, Label, Select, Switch } from '@/components/ui/input';
import { PROFESSIONAL_COLORS } from '@/lib/agenda/shared';
import { cn } from '@/lib/cn';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

export interface ProfessionalFormValues {
  id?: string;
  fullName: string;
  email: string;
  phone: string;
  specialty: string;
  licenseNumber: string;
  color: string;
  agendaEnabled: boolean;
  acceptsOnlineBooking: boolean;
  panelAccess: 'AGENDA_ONLY' | 'FULL';
  slotGranularityMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxAdvanceDays: number;
  linkUserEmail: string;
}

const EMPTY: ProfessionalFormValues = {
  fullName: '',
  email: '',
  phone: '',
  specialty: '',
  licenseNumber: '',
  color: PROFESSIONAL_COLORS[0],
  agendaEnabled: true,
  acceptsOnlineBooking: true,
  panelAccess: 'AGENDA_ONLY',
  slotGranularityMinutes: 15,
  bufferMinutes: 0,
  minNoticeHours: 2,
  maxAdvanceDays: 90,
  linkUserEmail: '',
};

/** Alta y edición de un profesional. Mismo formulario en los dos casos. */
export function ProfessionalDialog({
  trigger,
  professional,
}: {
  trigger: React.ReactNode;
  professional?: Partial<ProfessionalFormValues> & { id: string };
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [values, setValues] = React.useState<ProfessionalFormValues>({
    ...EMPTY,
    ...professional,
  });

  const isEdit = Boolean(professional?.id);

  function set<K extends keyof ProfessionalFormValues>(key: K, value: ProfessionalFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const payload = {
        fullName: values.fullName,
        email: values.email,
        phone: values.phone,
        specialty: values.specialty,
        licenseNumber: values.licenseNumber,
        color: values.color,
        agendaEnabled: values.agendaEnabled,
        acceptsOnlineBooking: values.acceptsOnlineBooking,
        panelAccess: values.panelAccess,
        slotGranularityMinutes: Number(values.slotGranularityMinutes),
        bufferMinutes: Number(values.bufferMinutes),
        minNoticeHours: Number(values.minNoticeHours),
        maxAdvanceDays: Number(values.maxAdvanceDays),
        linkUserEmail: values.linkUserEmail ? values.linkUserEmail : null,
      };
      const result = professional?.id
        ? await updateProfessionalAction(professional.id, payload)
        : await createProfessionalAction(payload);
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar profesional' : 'Nuevo profesional'}</DialogTitle>
          <DialogDescription>
            Los datos y la configuración de su agenda. El horario y los tratamientos se cargan
            después, en su ficha.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="pf-name">Nombre completo</Label>
              <Input
                id="pf-name"
                value={values.fullName}
                onChange={(e) => set('fullName', e.target.value)}
                placeholder="Dra. Marta Ruiz"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pf-spec">Especialidad</Label>
              <Input
                id="pf-spec"
                value={values.specialty}
                onChange={(e) => set('specialty', e.target.value)}
                placeholder="Ortodoncia"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="pf-email">Email</Label>
              <Input
                id="pf-email"
                type="email"
                value={values.email}
                onChange={(e) => set('email', e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pf-phone">Teléfono</Label>
              <Input
                id="pf-phone"
                value={values.phone}
                onChange={(e) => set('phone', e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Color en el calendario</Label>
            <div className="flex flex-wrap gap-2">
              {PROFESSIONAL_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => set('color', c)}
                  className={cn(
                    'h-7 w-7 rounded-full ring-2 transition-transform',
                    values.color === c ? 'ring-zinc-900 scale-110' : 'ring-transparent',
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="rounded-[14px] border border-[--color-border] p-3">
            <p className="mb-3 text-[12px] font-bold uppercase tracking-wide text-zinc-500">
              Acceso a la plataforma
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="pf-user">Email del usuario del panel</Label>
                <Input
                  id="pf-user"
                  type="email"
                  value={values.linkUserEmail}
                  onChange={(e) => set('linkUserEmail', e.target.value)}
                  placeholder="Ya invitado desde Equipo"
                />
                <p className="text-[12px] text-zinc-500">
                  Déjalo vacío si el profesional no entra al panel.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pf-access">Qué ve al entrar</Label>
                <Select
                  id="pf-access"
                  value={values.panelAccess}
                  onChange={(e) => set('panelAccess', e.target.value as 'AGENDA_ONLY' | 'FULL')}
                >
                  <option value="AGENDA_ONLY">Sólo su agenda y sus pacientes</option>
                  <option value="FULL">El panel completo</option>
                </Select>
              </div>
            </div>
          </div>

          <div className="rounded-[14px] border border-[--color-border] p-3">
            <p className="mb-3 text-[12px] font-bold uppercase tracking-wide text-zinc-500">
              Cómo se dan sus huecos
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="pf-gran">Rejilla de huecos (min)</Label>
                <Input
                  id="pf-gran"
                  type="number"
                  min={5}
                  max={120}
                  step={5}
                  value={values.slotGranularityMinutes}
                  onChange={(e) => set('slotGranularityMinutes', Number(e.target.value))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pf-buffer">Descanso entre citas (min)</Label>
                <Input
                  id="pf-buffer"
                  type="number"
                  min={0}
                  max={120}
                  step={5}
                  value={values.bufferMinutes}
                  onChange={(e) => set('bufferMinutes', Number(e.target.value))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pf-notice">Antelación mínima (horas)</Label>
                <Input
                  id="pf-notice"
                  type="number"
                  min={0}
                  max={720}
                  value={values.minNoticeHours}
                  onChange={(e) => set('minNoticeHours', Number(e.target.value))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pf-advance">Se puede reservar hasta (días)</Label>
                <Input
                  id="pf-advance"
                  type="number"
                  min={1}
                  max={365}
                  value={values.maxAdvanceDays}
                  onChange={(e) => set('maxAdvanceDays', Number(e.target.value))}
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[14px] font-semibold text-zinc-800">Agenda habilitada</p>
                <p className="text-[12px] text-zinc-500">
                  Apagada, el profesional existe pero no se le pueden dar citas.
                </p>
              </div>
              <Switch
                checked={values.agendaEnabled}
                onCheckedChange={(v) => set('agendaEnabled', v)}
                label="Agenda habilitada"
              />
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[14px] font-semibold text-zinc-800">
                  Los agentes virtuales pueden reservarle
                </p>
                <p className="text-[12px] text-zinc-500">
                  Apagado, los agentes consultan su agenda pero sólo reserva recepción.
                </p>
              </div>
              <Switch
                checked={values.acceptsOnlineBooking}
                onCheckedChange={(v) => set('acceptsOnlineBooking', v)}
                label="Reservas automáticas"
              />
            </div>
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
          <Button onClick={submit} disabled={pending || values.fullName.trim().length < 2}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? 'Guardar cambios' : 'Crear profesional'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
