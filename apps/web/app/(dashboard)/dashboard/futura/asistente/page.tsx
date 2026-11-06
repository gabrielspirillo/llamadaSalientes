import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { StatTile } from '@/components/ui/stat';
import { SegmentedNav } from '@/components/ui/tabs';
import type { ReviewFlag } from '@/lib/agent-review/flags';
import { type ReviewedRun, listReviewedRuns } from '@/lib/agent-review/query';
import { formatPhoneDisplay } from '@/lib/patients/names';
import { getCurrentTenant } from '@/lib/tenant';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  MessageSquareWarning,
  Wrench,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

const RANGES = [
  { value: '24', label: '24 h', hours: 24 },
  { value: '72', label: '3 días', hours: 72 },
  { value: '168', label: '7 días', hours: 168 },
] as const;

const TONE: Record<ReviewFlag['level'], 'danger' | 'warn' | 'info'> = {
  error: 'danger',
  warn: 'warn',
  info: 'info',
};

function fmtAt(d: Date): string {
  return d.toLocaleString('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  });
}

function LevelIcon({ level }: { level: ReviewedRun['review']['level'] }) {
  if (level === 'error') return <XCircle className="h-4 w-4 text-rose-600" />;
  if (level === 'warn') return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
}

export default async function AsistentePage({
  searchParams,
}: {
  searchParams: Promise<{ horas?: string; clinica?: string; solo?: string }>;
}) {
  const { isSuperAdmin, realTenant, tenant: acting } = await getCurrentTenant();
  if (!isSuperAdmin) notFound();
  const sp = await searchParams;
  const range = RANGES.find((r) => r.value === sp.horas) ?? RANGES[0];
  const onlyFlagged = sp.solo !== 'todo';
  const clinic = sp.clinica?.trim() || null;

  const all = await listReviewedRuns({
    hours: range.hours,
    excludeTenantId: realTenant.id,
    tenantId: clinic,
  });
  const clinics = [...new Map(all.map((r) => [r.tenantId, r.tenantName])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  const errors = all.filter((r) => r.review.level === 'error').length;
  const warns = all.filter((r) => r.review.level === 'warn').length;
  const avgLatency = all.length
    ? Math.round(all.reduce((s, r) => s + r.latencyMs, 0) / all.length / 100) / 10
    : 0;
  const byModel = [
    ...all.reduce((m, r) => m.set(r.model, (m.get(r.model) ?? 0) + 1), new Map<string, number>()),
  ].sort((a, b) => b[1] - a[1]);
  const flagCounts = new Map<string, { label: string; level: ReviewFlag['level']; n: number }>();
  for (const r of all)
    for (const f of r.review.flags) {
      const key = f.code.split(':').slice(0, 2).join(':');
      const cur = flagCounts.get(key) ?? { label: f.label, level: f.level, n: 0 };
      cur.n += 1;
      flagCounts.set(key, cur);
    }
  const topFlags = [...flagCounts.entries()]
    .filter(([, v]) => v.level !== 'info')
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 8);
  const shown = onlyFlagged ? all.filter((r) => r.review.level !== 'ok') : all;
  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const merged = {
      horas: range.value,
      clinica: clinic ?? '',
      solo: onlyFlagged ? '' : 'todo',
      ...patch,
    };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    const s = q.toString();
    return `/dashboard/futura/asistente${s ? `?${s}` : ''}`;
  };

  return (
    <>
      <PageHeader
        eyebrow="Interno"
        icon={<MessageSquareWarning className="h-5 w-5" />}
        title="Revisión del asistente"
        description="Cada respuesta del asistente de WhatsApp con lo que entró, lo que consultó y lo que salió. Los avisos los pone una revisión automática: señalan dónde mirar, no sentencian."
        actions={
          <Link
            href="/dashboard/futura"
            className="text-[13px] font-semibold text-brand-600 hover:underline"
          >
            ← Panel Futura
          </Link>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <SegmentedNav
          activeValue={range.value}
          items={RANGES.map((r) => ({
            value: r.value,
            label: r.label,
            href: href({ horas: r.value }),
          }))}
        />
        <SegmentedNav
          activeValue={onlyFlagged ? 'avisos' : 'todo'}
          items={[
            {
              value: 'avisos',
              label: 'Solo con avisos',
              href: href({ solo: '' }),
              count: errors + warns,
            },
            { value: 'todo', label: 'Todas', href: href({ solo: 'todo' }), count: all.length },
          ]}
        />
        {clinics.length > 1 && (
          <SegmentedNav
            activeValue={clinic ?? ''}
            items={[
              { value: '', label: 'Todas las clínicas', href: href({ clinica: '' }) },
              ...clinics.map(([id, name]) => ({
                value: id,
                label: name,
                href: href({ clinica: id }),
              })),
            ]}
          />
        )}
      </div>

      <div className="stagger mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile
          label="Respuestas"
          numeric={all.length}
          hint={`en ${range.label}`}
          icon={<Bot className="h-4 w-4" />}
          tone="grape"
        />
        <StatTile
          label="Con error"
          numeric={errors}
          hint="Falló, sin respuesta o herramienta rota"
          icon={<XCircle className="h-4 w-4" />}
          tone="coral"
        />
        <StatTile
          label="Con aviso"
          numeric={warns}
          hint="Algo para mirar"
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="honey"
        />
        <StatTile
          label="Tiempo medio"
          value={`${avgLatency} s`}
          hint={byModel.map(([m, n]) => `${m}: ${n}`).join(' · ') || 'sin datos'}
          icon={<Clock className="h-4 w-4" />}
          tone="sky"
        />
      </div>

      {topFlags.length > 0 && (
        <Card className="mb-6 p-5">
          <p className="mb-3 text-[12px] font-bold uppercase tracking-[0.12em] text-zinc-500">
            Lo que más se repite
          </p>
          <div className="flex flex-wrap gap-2">
            {topFlags.map(([code, v]) => (
              <Badge key={code} tone={TONE[v.level]}>
                {v.label} · {v.n}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {shown.length === 0 ? (
        <div className="rounded-[22px] border border-(--color-border) bg-white p-12 text-center text-[14px] text-zinc-500">
          {onlyFlagged
            ? 'Ninguna respuesta con avisos en este período.'
            : 'Sin respuestas en este período.'}
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => (
            <Card key={r.id} className="p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <LevelIcon level={r.review.level} />
                  <span className="font-semibold text-zinc-900">{r.tenantName}</span>
                  <span className="text-zinc-400">·</span>
                  {acting.id === r.tenantId ? (
                    <Link
                      href={`/dashboard/whatsapp/${r.conversationId}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {r.contactName?.trim() || 'Sin nombre'}
                      {r.contactPhone ? ` · ${formatPhoneDisplay(r.contactPhone)}` : ''}
                    </Link>
                  ) : (
                    <span
                      className="font-medium text-zinc-700"
                      title="Gestiona esta clínica desde Panel Futura para abrir el chat"
                    >
                      {r.contactName?.trim() || 'Sin nombre'}
                      {r.contactPhone ? ` · ${formatPhoneDisplay(r.contactPhone)}` : ''}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-zinc-500">
                  <span>{fmtAt(r.at)}</span>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[11px]">
                    {r.model}
                  </span>
                  <span>{Math.round(r.latencyMs / 100) / 10} s</span>
                </div>
              </div>

              {r.review.flags.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {r.review.flags.map((f) => (
                    <Badge key={f.code} tone={TONE[f.level]} title={f.detail}>
                      {f.label}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl bg-zinc-50 p-3">
                  <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                    La familia
                  </p>
                  <p className="whitespace-pre-wrap text-[13px] text-zinc-800">
                    {r.userText?.trim() || (
                      <span className="text-zinc-400">(sin texto: audio, imagen o botón)</span>
                    )}
                  </p>
                </div>
                <div className="rounded-xl bg-emerald-50/60 p-3">
                  <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-700">
                    El asistente
                  </p>
                  <p className="whitespace-pre-wrap text-[13px] text-zinc-800">
                    {r.responseText?.trim() || (
                      <span className="text-zinc-400">(sin respuesta)</span>
                    )}
                  </p>
                  {r.errorText && <p className="mt-2 text-[12px] text-rose-600">{r.errorText}</p>}
                </div>
              </div>

              {r.tools.length > 0 && (
                <details className="mt-3">
                  <summary className="flex cursor-pointer items-center gap-1.5 text-[12px] font-semibold text-zinc-600">
                    <Wrench className="h-3.5 w-3.5" />
                    {r.tools.length === 1 ? '1 herramienta' : `${r.tools.length} herramientas`}:{' '}
                    {r.tools.map((t) => t.name).join(', ')}
                  </summary>
                  <ol className="mt-2 space-y-2">
                    {r.tools.map((t, i) => (
                      <li
                        key={`${t.name}-${i}`}
                        className="rounded-xl border border-(--color-border-subtle) p-3 text-[12px]"
                      >
                        <p className="font-semibold text-zinc-800">
                          {t.ok ? '✓' : '✗'} {t.name}
                          <span className="ml-2 font-normal text-zinc-500">
                            {Math.round(t.latencyMs)} ms
                          </span>
                        </p>
                        <p className="mt-1 break-all font-mono text-[11px] text-zinc-500">
                          {JSON.stringify(t.args)}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-zinc-700">
                          {t.error ?? t.result}
                        </p>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
