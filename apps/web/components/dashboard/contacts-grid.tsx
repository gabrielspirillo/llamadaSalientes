'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  ExternalLink,
  Loader2,
  Mail,
  Phone,
  PhoneCall,
  Search,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';

type Contact = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  tags?: string[] | null;
  type?: string | null;
  dateAdded?: string | null;
  dateUpdated?: string | null;
  lastActivity?: string | null;
};

const GRADIENTS = [
  'from-violet-500 to-pink-500',
  'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-rose-500 to-red-500',
  'from-indigo-500 to-purple-500',
  'from-sky-500 to-blue-500',
  'from-fuchsia-500 to-pink-500',
];

function gradientFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return GRADIENTS[hash % GRADIENTS.length]!;
}

function fullName(c: Contact): string {
  const n = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return n || c.email || c.phone || 'Sin nombre';
}

function initials(c: Contact): string {
  const f = (c.firstName ?? '').trim();
  const l = (c.lastName ?? '').trim();
  if (f || l) return `${f[0] ?? ''}${l[0] ?? ''}`.toUpperCase() || '·';
  if (c.email) return c.email[0]?.toUpperCase() ?? '·';
  return '·';
}

function timeAgoEs(iso?: string | null): string {
  if (!iso) return 'sin actividad';
  const d = new Date(iso);
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'recién';
  const min = Math.round(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const days = Math.round(hr / 24);
  if (days < 30) return `hace ${days} d`;
  const months = Math.round(days / 30);
  return `hace ${months} m`;
}

export function ContactsGrid({ initial }: { initial: Contact[] }) {
  const [contacts, setContacts] = useState<Contact[]>(initial);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [calling, setCalling] = useState<string | null>(null);
  const [callError, setCallError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/contacts?${new URLSearchParams({ q, limit: '50' }).toString()}`,
          { signal: ac.signal },
        );
        if (res.ok) {
          const data = (await res.json()) as { contacts: Contact[] };
          setContacts(data.contacts ?? []);
        }
      } catch {}
      setLoading(false);
    }, 250);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [q]);

  async function callContact(c: Contact) {
    if (!c.phone) return;
    setCalling(c.id);
    setCallError(null);
    try {
      const res = await fetch('/api/calls/outbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toNumber: c.phone,
          patientName: fullName(c),
          ghlContactId: c.id,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Error ${res.status}`);
      }
    } catch (e) {
      setCallError(e instanceof Error ? e.message : 'Error');
    }
    setCalling(null);
  }

  return (
    <div>
      <Card className="mb-5">
        <div className="flex items-center gap-3 p-5">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre, teléfono, email…"
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <Badge>
              {contacts.length} {contacts.length === 1 ? 'contacto' : 'contactos'}
            </Badge>
          </div>
        </div>
      </Card>

      {callError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {callError}
        </div>
      )}

      {contacts.length === 0 ? (
        <Card>
          <div className="px-6 py-20 text-center">
            <Users className="mx-auto h-8 w-8 text-zinc-300 mb-3" />
            <p className="text-base font-semibold tracking-tight">
              {q.length > 0 ? 'Sin resultados' : 'Aún no hay contactos'}
            </p>
            <p className="text-sm text-zinc-500 mt-1.5 max-w-sm mx-auto">
              {q.length > 0
                ? `No encontré contactos para “${q}”. Probá otro término.`
                : 'Cuando el agente registre pacientes en GHL, vas a verlos acá.'}
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {contacts.map((c) => (
            <Card key={c.id} className="overflow-hidden hover:shadow-lg transition-shadow">
              <div className="p-5">
                <div className="flex items-start gap-3">
                  <div
                    className={`h-12 w-12 shrink-0 rounded-xl bg-gradient-to-br ${gradientFor(c.id)} flex items-center justify-center text-white font-semibold text-sm shadow-sm ring-2 ring-white`}
                  >
                    {initials(c)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold tracking-tight truncate">{fullName(c)}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {timeAgoEs(c.lastActivity ?? c.dateUpdated ?? c.dateAdded)}
                    </p>
                  </div>
                  {c.type && c.type !== 'lead' && (
                    <Badge tone="violet" className="shrink-0">
                      {c.type}
                    </Badge>
                  )}
                </div>

                <div className="mt-4 space-y-1.5 text-sm">
                  {c.phone && (
                    <div className="flex items-center gap-2 text-zinc-600">
                      <Phone className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                      <span className="truncate tabular-nums">{c.phone}</span>
                    </div>
                  )}
                  {c.email && (
                    <div className="flex items-center gap-2 text-zinc-600">
                      <Mail className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                      <span className="truncate">{c.email}</span>
                    </div>
                  )}
                </div>

                {c.tags && c.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {c.tags.slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600"
                      >
                        {tag}
                      </span>
                    ))}
                    {c.tags.length > 4 && (
                      <span className="text-[11px] text-zinc-400">+{c.tags.length - 4}</span>
                    )}
                  </div>
                )}

                <div className="mt-5 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!c.phone || calling === c.id}
                    onClick={() => callContact(c)}
                    className="flex-1"
                  >
                    {calling === c.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <PhoneCall className="h-3.5 w-3.5" />
                    )}
                    Llamar
                  </Button>
                  <Button asChild size="sm" variant="secondary">
                    <a
                      href={`https://app.gohighlevel.com/contacts/detail/${c.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      GHL
                    </a>
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
