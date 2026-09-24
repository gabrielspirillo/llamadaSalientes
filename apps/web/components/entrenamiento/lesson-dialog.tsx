'use client';

import {
  type ActionResult,
  createLessonAction,
  updateLessonAction,
} from '@/app/(dashboard)/dashboard/entrenamiento/actions';
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
  LESSON_KINDS,
  LESSON_KIND_HINT,
  LESSON_KIND_LABEL,
  type LessonKind,
} from '@/lib/agent-training/model';
import { Loader2 } from 'lucide-react';
import { type ReactNode, useState, useTransition } from 'react';

export interface LessonFormValues {
  id: string;
  kind: LessonKind;
  title: string;
  situation: string | null;
  instruction: string;
}

/** Alta y edición a mano, para quien ya sabe qué quiere escribir. */
export function LessonDialog({
  lesson,
  trigger,
}: {
  lesson?: LessonFormValues;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<LessonKind>(lesson?.kind ?? 'RULE');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const editando = Boolean(lesson);

  function enviar(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const r: ActionResult = editando
        ? await updateLessonAction(lesson?.id ?? '', formData)
        : await createLessonAction(formData);
      if (r.ok) setOpen(false);
      else setError(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editando ? 'Editar enseñanza' : 'Enseñar algo a mano'}</DialogTitle>
          <DialogDescription>
            El asistente lo tendrá en cuenta en la próxima conversación.
          </DialogDescription>
        </DialogHeader>
        <form action={enviar} className="space-y-4">
          <div>
            <Label htmlFor="kind">Qué tipo de cosa es</Label>
            <Select
              id="kind"
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as LessonKind)}
              className="mt-1.5"
            >
              {LESSON_KINDS.map((k) => (
                <option key={k} value={k}>
                  {LESSON_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
            <p className="mt-1.5 text-[12px] text-zinc-500">{LESSON_KIND_HINT[kind]}</p>
          </div>

          <div>
            <Label htmlFor="title">Título</Label>
            <Input
              id="title"
              name="title"
              required
              defaultValue={lesson?.title ?? ''}
              placeholder="Precio de implantes: invitar a valoración"
              className="mt-1.5"
            />
          </div>

          <div>
            <Label htmlFor="situation">Cuándo aplica (opcional)</Label>
            <Input
              id="situation"
              name="situation"
              defaultValue={lesson?.situation ?? ''}
              placeholder="alguien pregunta el precio de los implantes"
              className="mt-1.5"
            />
            <p className="mt-1.5 text-[12px] text-zinc-500">
              Déjalo vacío si vale para toda conversación.
            </p>
          </div>

          <div>
            <Label htmlFor="instruction">Qué tiene que hacer</Label>
            <Textarea
              id="instruction"
              name="instruction"
              required
              defaultValue={lesson?.instruction ?? ''}
              placeholder="No des la cifra por WhatsApp. Explica que el precio depende del caso y ofrece una primera valoración sin coste."
              className="mt-1.5 min-h-[120px]"
            />
          </div>

          {error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {editando ? 'Guardar' : 'Enseñárselo'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
