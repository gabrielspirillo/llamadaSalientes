/**
 * Cambios en los DATOS de la clínica propuestos desde el entrenamiento.
 *
 * Enseñar al asistente cómo responder no alcanza cuando lo que está mal es el
 * dato: el precio subió, el tratamiento ya no se hace, falta una pregunta
 * frecuente. Hasta aquí el entrenador contestaba "eso se cambia en Registros →
 * Tratamientos", que es mandar a la clínica a otra pantalla a hacer a mano lo
 * que acaba de explicar con palabras.
 *
 * Ahora lo propone, con el antes y el después delante, y se aplica con un clic.
 * Sigue proponiendo, no guardando: un modelo que edita precios solo es un
 * modelo que un día pone 0 € en implantes.
 *
 * Puro: sin base y sin `server-only`. Lo que llega del LLM se valida aquí
 * contra el catálogo real —un id inventado no pasa— y lo que se aplica se
 * vuelve a validar en el servidor.
 */

import { parseAmountToCents } from '@/lib/agenda/billing';

export const DATA_ENTITIES = ['TREATMENT', 'FAQ', 'CLINIC'] as const;
export type DataEntity = (typeof DATA_ENTITIES)[number];

export const DATA_OPS = ['CREATE', 'UPDATE', 'DEACTIVATE', 'ACTIVATE', 'DELETE'] as const;
export type DataOp = (typeof DATA_OPS)[number];

/** Una fila del "antes → después" que ve la clínica antes de aplicar. */
export interface DiffRow {
  label: string;
  before: string | null;
  after: string | null;
}

export interface DataChangeProposal {
  ref: string;
  entity: DataEntity;
  op: DataOp;
  /** Fila afectada. Null al crear y en los datos de la clínica. */
  targetId: string | null;
  /** Cómo se llama lo que se toca, para el título de la tarjeta. */
  label: string;
  /** Campos ya normalizados, listos para el servidor. */
  fields: Record<string, unknown>;
  diff: DiffRow[];
  /** Se aplicó. */
  applied?: boolean;
  /** La clínica lo descartó. */
  dismissed?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Contexto: lo que la clínica tiene hoy
// ─────────────────────────────────────────────────────────────────────────────

export interface TreatmentSnapshot {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  active: boolean;
}

export interface FaqSnapshot {
  id: string;
  category: string | null;
  question: string;
  answer: string;
}

export interface ClinicSnapshot {
  address: string | null;
  phones: string[];
  transferNumber: string | null;
}

export interface ClinicDataContext {
  treatments: TreatmentSnapshot[];
  faqs: FaqSnapshot[];
  clinic: ClinicSnapshot;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalización
// ─────────────────────────────────────────────────────────────────────────────

const MAX_CHANGES_PER_TURN = 6;

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  if (!t) return null;
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

/**
 * "60", "60,50", "60.50 €", "1.250,00" → número.
 *
 * El modelo devuelve el precio como se lo dictaron, y en España se dicta con
 * coma y con el punto de los miles. Reusa el lector de importes de los cobros
 * (`lib/agenda/billing.ts`), que ya resuelve esas ambigüedades y tiene sus
 * tests: dos lectores de precios en la misma app se separan al tercer caso
 * raro, y el que se queda corto acaba guardando 1,5 € donde se dijo 1.500.
 */
export function parseAmount(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const cents = parseAmountToCents(v);
  return cents === null ? null : cents / 100;
}

function formatPrice(min: number | null, max: number | null, currency: string | null): string {
  const cur = currency ?? 'EUR';
  if (min == null && max == null) return 'sin precio';
  if (min != null && max != null && min !== max) return `${min}-${max} ${cur}`;
  return `${min ?? max} ${cur}`;
}

function phonesFrom(v: unknown): string[] | null {
  const lista = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;]/) : null;
  if (!lista) return null;
  const limpia = lista
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .slice(0, 6);
  return limpia.length ? limpia : null;
}

function isOp(v: unknown): v is DataOp {
  return typeof v === 'string' && (DATA_OPS as readonly string[]).includes(v);
}

