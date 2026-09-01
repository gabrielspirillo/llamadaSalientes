'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Loader2, Send, UserPlus } from 'lucide-react';
import { useState, useTransition } from 'react';
import { type InviteResult, inviteMemberAction } from './actions';

export function InviteMember() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('org:member');
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    startTransition(async () => {
      const r: InviteResult = await inviteMemberAction({ email, role });
      if (r.ok) {
        setFeedback({ kind: 'ok', msg: `Invitación enviada a ${email}.` });
        setEmail('');
      } else {
        setFeedback({ kind: 'error', msg: r.error });
      }
    });
  }

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" /> Invitar miembro
      </Button>
    );
  }

  return (
    <Card className="w-full sm:w-[420px]">
      <form onSubmit={submit} className="space-y-4 p-5">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Invitar a un miembro</h3>
          <p className="mt-1 text-sm text-zinc-500">Le llega un email para unirse a tu clínica.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="persona@tuclinica.com"
            autoComplete="off"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="invite-role">Rol</Label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="flex h-10 w-full rounded-xl border border-[--color-border] bg-white px-3.5 text-sm focus-visible:border-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/25"
          >
            <option value="org:member">Operador — puede operar, sin config crítica</option>
            <option value="org:admin">Admin — acceso completo</option>
          </select>
        </div>

        {feedback && (
          <div
            className={`rounded-xl border px-3.5 py-2.5 text-sm ${
              feedback.kind === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-800'
            }`}
          >
            {feedback.msg}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cerrar
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar invitación
          </Button>
        </div>
      </form>
    </Card>
  );
}
