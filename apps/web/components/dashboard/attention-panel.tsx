import { patientKeyForPerson } from '@/lib/agenda/patients';
import type { AttentionData } from '@/lib/data/attention';
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  MessageCircle,
  Phone,
} from 'lucide-react';
import Link from 'next/link';

function ago(date: Date, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000));
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
}

/**
 * "Requiere atención": lo que espera a una persona, arriba del todo y en
 * oscuro para que no se pierda entre las métricas. Chats derivados o urgentes
 * sin contestar, citas de hoy sin confirmar y avisos médicos sin valorar.
 */
export function AttentionPanel({
  data,
  timezone,
}: {
  data: AttentionData;
  timezone: string;
}) {
  const now = new Date();
  const total = data.handoffs.length + data.confirmations.length + data.reviews.length;
  const hora = (d: Date) =>
    d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: timezone });

  if (total === 0) {
    return (
      <div className="mb-6 flex animate-fade-up items-center gap-3 rounded-[22px] border border-emerald-200 bg-[linear-gradient(135deg,#ecfdf5,#f0fdfa)] px-5 py-3.5">
        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        <p className="text-[14px] font-semibold text-emerald-900">
          Todo al día: ninguna derivación esperando ni cita sin confirmar.
        </p>
      </div>
    );
  }

  return (
    <section
      aria-label="Requiere atención"
      className="relative mb-6 animate-fade-up overflow-hidden rounded-[26px] bg-[linear-gradient(135deg,#0f2620_0%,#173a31_55%,#1f4a3e_100%)] p-5 text-white shadow-[0_30px_80px_-40px_rgba(15,38,32,0.9)] sm:p-6"
    >
      {/* Brillos de fondo: decoración, no contenido. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 animate-drift rounded-full bg-[radial-gradient(circle,rgba(251,191,36,0.28),transparent_65%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 left-1/3 h-72 w-72 animate-float-slow rounded-full bg-[radial-gradient(circle,rgba(52,211,153,0.22),transparent_65%)]"
      />

      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400/20 text-amber-300 ring-1 ring-amber-300/40">
            <span className="absolute inset-0 animate-pulse-ring rounded-2xl ring-2 ring-amber-300/50" />
            <BellRing className="h-5 w-5 animate-wave" />
          </span>
          <div>
            <h2 className="text-[19px] font-bold tracking-tight">Requiere tu atención</h2>
            <p className="text-[13px] text-emerald-100/80">
              Lo que el asistente ha dejado en manos del equipo
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-[13px] font-bold ring-1 ring-white/15">
          <span className="h-2 w-2 animate-pulse-soft rounded-full bg-amber-400" />
          {total} pendiente{total === 1 ? '' : 's'}
        </span>
      </div>

      <div className="relative mt-5 grid gap-4 lg:grid-cols-3">
        <Column
          title="Derivaciones esperando"
          icon={<MessageCircle className="h-4 w-4" />}
          empty="Nadie esperando respuesta."
          count={data.handoffs.length}
        >
          {data.handoffs.map((h, i) => (
            <Item
              key={h.conversationId}
              index={i}
              href={`/dashboard/whatsapp/${h.conversationId}`}
              title={h.name}
              badge={h.urgent ? 'Urgente' : undefined}
              detail={h.preview ? `“${h.preview.slice(0, 90)}”` : 'Pidió hablar con una persona'}
              meta={ago(h.since, now)}
              action="Contestar"
            />
          ))}
        </Column>

        <Column
          title="Sin confirmar hoy"
          icon={<Phone className="h-4 w-4" />}
          empty="Todas las citas de hoy confirmadas."
          count={data.confirmations.length}
        >
          {data.confirmations.map((c, i) => (
            <Item
              key={c.appointmentId}
              index={i}
              href={c.phone ? `tel:${c.phone}` : '/dashboard/agenda'}
              title={`${hora(c.startsAt)} · ${c.patientName}`}
              detail={
                c.callsDone > 0
                  ? `Sin respuesta al recordatorio · llamar (aviso ${c.callsDone})`
                  : 'Recordatorio enviado, sin respuesta'
              }
              meta={c.phone ?? ''}
              action="Llamar"
            />
          ))}
        </Column>

        <Column
          title="Avisos médicos sin valorar"
          icon={<AlertTriangle className="h-4 w-4" />}
          empty="Ningún aviso pendiente."
          count={data.reviews.length}
        >
          {data.reviews.map((r, i) => (
            <Item
              key={r.patientId}
              index={i}
              href={`/dashboard/agenda/pacientes/${encodeURIComponent(patientKeyForPerson(r.patientId))}`}
              title={r.name}
              detail={r.reason ?? 'Necesita que alguien lo valore antes de dar cita'}
              action="Ver ficha"
            />
          ))}
        </Column>
      </div>
    </section>
  );
}

function Column({
  title,
  icon,
  count,
  empty,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[20px] bg-white/[0.06] p-3 ring-1 ring-white/10 backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="inline-flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-emerald-100/90">
          {icon}
          {title}
        </span>
        <span
          className={
            count > 0
              ? 'rounded-full bg-amber-400 px-2 py-0.5 text-[12px] font-bold text-[#0f2620]'
              : 'rounded-full bg-white/10 px-2 py-0.5 text-[12px] font-bold text-white/60'
          }
        >
          {count}
        </span>
      </div>
      {count === 0 ? (
        <p className="px-1 py-3 text-[13px] text-emerald-100/60">{empty}</p>
      ) : (
        <ul className="stagger space-y-2">{children}</ul>
      )}
    </div>
  );
}

function Item({
  index,
  href,
  title,
  detail,
  meta,
  badge,
  action,
}: {
  index: number;
  href: string;
  title: string;
  detail: string;
  meta?: string;
  badge?: string;
  action: string;
}) {
  return (
    <li style={{ '--i': index } as React.CSSProperties}>
      <Link
        href={href}
        prefetch={false}
        className="group block rounded-2xl bg-white/[0.07] px-3 py-2.5 ring-1 ring-white/10 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/[0.13] hover:ring-amber-300/40"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[14px] font-semibold">{title}</span>
            {badge && (
              <span className="shrink-0 animate-pulse-soft rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-bold">
                {badge}
              </span>
            )}
          </span>
          {meta && <span className="shrink-0 text-[12px] text-emerald-100/60">{meta}</span>}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[13px] text-emerald-50/80">{detail}</p>
        <span className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-bold text-amber-300">
          {action}
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-1" />
        </span>
      </Link>
    </li>
  );
}
