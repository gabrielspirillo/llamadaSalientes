import { Card, CardTopbar } from '@/components/ui/card';
import { ProgressRing } from '@/components/ui/stat';
import { cn } from '@/lib/cn';
import {
  type BreakEven,
  HEALTH_OVERALL_LABELS,
  type HealthReport,
  type SignalLevel,
  formatCents,
} from '@/lib/finance/model';
import { Activity, AlertTriangle, CheckCircle2, CircleDashed, Scale, XCircle } from 'lucide-react';

const LEVEL: Record<SignalLevel, { icon: typeof CheckCircle2; chip: string; label: string }> = {
  ok: { icon: CheckCircle2, chip: 'bg-emerald-100 text-emerald-700', label: 'Bien' },
  warn: { icon: AlertTriangle, chip: 'bg-amber-100 text-amber-700', label: 'Vigilar' },
  bad: { icon: XCircle, chip: 'bg-rose-100 text-rose-700', label: 'Mal' },
  na: { icon: CircleDashed, chip: 'bg-zinc-100 text-zinc-500', label: 'Sin dato' },
};

const OVERALL_TONE = {
  healthy: { ring: 'mint' as const, text: 'text-emerald-700', bg: 'bg-emerald-50' },
  watch: { ring: 'honey' as const, text: 'text-amber-700', bg: 'bg-amber-50' },
  risk: { ring: 'coral' as const, text: 'text-rose-700', bg: 'bg-rose-50' },
  na: { ring: 'grape' as const, text: 'text-zinc-600', bg: 'bg-zinc-50' },
};

/**
 * El semáforo: siete señales con su lectura y un veredicto. Cada señal lleva
 * icono + texto, nunca sólo color. Los umbrales están en `HEALTH_THRESHOLDS`.
 */
export function HealthCard({ report }: { report: HealthReport }) {
  const tone = OVERALL_TONE[report.overall];
  return (
    <Card className="h-full">
      <CardTopbar
        icon={<Activity className="h-4 w-4" />}
        tone="mint"
        title="Salud del negocio"
        subtitle="Siete señales que un analista miraría primero"
      />
      <div className="px-5 pb-5 sm:px-6 sm:pb-6">
        <div className={cn('mb-4 flex items-center gap-4 rounded-2xl p-4', tone.bg)}>
          <ProgressRing
            value={report.score ?? 0}
            size={72}
            stroke={7}
            tone={tone.ring}
            label={report.score === null ? '—' : String(report.score)}
          />
          <div className="min-w-0">
            <p className={cn('text-[18px] font-bold tracking-tight', tone.text)}>
              {HEALTH_OVERALL_LABELS[report.overall]}
            </p>
            <p className="mt-0.5 text-[13px] text-zinc-600">
              {report.score === null
                ? 'Registra ingresos y gastos para que el semáforo tenga con qué trabajar.'
                : `${report.signals.filter((s) => s.level === 'ok').length} señales en verde, ${report.signals.filter((s) => s.level === 'warn').length} en ámbar y ${report.signals.filter((s) => s.level === 'bad').length} en rojo.`}
            </p>
          </div>
        </div>
        <ul className="divide-y divide-(--color-border-subtle)">
          {report.signals.map((s) => {
            const meta = LEVEL[s.level];
            const Icon = meta.icon;
            return (
              <li key={s.key} className="flex items-start gap-3 py-3">
                <span
                  className={cn(
                    'mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                    meta.chip,
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-[14px] font-semibold text-zinc-800">{s.label}</p>
                    <p className="text-[14px] font-bold tabular-nums text-zinc-900">{s.value}</p>
                  </div>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-500">{s.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}

/** Cuántas sesiones al mes hacen falta para cubrir los fijos, y cuántas se hacen. */
export function BreakEvenCard({ be }: { be: BreakEven }) {
  const ratio = be.sessionsPerMonth
    ? Math.min(100, Math.round((be.sessionsPerMonthActual / be.sessionsPerMonth) * 100))
    : 0;
  return (
    <Card className="h-full">
      <CardTopbar
        icon={<Scale className="h-4 w-4" />}
        tone="honey"
        title="Punto de equilibrio"
        subtitle="Sesiones al mes para no perder dinero"
      />
      <div className="px-5 pb-5 sm:px-6 sm:pb-6">
        {be.sessionsPerMonth === null ? (
          <p className="text-[13px] leading-relaxed text-zinc-600">
            {be.avgTicketCents === null
              ? 'Sin sesiones cobradas en el período no se puede calcular. Cuando haya cobros, aquí sale cuántas sesiones al mes cubren los gastos fijos.'
              : be.fixedMonthlyCents === 0
                ? 'No hay gastos marcados como fijos. Marca en Ajustes los que se pagan haya o no pacientes (alquiler, cuota, seguros) y aquí sale el mínimo de sesiones al mes.'
                : 'El precio medio por sesión no cubre ni su coste variable. Ninguna cantidad de sesiones cubre los fijos: hay que revisar precios o costes.'}
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-[34px] font-bold leading-none tracking-tight text-zinc-900">
                {be.sessionsPerMonth}
              </span>
              <span className="text-[13px] text-zinc-500">sesiones/mes necesarias</span>
            </div>
            <p className="mt-2 text-[13px] text-zinc-600">
              Ahora mismo se hacen{' '}
              <strong className="text-zinc-900">{be.sessionsPerMonthActual}</strong> al mes.
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100">
              <div
                className={cn(
                  'bar-fill h-full rounded-full',
                  ratio >= 100
                    ? 'bg-[linear-gradient(90deg,#059669,#34d399)]'
                    : 'bg-[linear-gradient(90deg,#d97706,#fbbf24)]',
                )}
                style={{ width: `${ratio}%` }}
              />
            </div>
          </>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-2 text-[12px]">
          <div className="rounded-xl bg-[#fafbfb] p-2.5">
            <dt className="text-zinc-500">Fijos al mes</dt>
            <dd className="font-bold tabular-nums text-zinc-900">
              {formatCents(be.fixedMonthlyCents)}
            </dd>
          </div>
          <div className="rounded-xl bg-[#fafbfb] p-2.5">
            <dt className="text-zinc-500">Ticket medio</dt>
            <dd className="font-bold tabular-nums text-zinc-900">
              {be.avgTicketCents === null ? '—' : formatCents(be.avgTicketCents)}
            </dd>
          </div>
          <div className="rounded-xl bg-[#fafbfb] p-2.5">
            <dt className="text-zinc-500">Variable por sesión</dt>
            <dd className="font-bold tabular-nums text-zinc-900">
              {formatCents(be.variablePerSessionCents)}
            </dd>
          </div>
          <div className="rounded-xl bg-[#fafbfb] p-2.5">
            <dt className="text-zinc-500">Margen por sesión</dt>
            <dd className="font-bold tabular-nums text-zinc-900">
              {be.contributionCents === null ? '—' : formatCents(be.contributionCents)}
            </dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}