function isEntity(v: unknown): v is DataEntity {
  return typeof v === 'string' && (DATA_ENTITIES as readonly string[]).includes(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// Parseo de lo que devuelve el LLM
// ─────────────────────────────────────────────────────────────────────────────

function parseTreatment(
  o: Record<string, unknown>,
  op: DataOp,
  ctx: ClinicDataContext,
): Omit<DataChangeProposal, 'ref'> | null {
  const actual =
    typeof o.target_id === 'string' ? ctx.treatments.find((t) => t.id === o.target_id) : undefined;

  if (op !== 'CREATE' && !actual) return null;

  if (op === 'DEACTIVATE' || op === 'ACTIVATE') {
    if (!actual) return null;
    const activo = op === 'ACTIVATE';
    if (actual.active === activo) return null;
    return {
      entity: 'TREATMENT',
      op,
      targetId: actual.id,
      label: actual.name,
      fields: { active: activo },
      diff: [
        {
          label: 'Estado',
          before: actual.active ? 'Se ofrece' : 'No se ofrece',
          after: activo ? 'Se ofrece' : 'No se ofrece',
        },
      ],
    };
  }

  const nombre = text(o.name, 120) ?? actual?.name ?? null;
  if (!nombre) return null;

  const descripcion =
    'description' in o ? text(o.description, 1000) : (actual?.description ?? null);
  const duracion =
    typeof o.duration_minutes === 'number' && o.duration_minutes >= 5 && o.duration_minutes <= 480
      ? Math.round(o.duration_minutes)
      : (actual?.durationMinutes ?? null);
  if (op === 'CREATE' && duracion == null) return null;

  const tienePrecio = 'price_min' in o || 'price_max' in o;
  const precioMin = tienePrecio ? parseAmount(o.price_min) : (actual?.priceMin ?? null);
  // Un precio único se dicta una sola vez: "la limpieza son 50 €" no tiene
  // máximo, y dejarlo en null haría que el asistente dijera "desde 50 €".
  const precioMax = tienePrecio
    ? (parseAmount(o.price_max) ?? precioMin)
    : (actual?.priceMax ?? null);
  const moneda = text(o.currency, 8) ?? actual?.currency ?? 'EUR';

  const diff: DiffRow[] = [];
  if (op === 'CREATE') {
    diff.push({ label: 'Tratamiento', before: null, after: nombre });
    diff.push({ label: 'Duración', before: null, after: `${duracion} min` });
    diff.push({ label: 'Precio', before: null, after: formatPrice(precioMin, precioMax, moneda) });
    if (descripcion) diff.push({ label: 'Descripción', before: null, after: descripcion });
  } else if (actual) {
    if (nombre !== actual.name) {
      diff.push({ label: 'Nombre', before: actual.name, after: nombre });
    }
    if (duracion != null && duracion !== actual.durationMinutes) {
      diff.push({
        label: 'Duración',
        before: `${actual.durationMinutes} min`,
        after: `${duracion} min`,
      });
    }
    const antesPrecio = formatPrice(actual.priceMin, actual.priceMax, actual.currency);
    const despuesPrecio = formatPrice(precioMin, precioMax, moneda);
    if (antesPrecio !== despuesPrecio) {
      diff.push({ label: 'Precio', before: antesPrecio, after: despuesPrecio });
    }
    if ((descripcion ?? '') !== (actual.description ?? '')) {
      diff.push({
        label: 'Descripción',
        before: actual.description ?? '(sin descripción)',
        after: descripcion ?? '(sin descripción)',
      });
    }
    // Un cambio que no cambia nada no se le enseña a nadie.
    if (diff.length === 0) return null;
  }

  return {
    entity: 'TREATMENT',
    op: op === 'CREATE' ? 'CREATE' : 'UPDATE',
    targetId: actual?.id ?? null,
    label: nombre,
    fields: {
      name: nombre,
      description: descripcion,
      durationMinutes: duracion,
      priceMin: precioMin,
      priceMax: precioMax,
      currency: moneda,
    },
    diff,
  };
}

function parseFaq(
  o: Record<string, unknown>,
  op: DataOp,
  ctx: ClinicDataContext,
): Omit<DataChangeProposal, 'ref'> | null {
  const actual =
    typeof o.target_id === 'string' ? ctx.faqs.find((f) => f.id === o.target_id) : undefined;
  if (op !== 'CREATE' && !actual) return null;

  if (op === 'DELETE') {
    if (!actual) return null;
    return {
      entity: 'FAQ',
      op: 'DELETE',
      targetId: actual.id,
      label: actual.question,
      fields: {},
      diff: [{ label: 'Se borra', before: actual.answer, after: null }],
    };
  }

  const pregunta = text(o.question, 300) ?? actual?.question ?? null;
  const respuesta = text(o.answer, 2000) ?? actual?.answer ?? null;
  if (!pregunta || !respuesta) return null;
  const categoria = 'category' in o ? text(o.category, 60) : (actual?.category ?? null);

  const diff: DiffRow[] = [];
  if (op === 'CREATE') {
    diff.push({ label: 'Pregunta', before: null, after: pregunta });
    diff.push({ label: 'Respuesta', before: null, after: respuesta });
  } else if (actual) {
    if (pregunta !== actual.question) {
      diff.push({ label: 'Pregunta', before: actual.question, after: pregunta });
    }
    if (respuesta !== actual.answer) {
      diff.push({ label: 'Respuesta', before: actual.answer, after: respuesta });
    }
    if (diff.length === 0) return null;
  }

  return {
    entity: 'FAQ',
    op: op === 'CREATE' ? 'CREATE' : 'UPDATE',
    targetId: actual?.id ?? null,
    label: pregunta,
    fields: { question: pregunta, answer: respuesta, category: categoria },
    diff,
  };
}

function parseClinic(
  o: Record<string, unknown>,
  ctx: ClinicDataContext,
): Omit<DataChangeProposal, 'ref'> | null {
  const direccion = 'address' in o ? text(o.address, 300) : null;
  const telefonos = 'phones' in o ? phonesFrom(o.phones) : null;
  const transferencia = 'transfer_number' in o ? text(o.transfer_number, 40) : null;

  const fields: Record<string, unknown> = {};
  const diff: DiffRow[] = [];
  if (direccion && direccion !== ctx.clinic.address) {
    fields.address = direccion;
    diff.push({ label: 'Dirección', before: ctx.clinic.address ?? '(vacía)', after: direccion });
  }
  if (telefonos && telefonos.join(', ') !== ctx.clinic.phones.join(', ')) {
    fields.phones = telefonos;
    diff.push({
      label: 'Teléfonos',
      before: ctx.clinic.phones.join(', ') || '(vacíos)',
      after: telefonos.join(', '),
    });
  }
  if (transferencia && transferencia !== ctx.clinic.transferNumber) {
    fields.transferNumber = transferencia;
    diff.push({
      label: 'Número de recepción',
      before: ctx.clinic.transferNumber ?? '(vacío)',
      after: transferencia,
    });
  }
  if (diff.length === 0) return null;

  return {
    entity: 'CLINIC',
    op: 'UPDATE',
    targetId: null,
    label: 'Datos de la clínica',
    fields,
    diff,
  };
}

/**
 * Convierte la llamada del LLM en tarjetas aplicables.
 *
 * Lo que no encaja se descarta en silencio: un id inventado, un cambio que no
 * cambia nada, un precio ilegible. Es preferible a enseñar una tarjeta que al
 * pulsarla va a fallar.
 */
export function parseDataChanges(
  raw: unknown,
  refPrefix: string,
  ctx: ClinicDataContext,
): DataChangeProposal[] {
  const lista = Array.isArray(raw) ? raw : [];
  const out: DataChangeProposal[] = [];
  for (const item of lista) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (!isEntity(o.entity)) continue;
    const op: DataOp = isOp(o.op) ? o.op : 'UPDATE';

    const parsed =
      o.entity === 'TREATMENT'
        ? parseTreatment(o, op, ctx)
        : o.entity === 'FAQ'
          ? parseFaq(o, op, ctx)
          : parseClinic(o, ctx);

    if (!parsed) continue;
    out.push({ ...parsed, ref: `${refPrefix}-d${out.length}`, applied: false, dismissed: false });
    if (out.length >= MAX_CHANGES_PER_TURN) break;
  }
  return out;
}

/** Título de la tarjeta, en la voz del panel. */
export function describeDataChange(p: DataChangeProposal): string {
  if (p.entity === 'CLINIC') return 'Actualizar los datos de la clínica';
  const que = p.entity === 'TREATMENT' ? 'el tratamiento' : 'la pregunta frecuente';
  switch (p.op) {
    case 'CREATE':
      return p.entity === 'TREATMENT'
        ? `Añadir el tratamiento "${p.label}"`
        : `Añadir la pregunta "${p.label}"`;
    case 'DEACTIVATE':
      return `Dejar de ofrecer "${p.label}"`;
    case 'ACTIVATE':
      return `Volver a ofrecer "${p.label}"`;
    case 'DELETE':
      return `Borrar la pregunta "${p.label}"`;
    default:
      return `Cambiar ${que} "${p.label}"`;
  }
}

/** A dónde lleva el cambio, para el enlace de la tarjeta. */
export function dataChangeHref(p: DataChangeProposal): string {
  if (p.entity === 'TREATMENT') return '/dashboard/treatments';
  if (p.entity === 'FAQ') return '/dashboard/faqs';
  return '/dashboard/settings';
}
