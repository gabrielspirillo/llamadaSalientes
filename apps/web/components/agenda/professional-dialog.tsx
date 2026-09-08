'use client';

import {
  type TreatmentOptionData,
  createProfessionalAction,
  createTreatmentQuickAction,
  listTeamCandidatesAction,
  listTreatmentOptionsAction,
  saveScheduleAction,
  setProfessionalTreatmentsAction,
  updateProfessionalAction,
} from '@/app/(dashboard)/dashboard/agenda/actions';
import {
  ScheduleFields,
  type ShiftRowValue,
  horarioPorDefecto,
} from '@/components/agenda/schedule-fields';
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
import { Input, Label, Select, Switch } from '@/components/ui/input';
import { PROFESSIONAL_COLORS } from '@/lib/agenda/shared';
import type { TeamCandidate } from '@/lib/agenda/team';
import { cn } from '@/lib/cn';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Loader2, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

export interface ProfessionalFormValues {
  id?: string;
  fullName: string;
  email: string;
  phone: string;
  specialty: string;
  licenseNumber: string;
  color: string;
  agendaEnabled: boolean;
  acceptsOnlineBooking: boolean;
  panelAccess: 'AGENDA_ONLY' | 'FULL';
  /** Null = automático: las citas van una detrás de otra. */
  slotGranularityMinutes: number | null;
  bufferMinutes: number;
  minNoticeHours: number;
  maxAdvanceDays: number;
  linkUserEmail: string;
}

