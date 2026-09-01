'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardTopbar } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { Reveal } from '@/components/ui/motion';
import { Avatar, StatTile } from '@/components/ui/stat';
import { HeadRow, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import type { MessagingAnalytics } from '@/lib/data/analytics/messaging';
import {
  AlertTriangle,
  AtSign,
  CheckSquare,
  Clock,
  MessageSquare,
  Timer,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  axisProps,
  chartAnim,
  chartPalette,
  gridProps,
  tooltipCursor,
  tooltipStyle,
} from './chart-theme';

/**
 * Pestaña "Equipo" de Analytics — el chat visto desde el otro lado (§8.7).
 *
 * Las cuatro métricas de arriba responden la misma pregunta: cuánto tarda el
 * equipo en tomar lo que aparece, y qué se está cayendo por el agujero.
 *
 * `data === null` significa que la lectura falló (típicamente: la migración del
 * módulo todavía no corrió). No es un error que valga la pena gritar en una
 * pestaña de métricas: se muestra el mismo estado vacío y listo.
 */
export function MessagingAnalyticsPanel({ data }: { data: MessagingAnalytics | null }) {
  if (!data) {
    return (
      <Card>
        <EmptyState
          icon={<MessageSquare className="h-5 w-5" />}
          title="Mensajes todavía no está activo"
          description="Cuando el equipo empiece a usar el chat interno, acá aparecen los tiempos de reacción, las menciones abiertas y las franjas de más actividad."
        />
      </Card>
    );
  }

  const sinActividad = data.totalMessages === 0 && data.eventsTotal === 0;
  if (sinActividad) {
    return (
      <Card>
        <EmptyState
          icon={<MessageSquare className="h-5 w-5" />}
          title="Sin actividad en este rango"
          description="Todavía no hay mensajes ni tarjetas de evento en el período seleccionado."
        />
      </Card>
    );
  }

  const attendedRate =
    data.eventsTotal === 0
      ? 100
      : Math.round(((data.eventsTotal - data.eventsIgnored) / data.eventsTotal) * 100);
  const ratioPct = Math.round(data.messageToTaskRatio * 100);
  const hourTrend = data.byHour.map((h) => h.messages);

  return (
    <>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        <Reveal delay={0}>
          <StatTile
            label="Reacción a un evento"
            value={formatDuration(data.reaction.medianSeconds)}
            hint={
              data.reaction.samples === 0
                ? 'Sin tarjetas con respuesta'
                : `Mediana · p90 ${formatDuration(data.reaction.p90Seconds)}`
            }
            icon={<Timer className="h-4 w-4" />}
            tone="grape"
          />
        </Reveal>
        <Reveal delay={70}>
          <StatTile
            label="Eventos sin reacción"
            numeric={data.eventsIgnored}
            hint={
              data.eventsTotal === 0
                ? 'Sin tarjetas en el rango'
                : `${attendedRate}% atendidos de ${data.eventsTotal}`
            }
            icon={<AlertTriangle className="h-4 w-4" />}
            tone={data.eventsIgnored > 0 ? 'coral' : 'mint'}
            progress={attendedRate}
          />
        </Reveal>
        <Reveal delay={140}>
          <StatTile
            label="Menciones sin resolver"
            numeric={data.openMentions}
            hint={
              data.mentionsByPerson.length === 0
                ? 'Nadie con pendientes'
                : `${data.mentionsByPerson.length} ${data.mentionsByPerson.length === 1 ? 'persona' : 'personas'} con pendientes`
            }
            icon={<AtSign className="h-4 w-4" />}
            tone={data.openMentions > 0 ? 'honey' : 'mint'}
          />
        </Reveal>
        <Reveal delay={210}>
          <StatTile
            label="Mensajes → tareas"
            numeric={ratioPct}
            suffix="%"
            hint={`${data.tasksFromMessages} de ${data.totalMessages} mensajes`}
            icon={<CheckSquare className="h-4 w-4" />}
            tone="sky"
            progress={Math.min(100, ratioPct)}
            trend={hourTrend.some((v) => v > 0) ? hourTrend : undefined}
          />
        </Reveal>
      </div>

      <div className="space-y-6">
        <Reveal>
          <Card>
            <CardTopbar
              icon={<Clock className="h-4 w-4" />}
              tone="sky"
              title="Actividad por franja horaria"
              subtitle="Mensajes internos por hora del día"
              action={<Badge tone="info">{data.timezone}</Badge>}
            />
            <div className="px-2 pb-5 sm:px-4 sm:pb-6">
              <HourHistogram data={data.byHour} />
            </div>
          </Card>
        </Reveal>

        <Reveal>
          <Card>
            <CardTopbar
              icon={<Users className="h-4 w-4" />}
              tone="honey"
              title="Menciones abiertas por persona"
              subtitle="Sobrecarga individual, antes de que alguien reviente"
              action={
                data.openMentions > 0 ? (
                  <Badge tone="warn">{data.openMentions} sin resolver</Badge>
                ) : (
                  <Badge tone="success">Al día</Badge>
                )
              }
            />
            {data.mentionsByPerson.length === 0 ? (
              <EmptyState
                icon={<AtSign className="h-5 w-5" />}
                title="Ninguna mención pendiente"
                description="Todo lo que se pidió por nombre en el chat está resuelto."
              />
            ) : (
              <div className="pb-2">
                <TableWrap>
                  <Table>
                    <THead>
                      <HeadRow>
                        <TH>Persona</TH>
                        <TH className="text-right">Abiertas</TH>
                        <TH className="text-right">Sin leer</TH>
                        <TH>Más antigua</TH>
                      </HeadRow>
                    </THead>
                    <tbody>
                      {data.mentionsByPerson.map((p) => (
                        <TR key={p.userId}>
                          <TD>
                            <span className="flex items-center gap-2.5">
                              <Avatar name={p.name} size={28} />
                              <span className="min-w-0">
                                <span className="block truncate font-semibold text-zinc-800">
                                  {p.name}
                                </span>
                                <span className="block truncate text-[12px] text-zinc-500">
                                  {p.email}
                                </span>
                              </span>
                            </span>
                          </TD>
                          <TD className="text-right tabular-nums font-semibold">{p.open}</TD>
                          <TD className="text-right tabular-nums">
                            {p.unread > 0 ? (
                              <Badge tone="warn">{p.unread}</Badge>
                            ) : (
                              <span className="text-zinc-400">0</span>
                            )}
                          </TD>
                          <TD className="text-[13px] text-zinc-500">{formatAge(p.oldestAt)}</TD>
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              </div>
            )}
          </Card>
        </Reveal>
      </div>
    </>
  );
}

/**
 * Histograma de 24 bins. Las horas con más tráfico se pintan en violeta pleno y
 * las flojas en lila: el pico se ve sin leer los números.
 */
function HourHistogram({ data }: { data: MessagingAnalytics['byHour'] }) {
  const max = Math.max(1, ...data.map((h) => h.messages));
  const chartData = data.map((h) => ({
    label: `${String(h.hour).padStart(2, '0')}h`,
    Mensajes: h.messages,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="label" {...axisProps} interval={1} />
        <YAxis {...axisProps} width={32} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} />
        <Bar dataKey="Mensajes" radius={[8, 8, 3, 3]} {...chartAnim}>
          {chartData.map((d) => (
            <Cell
              key={d.label}
              fill={d.Mensajes >= max * 0.6 ? chartPalette.brand : chartPalette.lilac}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Segundos → "42 s" / "6 min" / "2 h 10 min". `null` → em dash. */
function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 90) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** ISO → "hace 3 días". Sin librería de fechas: no hace falta. */
function formatAge(iso: string | null): string {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return '—';
  const minutes = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'hace 1 día' : `hace ${days} días`;
}
