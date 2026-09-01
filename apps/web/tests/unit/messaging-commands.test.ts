import { describe, expect, it } from 'vitest';

import { matchCommand } from '@/components/messaging/Composer';

/**
 * Los comandos de la barra ejecutan acciones reales: crean tareas, fijan
 * decisiones y abren el hilo de un paciente. Confundir un mensaje normal con un
 * comando crearía trabajo que nadie pidió, así que el parseo tiene que ser
 * estricto en los bordes.
 */
describe('parseo de comandos de la barra', () => {
  it('reconoce un comando con su argumento', () => {
    expect(matchCommand('/tarea Llamar a María')).toEqual({
      key: 'tarea',
      arg: 'Llamar a María',
    });
  });

  it('reconoce los cuatro comandos del catálogo', () => {
    expect(matchCommand('/tarea x')?.key).toBe('tarea');
    expect(matchCommand('/llamar x')?.key).toBe('llamar');
    expect(matchCommand('/paciente x')?.key).toBe('paciente');
    expect(matchCommand('/decision x')?.key).toBe('decision');
  });

  it('NO confunde una palabra que empieza igual', () => {
    // El caso que crearía una tarea a traición: alguien escribe sobre tareas.
    expect(matchCommand('/tareas pendientes de hoy')).toBeNull();
    expect(matchCommand('/llamada perdida')).toBeNull();
  });

  it('ignora un comando que no existe', () => {
    expect(matchCommand('/borrar todo')).toBeNull();
    expect(matchCommand('/help')).toBeNull();
  });

  it('no dispara si la barra no abre el mensaje', () => {
    expect(matchCommand('mira esto /tarea algo')).toBeNull();
    expect(matchCommand('el precio es 20/tarea')).toBeNull();
  });

  it('acepta el comando sin argumento y devuelve vacío', () => {
    // El workspace avisa de que falta el texto en vez de crear una tarea vacía.
    expect(matchCommand('/tarea')).toEqual({ key: 'tarea', arg: '' });
    expect(matchCommand('/tarea   ')).toEqual({ key: 'tarea', arg: '' });
  });

  it('tolera espacios de más y mayúsculas', () => {
    expect(matchCommand('  /TAREA  Revisar el autoclave  ')).toEqual({
      key: 'tarea',
      arg: 'Revisar el autoclave',
    });
  });

  it('conserva los saltos de línea del argumento', () => {
    expect(matchCommand('/decision Subimos la tarifa\ndesde el lunes')).toEqual({
      key: 'decision',
      arg: 'Subimos la tarifa\ndesde el lunes',
    });
  });

  it('no toca un mensaje normal', () => {
    expect(matchCommand('hola equipo')).toBeNull();
    expect(matchCommand('')).toBeNull();
    expect(matchCommand('@ana mira esto')).toBeNull();
  });
});
