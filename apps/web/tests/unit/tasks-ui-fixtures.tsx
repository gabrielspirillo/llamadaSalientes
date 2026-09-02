// Fixtures y utilidades compartidas por los tests de UI del módulo Tareas.
// No es un archivo *.test.tsx a propósito: vitest no lo recolecta.

import type {
  TaskAutomationRuleDTO,
  TaskDTO,
  TaskDetailDTO,
  TaskMember,
  TaskStatsDTO,
  TaskTemplateDTO,
} from '@/lib/tasks/types';
import { act } from '@testing-library/react';
import { vi } from 'vitest';

// ─── Miembros ────────────────────────────────────────────────────────────────

export function member(over: Partial<TaskMember> & { userId: string }): TaskMember {
  return {
    clerkUserId: `clerk_${over.userId}`,
    email: `${over.userId}@clinica.test`,
    name: over.userId,
    initials: over.userId.slice(0, 2).toUpperCase(),
    role: 'operator',
    ...over,
  };
}

export const LUCIA = member({ userId: 'u-lucia', name: 'Lucía', initials: 'LU' });
export const MARTA = member({ userId: 'u-marta', name: 'Marta', initials: 'MA' });
export const PEDRO = member({ userId: 'u-pedro', name: 'Pedro', initials: 'PE' });
export const MEMBERS: TaskMember[] = [LUCIA, MARTA, PEDRO];

// ─── Tareas ──────────────────────────────────────────────────────────────────

let seq = 0;

export function task(over: Partial<TaskDTO> = {}): TaskDTO {
  seq += 1;
  return {
    id: over.id ?? `t-${seq}`,
    title: `Tarea ${seq}`,
    description: null,
    category: 'ADMIN',
    priority: 'MEDIUM',
    status: 'TODO',
    boardPosition: 1000 * seq,
    dueAt: null,
    dueAllDay: true,
    completedAt: null,
    source: 'MANUAL',
    automationTrigger: null,
    templateId: null,
    requiresEvidence: false,
    evidenceNote: null,
    labels: [],
    assigneeIds: [],
    checklistTotal: 0,
    checklistDone: 0,
    commentCount: 0,
    patientGhlContactId: null,
    patientName: null,
    patientPhone: null,
    callId: null,
    whatsappConversationId: null,
    ghlAppointmentId: null,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
    ...over,
  };
}

export function detail(over: Partial<TaskDetailDTO> = {}): TaskDetailDTO {
  return {
    ...task(over),
    checklist: [],
    comments: [],
    createdByUserId: LUCIA.userId,
    ...over,
  };
}

export const EMPTY_STATS: TaskStatsDTO = {
  overdue: 0,
  today: 0,
  upcoming: 0,
  doneThisWeek: 0,
  complianceRate: 0,
  avgCloseHours: null,
  automated: 0,
  manual: 0,
  routine: 0,
  perMember: [],
};

export function stats(over: Partial<TaskStatsDTO> = {}): TaskStatsDTO {
  return { ...EMPTY_STATS, ...over };
}

// ─── Plantillas / reglas ─────────────────────────────────────────────────────

export function template(over: Partial<TaskTemplateDTO> = {}): TaskTemplateDTO {
  return {
    id: 't-tpl-1',
    key: 'apertura',
    name: 'Apertura de clínica',
    description: 'Lo que hay que dejar listo antes del primer paciente',
    category: 'CLINICAL',
    priority: 'MEDIUM',
    recurrenceFreq: 'WEEKDAYS',
    recurrenceInterval: 1,
    recurrenceWeekdays: [1, 2, 3, 4, 5],
    recurrenceMonthDay: null,
    recurrenceMonth: null,
    dueTime: '08:30',
    leadDays: 0,
    defaultRole: null,
    defaultAssigneeUserId: null,
    requiresEvidence: false,
    enabled: true,
    isSystem: true,
    lastMaterializedOn: '2026-09-01',
    items: [
      { id: 'i1', content: 'Encender el autoclave', order: 1 },
      { id: 'i2', content: 'Revisar la agenda del día', order: 2 },
    ],
    stats: { generated: 20, completed: 18 },
    ...over,
  };
}

