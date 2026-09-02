/**
 * QA-API · Mapeo de errores y gate de roles del módulo Tareas.
 *
 * `taskErrorResponse` es el único traductor de errores del módulo a HTTP y
 * `normalizeRole` el único punto donde un rol de Clerk se convierte en permiso.
 * Ambos son puros; acá se fija su comportamiento real, incluidos los bordes
 * que la auditoría marcó como riesgo (HALLAZGO).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ db: {} }));

import { taskErrorResponse } from '@/lib/tasks/api';
import { TaskForbiddenError, normalizeRole } from '@/lib/tasks/auth';
import { TaskEvidenceRequiredError, TaskNotFoundError } from '@/lib/tasks/service';

afterEach(() => {
  vi.restoreAllMocks();
});

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe('taskErrorResponse', () => {
  it('403 cuando el rol no alcanza, con el rol requerido en el mensaje', async () => {
    const res = taskErrorResponse(new TaskForbiddenError('viewer', 'admin'));
    expect(res.status).toBe(403);
    expect(await body(res)).toEqual({ error: 'Rol viewer insuficiente, se requiere admin+' });
  });

  it('404 cuando la tarea no existe o es de otra clínica', async () => {
    const res = taskErrorResponse(new TaskNotFoundError());
    expect(res.status).toBe(404);
    expect((await body(res)).error).toBe('La tarea no existe o no pertenece a esta clínica');
  });

  it('422 cuando falta la nota de evidencia', async () => {
    const res = taskErrorResponse(new TaskEvidenceRequiredError());
    expect(res.status).toBe(422);
  });

  it('401 sin sesión y 401 sin clínica activa', async () => {
    expect(taskErrorResponse(new Error('Unauthenticated')).status).toBe(401);
    expect(
      taskErrorResponse(
        new Error('No active organization — el usuario debe seleccionar una clínica'),
      ).status,
    ).toBe(401);
  });

  it('500 genérico sin filtrar detalles internos al cliente', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = taskErrorResponse(new Error('connect ECONNREFUSED 10.0.0.4:5432 password=hunter2'));
    expect(res.status).toBe(500);
    // Lo importante: el cuerpo NO lleva el mensaje del error.
    expect(await body(res)).toEqual({ error: 'Error interno' });
    expect(spy).toHaveBeenCalled();
  });

  it('HALLAZGO: un id mal formado sale como 500, no como 400/404', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Es lo que devuelve Postgres (22P02) cuando la ruta [id] recibe basura:
    // ninguna ruta valida que el segmento sea un uuid antes de consultar.
    const pgErr = Object.assign(new Error('invalid input syntax for type uuid: "abc"'), {
      code: '22P02',
    });
    expect(taskErrorResponse(pgErr).status).toBe(500);
  });

  it('HALLAZGO: el 401 se decide por regex sobre el mensaje, no por tipo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Cualquier error ajeno que mencione "Unauthenticated" se convierte en 401…
    expect(taskErrorResponse(new Error('Stripe: Unauthenticated webhook')).status).toBe(401);
    // …y si Clerk cambia el texto de requireOrg, el 401 se degrada a 500.
    expect(taskErrorResponse(new Error('User is signed out')).status).toBe(500);
  });

  it('no rompe con valores que no son Error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // El fallback `?? 'Unauthorized'` no matchea la regex de 401: un error sin
    // message (null, undefined, un string suelto) siempre acaba en 500.
    expect(taskErrorResponse(null).status).toBe(500);
    expect(taskErrorResponse(undefined).status).toBe(500);
    expect(taskErrorResponse('boom').status).toBe(500);
  });
});

describe('normalizeRole', () => {
  it('reconoce admin y viewer con y sin prefijo org:', () => {
    expect(normalizeRole('admin')).toBe('admin');
    expect(normalizeRole('org:admin')).toBe('admin');
    expect(normalizeRole('viewer')).toBe('viewer');
    expect(normalizeRole('org:viewer')).toBe('viewer');
  });

  it('los miembros normales de Clerk operan', () => {
    expect(normalizeRole('member')).toBe('operator');
    expect(normalizeRole('org:member')).toBe('operator');
    expect(normalizeRole('basic_member')).toBe('operator');
    expect(normalizeRole('operator')).toBe('operator');
  });

  it('HALLAZGO: cualquier rol desconocido cae en operator (falla abierto)', () => {
    // Un rol custom de Clerk pensado como solo-lectura (org:guest, org:readonly,
    // org:billing…) acaba con permiso de crear, mover, cerrar y archivar.
    for (const raw of ['guest', 'org:guest', 'readonly', 'org:solo_lectura', 'billing', 'xyz']) {
      expect(normalizeRole(raw)).toBe('operator');
    }
  });

  it('HALLAZGO: sin rol (null/undefined/"") también es operator', () => {
    // requireTaskRole nunca llega acá sin membership (lanza 403 antes), pero la
    // página del tablero sí: normalizeRole(membershipRow?.role) con undefined
    // pinta la UI de operador a alguien sin membership.
    expect(normalizeRole(null)).toBe('operator');
    expect(normalizeRole(undefined)).toBe('operator');
    expect(normalizeRole('')).toBe('operator');
  });

  it('HALLAZGO: solo se quita un prefijo org:, y el rol distingue mayúsculas', () => {
    expect(normalizeRole('org:org:admin')).toBe('operator');
    expect(normalizeRole('Admin')).toBe('operator');
    expect(normalizeRole('ADMIN')).toBe('operator');
    expect(normalizeRole(' admin')).toBe('operator');
  });
});
