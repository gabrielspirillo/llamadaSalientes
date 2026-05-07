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
import { Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { type ActionResult, createFaqAction, updateFaqAction } from './actions';

type Faq = {
  id: string;
  category: string | null;
  question: string;
  answer: string;
  priority: number | null;
};

export function FaqDialog({ faq, trigger }: { faq?: Faq; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isEdit = !!faq;

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const r: ActionResult = isEdit
        ? await updateFaqAction(faq.id, formData)
        : await createFaqAction(formData);
      if (r.ok) setOpen(false);
      else setError(r.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar FAQ' : 'Nueva FAQ'}</DialogTitle>
          <DialogDescription>
            El agente puede usar esta respuesta cuando un paciente pregunta algo similar.
          </DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label htmlFor="category">Categoría</Label>
              <Input
                id="category"
                name="category"
                defaultValue={faq?.category ?? ''}
                placeholder="Precios, Pagos, Ubicación…"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="priority">Prioridad</Label>
              <Input
                id="priority"
                name="priority"
                type="number"
                min="0"
                max="100"
                defaultValue={faq?.priority ?? 5}
                className="mt-1.5"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="question">Pregunta</Label>
            <Input
              id="question"
              name="question"
              required
              defaultValue={faq?.question ?? ''}
              placeholder="¿Cuánto cuesta una limpieza dental?"
              className="mt-1.5"
            />
          </div>

          <div>
            <Label htmlFor="answer">Respuesta</Label>
            <Textarea
              id="answer"
              name="answer"
              required
              defaultValue={faq?.answer ?? ''}
              placeholder="Entre $40 y $80 USD según el caso. Incluye revisión y profilaxis."
              className="mt-1.5 min-h-[120px]"
            />
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