const EMPTY: ProfessionalFormValues = {
  fullName: '',
  email: '',
  phone: '',
  specialty: '',
  licenseNumber: '',
  color: PROFESSIONAL_COLORS[0],
  agendaEnabled: true,
  acceptsOnlineBooking: true,
  panelAccess: 'AGENDA_ONLY',
  slotGranularityMinutes: null,
  bufferMinutes: 0,
  minNoticeHours: 2,
  maxAdvanceDays: 90,
  linkUserEmail: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// Pasos
//
// Un formulario de dieciséis campos en una sola pantalla obliga a hacer scroll
// dentro del diálogo y esconde el botón de guardar. El alta se parte en pasos
// cortos, cada uno con una sola pregunta.
//
// Al EDITAR no aparecen tratamientos ni horario: esos dos ya tienen su propio
// editor en la ficha del profesional, con el histórico delante. Repetirlos aquí
// daría dos sitios donde cambiar lo mismo.
// ─────────────────────────────────────────────────────────────────────────────

export type PasoId = 'persona' | 'acceso' | 'tratamientos' | 'horario' | 'huecos';

/**
 * El título es el rótulo del paso en la barra de progreso, así que va corto: si
 * no cabe se corta a la mitad y deja de decir nada. El detalle va en `ayuda`,
 * que se lee entera bajo el encabezado.
 */
export const PASOS: Record<PasoId, { titulo: string; ayuda: string }> = {
  persona: { titulo: 'Quién', ayuda: 'Elige a alguien del equipo o cárgalo a mano.' },
  acceso: { titulo: 'Acceso', ayuda: 'Si entra a la plataforma, qué ve al hacerlo.' },
  tratamientos: { titulo: 'Qué hace', ayuda: 'Los tratamientos que realiza, del catálogo.' },
  horario: { titulo: 'Horario', ayuda: 'Los días y las horas en que se le dan citas.' },
  huecos: { titulo: 'Huecos', ayuda: 'Duración de la rejilla, avisos y reservas.' },
};

/** Los pasos que se enseñan según el caso. Puro: se testea sin montar nada. */
export function pasosPara(modo: 'alta' | 'edicion'): PasoId[] {
  return modo === 'alta'
    ? ['persona', 'acceso', 'tratamientos', 'horario', 'huecos']
    : ['persona', 'acceso', 'huecos'];
}

/** Qué falta para poder pasar del paso actual. Null = se puede seguir. */
export function loQueFalta(paso: PasoId, values: ProfessionalFormValues): string | null {
  if (paso === 'persona' && values.fullName.trim().length < 2) {
    return 'Elige a alguien del equipo o escribe su nombre.';
  }
  if (paso === 'acceso' && values.linkUserEmail.trim() && !values.linkUserEmail.includes('@')) {
    return 'El email del usuario del panel no es válido.';
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────

export function ProfessionalDialog({
  trigger,
  professional,
}: {
  trigger: React.ReactNode;
  professional?: Partial<ProfessionalFormValues> & { id: string };
}) {
  const router = useRouter();
  const modo: 'alta' | 'edicion' = professional?.id ? 'edicion' : 'alta';
  const pasos = React.useMemo(() => pasosPara(modo), [modo]);

  const [open, setOpen] = React.useState(false);
  const [indice, setIndice] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [aviso, setAviso] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const [values, setValues] = React.useState<ProfessionalFormValues>({ ...EMPTY, ...professional });

  const [equipo, setEquipo] = React.useState<TeamCandidate[]>([]);
  const [catalogo, setCatalogo] = React.useState<TreatmentOptionData[]>([]);
  const [cargando, setCargando] = React.useState(false);
  const [elegidos, setElegidos] = React.useState<Map<string, number | null>>(new Map());
  const [horario, setHorario] = React.useState<ShiftRowValue[]>([]);

  const paso = pasos[indice] ?? 'persona';
  const esUltimo = indice === pasos.length - 1;

  // Al abrir se carga lo que el asistente necesita: el equipo (para no teclear
  // a nadie) y el catálogo (para marcar qué hace). Sólo al abrir: cargarlo en
  // el render de la lista pagaría la llamada a Clerk en cada navegación.
  React.useEffect(() => {
    if (!open) return;
    let cancelado = false;
    setCargando(true);
    Promise.all([
      listTeamCandidatesAction(),
      modo === 'alta' ? listTreatmentOptionsAction() : Promise.resolve(null),
    ])
      .then(([equipoRes, catalogoRes]) => {
        if (cancelado) return;
        if (equipoRes.ok) setEquipo(equipoRes.data);
        if (catalogoRes?.ok) setCatalogo(catalogoRes.data.filter((t) => t.active !== false));
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [open, modo]);

  function reset() {
    setIndice(0);
    setError(null);
    setAviso(null);
    setValues({ ...EMPTY, ...professional });
    setElegidos(new Map());
    setHorario(modo === 'alta' ? horarioPorDefecto() : []);
  }

  function abrir(next: boolean) {
    setOpen(next);
    if (next) reset();
  }

  function set<K extends keyof ProfessionalFormValues>(key: K, value: ProfessionalFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setError(null);
  }

  /** Rellena la ficha con los datos que Clerk ya tiene de esa persona. */
  function elegirDelEquipo(clerkUserId: string) {
    const persona = equipo.find((m) => m.clerkUserId === clerkUserId);
    if (!persona) {
      setValues((v) => ({ ...v, linkUserEmail: '' }));
      return;
    }
    setValues((v) => ({
      ...v,
      fullName: persona.fullName,
      email: persona.email,
      phone: persona.phone ?? v.phone,
      // Elegir a alguien del equipo vincula su usuario: es justo lo que hace
      // que después vea su propia agenda al entrar.
      linkUserEmail: persona.email,
    }));
    setError(null);
  }

  function siguiente() {
    const falta = loQueFalta(paso, values);
    if (falta) {
      setError(falta);
      return;
    }
    setError(null);
    setIndice((i) => Math.min(i + 1, pasos.length - 1));
  }

  function guardar() {
    const falta = loQueFalta(paso, values);
    if (falta) {
      setError(falta);
      return;
    }
    setError(null);
    setAviso(null);

    const payload = {
      fullName: values.fullName,
      email: values.email,
      phone: values.phone,
      specialty: values.specialty,
      licenseNumber: values.licenseNumber,
      color: values.color,
      agendaEnabled: values.agendaEnabled,
      acceptsOnlineBooking: values.acceptsOnlineBooking,
      panelAccess: values.panelAccess,
      // Null = automático. `Number(null)` es 0 y el servidor lo rechazaba por
      // debajo del mínimo: la rejilla vacía tiene que viajar como null.
      slotGranularityMinutes:
        values.slotGranularityMinutes === null ? null : Number(values.slotGranularityMinutes),
      bufferMinutes: Number(values.bufferMinutes),
      minNoticeHours: Number(values.minNoticeHours),
      maxAdvanceDays: Number(values.maxAdvanceDays),
      linkUserEmail: values.linkUserEmail ? values.linkUserEmail : null,
    };

    startTransition(async () => {
      if (professional?.id) {
        const result = await updateProfessionalAction(professional.id, payload);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setOpen(false);
        router.refresh();
        return;
      }

      const result = await createProfessionalAction(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const id = result.data.id;

      // El profesional ya existe. Si algo de lo accesorio falla, no se tira el
      // alta: se avisa de qué quedó pendiente y se puede rematar en su ficha.
      const pendientes: string[] = [];

      if (elegidos.size > 0) {
        const res = await setProfessionalTreatmentsAction(
          id,
          [...elegidos.entries()].map(([treatmentId, durationOverrideMinutes]) => ({
            treatmentId,
            durationOverrideMinutes,
          })),
        );
        if (!res.ok) pendientes.push(`tratamientos (${res.error})`);
      }

      if (horario.length > 0) {
        const res = await saveScheduleAction(
          id,
          horario.map((r) => ({
            weekday: r.weekday,
            startMinute: r.startMinute,
            endMinute: r.endMinute,
          })),
        );
        if (!res.ok) pendientes.push(`horario (${res.error})`);
      }

      if (pendientes.length > 0) {
        setAviso(
          `Se creó ${values.fullName}, pero quedó pendiente: ${pendientes.join(' y ')}. Termínalo en su ficha.`,
        );
        router.refresh();
        return;
      }

      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={abrir}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {modo === 'edicion' ? 'Editar profesional' : 'Nuevo profesional'}
          </DialogTitle>
          <DialogDescription>
            Paso {indice + 1} de {pasos.length} · {PASOS[paso].ayuda}
          </DialogDescription>
        </DialogHeader>

        <Stepper pasos={pasos} indice={indice} onIr={(i) => i <= indice && setIndice(i)} />

        {/* Alto fijo: que el diálogo no salte de tamaño al cambiar de paso. */}
        <div className="mt-4 min-h-[360px]">
          {paso === 'persona' && (
            <PasoPersona
              values={values}
              set={set}
              equipo={equipo}
              cargando={cargando}
              onElegir={elegirDelEquipo}
            />
          )}
          {paso === 'acceso' && <PasoAcceso values={values} set={set} equipo={equipo} />}
          {paso === 'tratamientos' && (
            <PasoTratamientos
              catalogo={catalogo}
              setCatalogo={setCatalogo}
              elegidos={elegidos}
              setElegidos={setElegidos}
              cargando={cargando}
            />
          )}
          {paso === 'horario' && (
            <div>
              <p className="mb-3 text-[13px] text-zinc-500">
                Varias franjas por día: la comida es el hueco entre dos. Se puede afinar después en
                su ficha.
              </p>
              <ScheduleFields rows={horario} onChange={setHorario} />
            </div>
          )}
          {paso === 'huecos' && <PasoHuecos values={values} set={set} />}
        </div>

        {aviso && (
          <p className="mt-3 rounded-[14px] bg-amber-50 p-3 text-[13px] text-amber-800">{aviso}</p>
        )}
        {error && (
          <p className="mt-3 flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        <DialogFooter className="mt-5 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            onClick={() => (indice === 0 ? setOpen(false) : setIndice((i) => i - 1))}
            disabled={pending}
          >
            {indice === 0 ? (
              'Cancelar'
            ) : (
              <>
                <ArrowLeft className="h-4 w-4" /> Atrás
              </>
            )}
          </Button>

          <div className="flex items-center gap-2">
            {/* Al editar se puede guardar desde cualquier paso: no hay nada que
                completar, sólo cambios sueltos. */}
            {modo === 'edicion' && !esUltimo && (
              <Button variant="soft" onClick={guardar} disabled={pending}>
                {pending && <Loader2 className="h-4 w-4 animate-spin" />} Guardar cambios
              </Button>
            )}
            {esUltimo ? (
              <Button onClick={guardar} disabled={pending}>
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {modo === 'edicion' ? 'Guardar cambios' : 'Crear profesional'}
              </Button>
            ) : (
              <Button onClick={siguiente} disabled={pending}>
                Siguiente <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Piezas de cada paso ─────────────────────────────────────────────────────

function Stepper({
  pasos,
  indice,
  onIr,
}: {
  pasos: PasoId[];
  indice: number;
  onIr: (i: number) => void;
}) {
  return (
    <ol className="mt-4 flex items-center gap-1.5">
      {pasos.map((p, i) => {
        const hecho = i < indice;
        const activo = i === indice;
        return (
          <li key={p} className="flex min-w-0 flex-1 items-center gap-1.5">
            <button
              type="button"
              onClick={() => onIr(i)}
              disabled={i > indice}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2 rounded-full px-2.5 py-1.5 text-left transition-colors',
                activo && 'bg-brand-50',
                i > indice ? 'cursor-default' : 'hover:bg-zinc-50',
              )}
            >
              <span
                className={cn(
                  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold',
                  activo && 'bg-brand-600 text-white',
                  hecho && 'bg-emerald-100 text-emerald-700',
                  !activo && !hecho && 'bg-zinc-100 text-zinc-400',
                )}
              >
                {hecho ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span
                className={cn(
                  'hidden truncate text-[12px] font-semibold sm:block',
                  activo ? 'text-brand-800' : 'text-zinc-500',
                )}
              >
                {PASOS[p].titulo}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function PasoPersona({
  values,
  set,
  equipo,
  cargando,
  onElegir,
}: {
  values: ProfessionalFormValues;
  set: <K extends keyof ProfessionalFormValues>(k: K, v: ProfessionalFormValues[K]) => void;
  equipo: TeamCandidate[];
  cargando: boolean;
  onElegir: (clerkUserId: string) => void;
}) {
  const seleccionado = equipo.find((m) => m.email === values.linkUserEmail);

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="pf-equipo">Del equipo</Label>
        <Select
          id="pf-equipo"
          value={seleccionado?.clerkUserId ?? ''}
          disabled={cargando}
          onChange={(e) => onElegir(e.target.value)}
        >
          <option value="">
            {cargando ? 'Cargando el equipo…' : 'Cargar a mano (no está en el panel)'}
          </option>
          {equipo.map((m) => (
            <option key={m.clerkUserId} value={m.clerkUserId} disabled={m.alreadyProfessional}>
              {m.fullName} · {m.email}
              {m.alreadyProfessional ? ' · ya es profesional' : ''}
            </option>
          ))}
        </Select>
        <p className="text-[12px] text-zinc-500">
          {equipo.length === 0 && !cargando
            ? 'Todavía no hay nadie más en el panel. Invítalo desde Equipo y aparecerá aquí.'
            : 'Al elegir a alguien se rellenan sus datos y se vincula su usuario.'}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="pf-name">Nombre completo</Label>
          <Input
            id="pf-name"
            value={values.fullName}
            onChange={(e) => set('fullName', e.target.value)}
            placeholder="Dra. Marta Ruiz"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pf-spec">Especialidad</Label>
          <Input
            id="pf-spec"
            value={values.specialty}
            onChange={(e) => set('specialty', e.target.value)}
            placeholder="Ortodoncia"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pf-email">Email</Label>
          <Input
            id="pf-email"
            type="email"
            value={values.email}
            onChange={(e) => set('email', e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pf-phone">Teléfono</Label>
          <Input
            id="pf-phone"
            value={values.phone}
            onChange={(e) => set('phone', e.target.value)}
            placeholder="+34 600 000 000"
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label>Color en el calendario</Label>
        <div className="flex flex-wrap gap-2">
          {PROFESSIONAL_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              onClick={() => set('color', c)}
              className={cn(
                'h-7 w-7 rounded-full ring-2 transition-transform',
                values.color === c ? 'scale-110 ring-zinc-900' : 'ring-transparent',
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PasoAcceso({
  values,
  set,
  equipo,
}: {
  values: ProfessionalFormValues;
  set: <K extends keyof ProfessionalFormValues>(k: K, v: ProfessionalFormValues[K]) => void;
  equipo: TeamCandidate[];
}) {
  const vinculado = equipo.find((m) => m.email === values.linkUserEmail);

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="pf-user">Email del usuario del panel</Label>
        <Input
          id="pf-user"
          type="email"
          value={values.linkUserEmail}
          onChange={(e) => set('linkUserEmail', e.target.value)}
          placeholder="Ya invitado desde Equipo"
        />
        <p className="text-[12px] text-zinc-500">
          {vinculado
            ? `Se vinculará con la cuenta de ${vinculado.fullName}.`
            : 'Déjalo vacío si el profesional no entra al panel: la clínica llevará su agenda igualmente.'}
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="pf-access">Qué ve al entrar</Label>
        <Select
          id="pf-access"
          value={values.panelAccess}
          onChange={(e) => set('panelAccess', e.target.value as 'AGENDA_ONLY' | 'FULL')}
        >
          <option value="AGENDA_ONLY">Sólo su agenda y sus pacientes</option>
          <option value="FULL">El panel completo</option>
        </Select>
      </div>

      <div className="rounded-[14px] bg-zinc-50 p-3 text-[13px] leading-relaxed text-zinc-600">
        {values.panelAccess === 'AGENDA_ONLY' ? (
          <>
            Entrará directo a <strong>su agenda</strong>: sus citas, sus pacientes y la historia
            clínica de lo que atiende. No verá llamadas, WhatsApp, tareas ni la configuración de la
            clínica.
          </>
        ) : (
          <>
            Verá <strong>todo el panel</strong>, como el resto del equipo. Es lo que corresponde al
            socio de la clínica que además pasa consulta.
          </>
        )}
      </div>
    </div>
  );
}

function PasoTratamientos({
  catalogo,
  setCatalogo,
  elegidos,
  setElegidos,
  cargando,
}: {
  catalogo: TreatmentOptionData[];
  setCatalogo: React.Dispatch<React.SetStateAction<TreatmentOptionData[]>>;
  elegidos: Map<string, number | null>;
  setElegidos: React.Dispatch<React.SetStateAction<Map<string, number | null>>>;
  cargando: boolean;
}) {
  const [nombre, setNombre] = React.useState('');
  const [minutos, setMinutos] = React.useState(30);
  const [error, setError] = React.useState<string | null>(null);
  const [creando, startCreacion] = React.useTransition();

  function alternar(id: string) {
    setElegidos((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, null);
      return next;
    });
  }

  function ponerDuracion(id: string, value: string) {
    const n = Number(value);
    setElegidos((prev) => {
      const next = new Map(prev);
      next.set(id, Number.isFinite(n) && n > 0 ? n : null);
      return next;
    });
  }

  function crear() {
    setError(null);
    startCreacion(async () => {
      const result = await createTreatmentQuickAction({ name: nombre, durationMinutes: minutos });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Recién creado se marca solo: si se está dando de alta aquí es porque
      // este profesional lo hace.
      setCatalogo((prev) => [result.data, ...prev]);
      setElegidos((prev) => new Map(prev).set(result.data.id, null));
      setNombre('');
      setMinutos(30);
    });
  }

  return (
    <div className="grid gap-4">
      {cargando ? (
        <p className="text-[13px] text-zinc-500">Cargando el catálogo…</p>
      ) : catalogo.length === 0 ? (
        <p className="rounded-[14px] bg-amber-50 p-3 text-[13px] text-amber-800">
          La clínica todavía no tiene tratamientos cargados. Añádelos aquí mismo: quedan en el
          catálogo de la clínica y los agentes virtuales pasan a conocerlos.
        </p>
      ) : (
        <div className="grid max-h-[248px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {catalogo.map((t) => {
            const marcado = elegidos.has(t.id);
            return (
              <div
                key={t.id}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-[14px] border p-2.5 transition-colors',
                  marcado ? 'border-brand-200 bg-brand-50/50' : 'border-[--color-border] bg-white',
                )}
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={marcado}
                    onChange={() => alternar(t.id)}
                    className="h-4 w-4 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold text-zinc-800">
                      {t.name}
                    </span>
                    <span className="block text-[12px] text-zinc-500">
                      {t.durationMinutes} min por defecto
                    </span>
                  </span>
                </label>
                {marcado && (
                  <Input
                    type="number"
                    min={5}
                    step={5}
                    aria-label={`Duración propia para ${t.name}`}
                    placeholder={String(t.durationMinutes)}
                    className="h-9 w-[84px] px-2 text-[13px]"
                    value={elegidos.get(t.id) ?? ''}
                    onChange={(e) => ponerDuracion(t.id, e.target.value)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-[14px] border border-dashed border-[--color-border] p-3">
        <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-zinc-500">
          Añadir un tratamiento al catálogo
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid min-w-[200px] flex-1 gap-1.5">
            <Label htmlFor="tr-nombre">Nombre</Label>
            <Input
              id="tr-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Limpieza dental"
            />
          </div>
          <div className="grid w-[120px] gap-1.5">
            <Label htmlFor="tr-min">Duración</Label>
            <Input
              id="tr-min"
              type="number"
              min={5}
              max={480}
              step={5}
              value={minutos}
              onChange={(e) => setMinutos(Number(e.target.value))}
            />
          </div>
          <Button
            variant="secondary"
            onClick={crear}
            disabled={creando || nombre.trim().length < 2}
          >
            {creando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Añadir
          </Button>
        </div>
        {error && <p className="mt-2 text-[13px] text-rose-700">{error}</p>}
      </div>
    </div>
  );
}

function PasoHuecos({
  values,
  set,
}: {
  values: ProfessionalFormValues;
  set: <K extends keyof ProfessionalFormValues>(k: K, v: ProfessionalFormValues[K]) => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="pf-gran">Las citas empiezan</Label>
          <Select
            id="pf-gran"
            value={
              values.slotGranularityMinutes === null ? '' : String(values.slotGranularityMinutes)
            }
            onChange={(e) =>
              set('slotGranularityMinutes', e.target.value === '' ? null : Number(e.target.value))
            }
          >
            <option value="">Una detrás de otra</option>
            <option value="15">Cada 15 min</option>
            <option value="20">Cada 20 min</option>
            <option value="30">Cada 30 min</option>
            <option value="60">Cada hora en punto</option>
          </Select>
          <p className="text-[12px] text-zinc-500">
            {values.slotGranularityMinutes === null
              ? 'La duración la pone el tratamiento y cada cita empieza cuando acaba la anterior.'
              : `Se ofrecen inicios cada ${values.slotGranularityMinutes} min, para encajar citas cortas en los huecos que dejan las largas.`}
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pf-buffer">Descanso entre citas (min)</Label>
          <Input
            id="pf-buffer"
            type="number"
            min={0}
            max={120}
            step={5}
            value={values.bufferMinutes}
            onChange={(e) => set('bufferMinutes', Number(e.target.value))}
          />
          <p className="text-[12px] text-zinc-500">
            0 = sin descanso, una cita pegada a la siguiente.
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pf-notice">Antelación mínima (horas)</Label>
          <Input
            id="pf-notice"
            type="number"
            min={0}
            max={720}
            value={values.minNoticeHours}
            onChange={(e) => set('minNoticeHours', Number(e.target.value))}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pf-advance">Se puede reservar hasta (días)</Label>
          <Input
            id="pf-advance"
            type="number"
            min={1}
            max={365}
            value={values.maxAdvanceDays}
            onChange={(e) => set('maxAdvanceDays', Number(e.target.value))}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-[14px] border border-[--color-border] p-3">
        <div>
          <p className="text-[14px] font-semibold text-zinc-800">Agenda habilitada</p>
          <p className="text-[12px] text-zinc-500">
            Apagada, el profesional existe pero no se le pueden dar citas.
          </p>
        </div>
        <Switch
          checked={values.agendaEnabled}
          onCheckedChange={(v) => set('agendaEnabled', v)}
          label="Agenda habilitada"
        />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-[14px] border border-[--color-border] p-3">
        <div>
          <p className="text-[14px] font-semibold text-zinc-800">
            Los agentes virtuales pueden reservarle
          </p>
          <p className="text-[12px] text-zinc-500">
            Apagado, los agentes consultan su agenda pero sólo reserva recepción.
          </p>
        </div>
        <Switch
          checked={values.acceptsOnlineBooking}
          onCheckedChange={(v) => set('acceptsOnlineBooking', v)}
          label="Reservas automáticas"
        />
      </div>
    </div>
  );
}
