'use client';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Loader2,
  Mail,
  Phone,
  Search,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { ContactDetailDialog } from './contact-detail-dialog';

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

// Tags que NO queremos mostrar (ruido del seeder o propios del sistema)
const HIDDEN_TAGS = new Set(['seed-dentalflow', 'sin-tratamiento-activo', 'con-seguro']);

function gradientFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return GRADIENTS[hash % GRADIENTS.length]!;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Devuelve el nombre formateado con la primera letra del apellido en mayúscula
 * y el resto en minúscula. Ej: "JUAN PEREZ" → "Juan P.", "maria garcia lopez" → "Maria G."
 */
function displayName(c: Contact): string {
  const first = (c.firstName ?? '').trim();
  const last = (c.lastName ?? '').trim();
  if (first || last) {
    const fname = first ? cap(first.split(/\s+/)[0]!) : '';
    const lInitial = last ? `${last.charAt(0).toUpperCase()}.` : '';
    return [fname, lInitial].filter(Boolean).join(' ') || 'Sin nombre';
  }
  if (c.email) return c.email;
  if (c.phone) return c.phone;
  return 'Sin nombre';
}

function initialsOf(c: Contact): string {
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

function visibleTags(c: Contact): string[] {
  return (c.tags ?? []).filter((t) => !HIDDEN_TAGS.has(t));
}

export function ContactsGrid({ initial }: { initial: Contact[] }) {
  const [contacts, setContacts] = useState<Contact[]>(initial);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [openContactId, setOpenContactId] = useState<string | null>(null);

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

      {contacts.length === 0 ? (
        <Card>
          <div className="px-6 py-20 text-center">
            <Users className="mx-auto h-8 w-8 text-zinc-300 mb-3" />
            <p className="text-base font-semibold tracking-tight">
              {q.length > 0 ? 'Sin resultados' : 'Aún no hay contactos'}
            </p>
            <p className="text-sm text-zinc-500 mt-1.5 max-w-sm mx-auto">
              {q.length > 0
                ? `No encontré contactos para "${q}". Probá otro término.`
                : 'Cuando el agente registre pacientes en GHL, vas a verlos acá.'}
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {contacts.map((c) => {
            const tags = visibleTags(c);
            return (
              <Card
                key={c.id}
                className="overflow-hidden hover:shadow-lg hover:border-zinc-300 cursor-pointer transition-all"
                onClick={() => setOpenContactId(c.id)}
              >
                <div className="p-5">
                  <div className="flex items-start gap-3">
                    <div
                      className={`h-12 w-12 shrink-0 rounded-xl bg-gradient-to-br ${gradientFor(c.id)} flex items-center justify-center text-white font-semibold text-sm shadow-sm ring-2 ring-white`}
                    >
                      {initialsOf(c)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold tracking-tight truncate">{displayName(c)}</p>
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

                  {tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {tags.slice(0, 4).map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600"
                        >
                          {tag}
                        </span>
                      ))}
                      {tags.length > 4 && (
                        <span className="text-[11px] text-zinc-400">+{tags.length - 4}</span>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {openContactId && (
        <ContactDetailDialog
          contactId={openContactId}
          open={!!openContactId}
          onClose={() => setOpenContactId(null)}
        />
      )}
    </div>
  );
}
