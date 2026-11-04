'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTopbar } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/stat';
import { Loader2, ShieldCheck, UserMinus, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { addFuturaMemberAction, removeFuturaMemberAction } from './actions';

export interface FuturaMember {
  clerkUserId: string;
  name: string;
  email: string;
  isMe: boolean;
}

export interface FuturaInvite {
  email: string;
}

/**
 * Equipo de Futura: quien está aquí es super-admin (ve este panel, entra a
 * cualquier clínica, enciende y apaga módulos). Se añade por correo.
 */
export function FuturaTeam({
  members,
  invites,
}: {
  members: FuturaMember[];
  invites: FuturaInvite[];
}) {
  const [email, setEmail] = useState('');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  function add() {
    start(async () => {
      setMsg(null);
      const r = await addFuturaMemberAction(email);
      if (r.ok) {
        setMsg({ ok: true, text: r.message });
        setEmail('');
        router.refresh();
      } else setMsg({ ok: false, text: r.error });
    });
  }

  function remove(id: string) {
    start(async () => {
      setMsg(null);
      const r = await removeFuturaMemberAction(id);
      setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    });
  }

  return (
    <Card className="mb-6 overflow-hidden p-0">
      <CardTopbar
        icon={<ShieldCheck className="h-4 w-4" />}
        tone="grape"
        title="Equipo Futura"
        subtitle="Super-admins: ven este panel, entran a cualquier clínica y activan o desactivan módulos."
      />
      <div className="px-5 pb-5">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) add();
          }}
        >
          <Input
            type="email"
            placeholder="correo@ejemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="sm:max-w-sm"
          />
          <Button type="submit" disabled={pending || !email.trim()}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            Dar acceso
          </Button>
        </form>
        {msg && (
          <p className={`mt-2 text-[13px] ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>
            {msg.text}
          </p>
        )}

        <ul className="mt-4 divide-y divide-(--color-border-subtle)">
          {members.map((m) => (
            <li key={m.clerkUserId} className="flex items-center gap-3 py-2.5">
              <Avatar name={m.name || m.email} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-zinc-800">
                  {m.name || m.email} {m.isMe && <Badge tone="accent">Tú</Badge>}
                </span>
                <span className="block truncate text-[12.5px] text-zinc-500">{m.email}</span>
              </span>
              {!m.isMe && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => remove(m.clerkUserId)}
                >
                  <UserMinus className="h-4 w-4" /> Quitar
                </Button>
              )}
            </li>
          ))}
          {invites.map((i) => (
            <li key={i.email} className="flex items-center gap-3 py-2.5">
              <Avatar name={i.email} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-zinc-800">
                  {i.email}
                </span>
                <span className="block text-[12.5px] text-zinc-500">
                  Invitación enviada, sin aceptar
                </span>
              </span>
              <Badge tone="warn">Pendiente</Badge>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
