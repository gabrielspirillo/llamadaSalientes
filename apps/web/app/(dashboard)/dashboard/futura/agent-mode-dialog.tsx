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
import { Input, Label } from '@/components/ui/input';
import type { WhatsappAgentMode } from '@/lib/data/whatsapp-agent-settings';
import { Bot, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setWhatsappAgentModeAction } from './actions';

/**
 * Qué hace el asistente de WhatsApp de una clínica. Sólo lo ve Futura.
 *
 * Son dos formas de trabajar, no un interruptor de una función: o el asistente
 * cierra la cita él mismo, o recoge la consulta y se la pasa al profesional. Por
 * eso se eligen como dos opciones con su explicación, y no como un "activar".
 */
export function AgentModeDialog({
  tenantId,
  mode,
  fallbackPhone,
}: {
  tenantId: string;
  mode: WhatsappAgentMode;
  fallbackPhone: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <Bot className="h-4 w-4" />
          Asistente
          {mode === 'DERIVE' && (
            <span className="ml-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-600">
              deriva
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        {open && (
          <AgentModeForm
            key={`${tenantId}:${mode}:${fallbackPhone ?? ''}`}
            tenantId={tenantId}
            mode={mode}
            fallbackPhone={fallbackPhone}
            onDone={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AgentModeForm({
  tenantId,
  mode,
  fallbackPhone,
  onDone,
}: {
  tenantId: string;
  mode: WhatsappAgentMode;
  fallbackPhone: string | null;
  onDone: () => void;
}) {
  const [draftMode, setDraftMode] = useState<WhatsappAgentMode>(mode);
  const [draftPhone, setDraftPhone] = useState(fallbackPhone ?? '');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function save() {
    setError(null);
    setWarning(null);
    startTransition(async () => {
      const result = await setWhatsappAgentModeAction(
        tenantId,
        draftMode,
        draftMode === 'DERIVE' ? draftPhone : null,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      if (result.warning) {
        setWarning(result.warning);
        return;
      }
      onDone();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Asistente de WhatsApp</DialogTitle>
        <DialogDescription>
          Qué hace el asistente cuando un paciente escribe pidiendo cita.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 py-2">
        <ModeOption
          selected={draftMode === 'BOOKING'}
          onSelect={() => setDraftMode('BOOKING')}
          title="Agenda la cita"
          description="Consulta los huecos de la agenda, propone horarios y reserva. Es el comportamiento normal."
        />
        <ModeOption
          selected={draftMode === 'DERIVE'}
          onSelect={() => setDraftMode('DERIVE')}
          title="Deriva al profesional"
          description="No reserva nada. Recoge la consulta y se la manda por WhatsApp al profesional que hace ese servicio, que es quien contacta al paciente."
        />

        {draftMode === 'DERIVE' && (
          <div className="rounded-[14px] border border-(--color-border) bg-zinc-50/60 p-3">
            <Label htmlFor="derive-fallback">Móvil de respaldo</Label>
            <Input
              id="derive-fallback"
              value={draftPhone}
              onChange={(e) => setDraftPhone(e.target.value)}
              placeholder="+34600000000"
              disabled={pending}
            />
            <p className="mt-2 text-[12px] leading-relaxed text-zinc-500">
              A quién se avisa cuando la consulta no encaja con ningún profesional, o cuando el que
              encaja no tiene móvil cargado en su ficha. Los demás avisos salen al móvil de cada
              profesional.
            </p>
          </div>
        )}
      </div>

      {error && <p className="text-[13px] text-rose-600">{error}</p>}
      {warning && <p className="text-[13px] text-amber-600">{warning}</p>}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="button" onClick={save} disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar
        </Button>
      </DialogFooter>
    </>
  );
}

function ModeOption({
  selected,
  onSelect,
  title,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-[14px] border p-3 text-left transition-colors ${
        selected
          ? 'border-brand-300 bg-brand-50/60 shadow-[var(--shadow-soft)]'
          : 'border-(--color-border) bg-white hover:border-brand-200'
      }`}
    >
      <span className="block text-[14px] font-semibold text-zinc-900">{title}</span>
      <span className="mt-0.5 block text-[12px] leading-relaxed text-zinc-500">{description}</span>
    </button>
  );
}
