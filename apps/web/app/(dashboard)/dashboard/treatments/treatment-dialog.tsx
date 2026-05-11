'use client';

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
import { Input, Label, Textarea } from '@/components/ui/input';
import { Calendar, Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { type ActionResult, createTreatmentAction, updateTreatmentAction } from './actions';

type Treatment = {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceMin: string | null;
  priceMax: string | null;
  active: boolean | null;
};

const WEEK_DAYS: { key: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'; label: string }[] = [
  { key: 'Mon', label: 'Lun' },
  { key: 'Tue', label: 'Mar' },
  { key: 'Wed', label: 'Mié' },
  { key: 'Thu', label: 'Jue' },
  { key: 'Fri', label: 'Vie' },
  { key: 'Sat', label: 'Sáb' },
  { key: 'Sun', label: 'Dom' },
];

export function TreatmentDialog({
  treatment,
  trigger,
}: {
  treatment?: Treatment;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [selectedDays, setSelectedDays] = useState<Set<string>>(
    new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']),
  );
  const isEdit = !!treatment;

  function toggleDay(day: string) {
    setSelectedDays((s) => {
      const next = new Set(s);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    // Inyectamos los días seleccionados (los chips son botones, no inputs nativos)
    formData.set('scheduleDays', Array.from(selectedDays).join(','));
    startTransition(async () => {
      const result: ActionResult = isEdit
        ? await updateTreatmentAction(treatment.id, formData)
        : await createTreatmentAction(formData);
      if (result.ok) {
        setOpen(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar tratamiento' : 'Nuevo tratamiento'}</DialogTitle>
          <DialogDescription>
            El agente lo va a ofrecer y agendar usando este nombre, duración y precio.
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">Nombre</Label>
            <Input
              id="name"
              name="name"
              required
              defaultValue={treatment?.name ?? ''}
              placeholder="Limpieza dental"
              className="mt-1.5"
            />
          </div>

          <div>
            <Label htmlFor="description">Descripción (opcional)</Label>
            <Textarea
              id="description"
              name="description"
              defaultValue={treatment?.description ?? ''}
              placeholder="Profilaxis y revisión completa."
              className="mt-1.5 min-h-[80px]"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="durationMinutes">Duración (min)</Label>
              <Input
                id="durationMinutes"
                name="durationMinutes"
                type="number"
                min="5"
                max="480"
                step="5"
                required
                defaultValue={treatment?.durationMinutes ?? 30}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="priceMin">Precio mín ($)</Label>
              <Input
                id="priceMin"
                name="priceMin"
                type="number"
                min="0"
                step="1"
                defaultValue={treatment?.priceMin ?? ''}
                placeholder="40"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="priceMax">Precio máx ($)</Label>
              <Input
                id="priceMax"
                name="priceMax"
                type="number"
                min="0"
                step="1"
                defaultValue={treatment?.priceMax ?? ''}
                placeholder="80"
                className="mt-1.5"
              />
            </div>
          </div>

          {!isEdit && (
            <div className="rounded-xl border border-zinc-200/70 bg-zinc-50/50 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-violet-600" />
                <p className="text-sm font-medium">Horarios de atención (opcional)</p>
              </div>
              <p className="text-xs text-zinc-500">
                Si lo definís acá, vamos a crear un calendario en GHL automáticamente con estos
                días y horarios. Si no, podés conectar uno existente después.
              </p>

              <div>
                <Label>Días que se ofrece</Label>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {WEEK_DAYS.map((d) => {
                    const active = selectedDays.has(d.key);
                    return (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() => toggleDay(d.key)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                          active
                            ? 'bg-zinc-900 text-white'
                            : 'bg-white border border-zinc-200 text-zinc-600 hover:border-zinc-300'
                        }`}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="scheduleStart">Apertura</Label>
                  <Input
                    id="scheduleStart"
                    name="scheduleStart"
                    type="time"
                    defaultValue="09:00"
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label htmlFor="scheduleEnd">Cierre</Label>
                  <Input
                    id="scheduleEnd"
                    name="scheduleEnd"
                    type="time"
                    defaultValue="19:00"
                    className="mt-1.5"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            {/* Hidden input emite "false" cuando el checkbox no está marcado */}
            <input type="hidden" name="active" value="false" />
            <input
              id="active"
              name="active"
              type="checkbox"
              defaultChecked={treatment?.active ?? true}
              value="true"
              className="h-4 w-4 rounded border-zinc-300"
            />
            <Label htmlFor="active" className="cursor-pointer">
              Activo (el agente lo puede ofrecer)
            </Label>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? 'Guardar' : 'Crear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