export function rule(over: Partial<TaskAutomationRuleDTO> = {}): TaskAutomationRuleDTO {
  return {
    id: 'r-1',
    trigger: 'MISSED_CALL',
    enabled: true,
    titleTemplate: 'Devolver llamada a {{patientName}}',
    descriptionTemplate: null,
    category: 'PATIENT',
    priority: 'HIGH',
    dueOffsetMinutes: 120,
    assigneeUserId: null,
    assigneeRole: null,
    requiresEvidence: false,
    params: {},
    generatedLast30d: 4,
    ...over,
  };
}

// ─── fetch mock ──────────────────────────────────────────────────────────────

export interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

export interface FetchMock {
  calls: FetchCall[];
  /** Registra una respuesta para las urls que matcheen (primer match gana). */
  on: (
    match: string | RegExp,
    res: { status?: number; json?: unknown },
    opts?: { method?: string },
  ) => void;
  spy: ReturnType<typeof vi.fn>;
  callsTo: (match: string | RegExp) => FetchCall[];
}

export function mockFetch(): FetchMock {
  const routes: {
    match: string | RegExp;
    method?: string;
    res: { status?: number; json?: unknown };
  }[] = [];
  const calls: FetchCall[] = [];

  const spy = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = undefined;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, method, body });

    const route = routes.find((r) => {
      if (r.method && r.method !== method) return false;
      return typeof r.match === 'string' ? url.includes(r.match) : r.match.test(url);
    });
    const status = route?.res.status ?? 200;
    const payload = route?.res.json ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as unknown as Response;
  });

  globalThis.fetch = spy as unknown as typeof fetch;

  return {
    calls,
    spy,
    on: (match, res, opts) => routes.unshift({ match, res, method: opts?.method?.toUpperCase() }),
    callsTo: (match) =>
      calls.filter((c) => (typeof match === 'string' ? c.url.includes(match) : match.test(c.url))),
  };
}

/** DataTransfer mínimo: happy-dom no implementa el del drag nativo. */
export function fakeDataTransfer() {
  const store = new Map<string, string>();
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: (k: string, v: string) => store.set(k, v),
    getData: (k: string) => store.get(k) ?? '',
    setDragImage: () => undefined,
    types: [] as string[],
    items: [],
    files: [],
  };
}

/**
 * dragOver con coordenada real.
 *
 * happy-dom expone `DragEvent` pero NO hereda de MouseEvent: `clientY` sale
 * `undefined`, así que `fireEvent.dragOver(el, { clientY })` no sirve para
 * probar el cálculo de "mitad de arriba / mitad de abajo". Disparamos un
 * MouseEvent con el nombre `dragover` (React despacha por nombre de evento) y
 * fijamos el rect del elemento, que en happy-dom siempre es 0.
 */
export function fireDragOver(
  el: HTMLElement,
  opts: { clientY: number; rect?: { top: number; height: number }; dataTransfer?: unknown },
): void {
  const rect = opts.rect ?? { top: 100, height: 40 };
  const original = el.getBoundingClientRect;
  el.getBoundingClientRect = () =>
    ({
      x: 0,
      y: rect.top,
      top: rect.top,
      bottom: rect.top + rect.height,
      left: 0,
      right: 0,
      width: 0,
      height: rect.height,
      toJSON: () => ({}),
    }) as DOMRect;
  const ev = new window.MouseEvent('dragover', {
    bubbles: true,
    cancelable: true,
    clientY: opts.clientY,
  });
  Object.defineProperty(ev, 'dataTransfer', {
    value: opts.dataTransfer ?? fakeDataTransfer(),
  });
  act(() => {
    el.dispatchEvent(ev);
  });
  el.getBoundingClientRect = original;
}
