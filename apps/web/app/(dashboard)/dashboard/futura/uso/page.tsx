import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardTopbar } from '@/components/ui/card';
import { Callout } from '@/components/ui/feedback';
import { Sparkline, StatTile } from '@/components/ui/stat';
import { HeadRow, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { SegmentedNav } from '@/components/ui/tabs';
import { getCurrentTenant } from '@/lib/tenant';
import { type ClinicUsage, formatMinutes, getUsageReport } from '@/lib/usage/report';
import { USAGE_SECTIONS, sectionLabel } from '@/lib/usage/sections';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock,
  Grid3x3,
  Layers,
  MousePointerClick,
  Users,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

const RANGES = [7, 30, 90] as const;

function pctDelta(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

function fmtDay(d: string | null): string {
  if (!d) return 'Nunca';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, day ?? 1)).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

const RISK: Record<
  ClinicUsage['risk'],
  { label: string; tone: 'danger' | 'warn' | 'neutral' } | null
> = {
  none: null,
  never: { label: 'Nunca entró', tone: 'neutral' },
  inactive: { label: 'Sin uso 7 días', tone: 'danger' },
  dropping: { label: 'Uso en caída', tone: 'warn' },
};

export default async function UsoPlataformaPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const { isSuperAdmin, realTenant } = await getCurrentTenant();
  if (!isSuperAdmin) notFound();
  const sp = await searchParams;
  const days = RANGES.find((r) => String(r) === sp.dias) ?? 30;

  const report = await getUsageReport({ days, excludeTenantId: realTenant.id });
  const { totals, clinics } = report;
  const atRisk = clinics.filter((c) => c.risk !== 'none');
  const usedSections = new Set(report.sections.map((s) => s.key));
  const unused = USAGE_SECTIONS.filter((s) => !usedSections.has(s.key) && s.key !== 'other');
  const maxSection = Math.max(1, ...report.sections.map((s) => s.minutes));
  const heatSections = report.sections.slice(0, 10);
  const activeClinics = clinics.filter((c) => c.minutes > 0);
  const maxAction = Math.max(1, ...report.actions.map((a) => a.total));

  return (
    <>
      <PageHeader
        eyebrow="Interno"
        icon={<BarChart3 className="h-5 w-5" />}
        title="Uso de la plataforma"
        description="Cuánto tiempo pasa cada clínica en el panel, qué usa, qué no y quién se está enfriando."
        actions={
          <Link
            href="/dashboard/futura"
            className="text-[13px] font-semibold text-brand-600 hover:underline"
          >
            ← Panel Futura
          </Link>
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <SegmentedNav
          activeValue={String(days)}
          items={RANGES.map((r) => ({
            value: String(r),
            label: `${r} días`,
            href: `/dashboard/futura/uso?dias=${r}`,
          }))}
        />
        <p className="text-[12px] text-zinc-500">
          Del {fmtDay(report.fromDay)} al {fmtDay(report.toDay)} · comparado con los {days} días
          anteriores. Tiempo activo: pestaña visible y alguien usándola.
        </p>
      </div>

      <div className="stagger mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="Tiempo de uso"
          value={
            totals.minutes >= 600
              ? `${Math.round(totals.minutes / 60).toLocaleString('es-ES')} h`
              : formatMinutes(totals.minutes)
          }
          delta={pctDelta(totals.minutes, totals.prevMinutes)}
          hint={`${formatMinutes(Math.round(totals.minutes / days))} al día de media`}
          icon={<Clock className="h-4 w-4" />}
          tone="grape"
        />
        <StatTile
          label="Clínicas activas"
          value={`${totals.activeClinics} / ${totals.totalClinics}`}
          hint="Con al menos un minuto en el período"
          icon={<Activity className="h-4 w-4" />}
          tone="mint"
          progress={totals.totalClinics ? (totals.activeClinics / totals.totalClinics) * 100 : 0}
        />
        <StatTile
          label="Usuarios activos"
          numeric={totals.activeUsers}
          hint={`${totals.avgDailyUsers.toLocaleString('es-ES')} de media al día`}
          icon={<Users className="h-4 w-4" />}
          tone="sky"
        />
        <StatTile
          label="Hábito (diarios / período)"
          value={`${Math.round(totals.stickiness * 100)} %`}
          hint="Más alto = entran a diario, no de vez en cuando"
          icon={<MousePointerClick className="h-4 w-4" />}
          tone="honey"
        />
        <StatTile
          label="Trabajo automatizado"
          value={`${Math.round(totals.automatedShare * 100)} %`}
          hint="Acciones hechas por asistentes y huecos recuperados"
          icon={<Zap className="h-4 w-4" />}
          tone="blossom"
        />
      </div>

      {atRisk.length > 0 && (
        <Callout tone="warn" className="mb-6" icon={<AlertTriangle className="h-4 w-4" />}>
          <strong>
            {atRisk.length === 1 ? '1 clínica' : `${atRisk.length} clínicas`} para llamar:
          </strong>{' '}
          {atRisk.map((c, i) => (
            <span key={c.tenantId}>
              {i > 0 && ' · '}
              {c.name} ({RISK[c.risk]?.label.toLowerCase()})
            </span>
          ))}
        </Callout>
      )}

      <Card className="mb-6 overflow-hidden">
        <CardTopbar
          icon={<Users className="h-4 w-4" />}
          title="Por clínica"
          subtitle="Ordenadas por tiempo de uso"
        />
        <TableWrap>
          <Table className="min-w-[900px]">
            <THead>
              <HeadRow>
                <TH>Clínica</TH>
                <TH className="text-right">Tiempo</TH>
                <TH className="text-right">Por día activo</TH>
                <TH className="text-right">Días activos</TH>
                <TH className="text-right">Usuarios</TH>
                <TH>Lo que más usa</TH>
                <TH>Último uso</TH>
                <TH className="w-[140px]">Tendencia</TH>
              </HeadRow>
            </THead>
            <tbody>
              {clinics.map((c) => {
                const delta = pctDelta(c.minutes, c.prevMinutes);
                const risk = RISK[c.risk];
                return (
                  <TR key={c.tenantId}>
                    <TD>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-zinc-900">{c.name}</span>
                        {risk && <Badge tone={risk.tone}>{risk.label}</Badge>}
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap text-right font-semibold tabular-nums text-zinc-900">
                      {formatMinutes(c.minutes)}
                      {delta != null && (
                        <span
                          className={`ml-1.5 text-[11px] font-bold ${delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}
                        >
                          {delta > 0 ? `+${delta}` : delta}%
                        </span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-right tabular-nums">
                      {c.activeDays ? formatMinutes(c.avgMinutesPerActiveDay) : '—'}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {c.activeDays} / {days}
                    </TD>
                    <TD className="text-right tabular-nums">{c.activeUsers}</TD>
                    <TD className="whitespace-nowrap">
                      {c.topSection ? sectionLabel(c.topSection) : '—'}
                    </TD>
                    <TD className="whitespace-nowrap">{fmtDay(c.lastSeenDay)}</TD>
                    <TD>
                      {c.daily.some((v) => v > 0) ? (
                        <Sparkline data={c.daily} height={28} />
                      ) : (
                        <span className="text-[12px] text-zinc-400">Sin datos</span>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="p-5">
          <CardTopbar
            icon={<Layers className="h-4 w-4" />}
            title="Secciones: tiempo y adopción"
            subtitle="Qué parte del panel se usa y en cuántas clínicas"
            className="mb-4 p-0"
          />
          {report.sections.length === 0 ? (
            <p className="text-[13px] text-zinc-500">
              Todavía no hay uso registrado en el período.
            </p>
          ) : (
            <ul className="space-y-3">
              {report.sections.map((s) => {
                const share = totals.minutes ? Math.round((s.minutes / totals.minutes) * 100) : 0;
                return (
                  <li key={s.key}>
                    <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="font-semibold text-zinc-800">{s.label}</span>
                      <span className="tabular-nums text-zinc-500">
                        {formatMinutes(s.minutes)} · {share} % ·{' '}
                        <span className="font-semibold text-zinc-700">
                          {s.clinics}/{totals.totalClinics}
                        </span>{' '}
                        clínicas
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className="bar-fill h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600"
                        style={{ width: `${(s.minutes / maxSection) * 100}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {unused.length > 0 && (
            <div className="mt-5 border-t border-(--color-border-subtle) pt-4">
              <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                Sin uso en el período
              </p>
              <div className="flex flex-wrap gap-1.5">
                {unused.map((s) => (
                  <Badge key={s.key} tone="neutral">
                    {s.label}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <CardTopbar
            icon={<Zap className="h-4 w-4" />}
            title="Qué hacen con la plataforma"
            subtitle="Acciones del período, sumadas en todas las clínicas"
            className="mb-4 p-0"
          />
          <ul className="space-y-3">
            {report.actions.map((a) => (
              <li key={a.key}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="flex items-center gap-2 font-semibold text-zinc-800">
                    {a.label}
                    {a.automated && <Badge tone="success">Automático</Badge>}
                  </span>
                  <span className="tabular-nums text-zinc-500">
                    <span className="font-semibold text-zinc-800">
                      {a.total.toLocaleString('es-ES')}
                    </span>{' '}
                    · {a.clinics}/{totals.totalClinics} clínicas
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className={`bar-fill h-full rounded-full ${a.automated ? 'bg-emerald-500' : 'bg-sky-500'}`}
                    style={{ width: `${(a.total / maxAction) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {activeClinics.length > 0 && heatSections.length > 0 && (
        <Card className="mb-6 overflow-hidden">
          <CardTopbar
            icon={<Grid3x3 className="h-4 w-4" />}
            title="Mapa de calor: clínica × sección"
            subtitle="Minutos en el período. Una celda vacía es una función que esa clínica no usa"
          />
          <TableWrap>
            <Table className="min-w-[760px]">
              <THead>
                <HeadRow>
                  <TH>Clínica</TH>
                  {heatSections.map((s) => (
                    <TH key={s.key} className="text-center normal-case tracking-normal">
                      {s.label}
                    </TH>
                  ))}
                </HeadRow>
              </THead>
              <tbody>
                {activeClinics.map((c) => (
                  <TR key={c.tenantId}>
                    <TD className="whitespace-nowrap font-semibold text-zinc-900">{c.name}</TD>
                    {heatSections.map((s) => {
                      const m = c.bySection[s.key] ?? 0;
                      const share = c.minutes ? m / c.minutes : 0;
                      return (
                        <TD key={s.key} className="p-1.5 text-center">
                          <div
                            className="rounded-lg px-2 py-1.5 text-[12px] font-semibold tabular-nums"
                            style={{
                              background: m
                                ? `rgba(47, 133, 110, ${0.1 + share * 0.75})`
                                : 'transparent',
                              color: share > 0.4 ? '#fff' : m ? '#1f5a4a' : '#c4c4cc',
                            }}
                            title={`${c.name} · ${s.label}: ${formatMinutes(m)}`}
                          >
                            {m ? formatMinutes(m) : '·'}
                          </div>
                        </TD>
                      );
                    })}
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}

      <p className="text-[12px] text-zinc-500">
        Se cuenta un minuto por cada minuto con la pestaña visible y actividad (ratón, teclado,
        scroll) en los últimos 3 minutos. Las visitas de Futura no cuentan. Las clínicas archivadas
        no salen.
      </p>
    </>
  );
}
