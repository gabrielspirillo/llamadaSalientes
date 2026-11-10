import { describe, expect, it } from 'vitest';

import { guardDiagnosticQuery } from '@/lib/diagnostics/sql-guard';

describe('puerta de diagnóstico: sólo lectura', () => {
  it('acepta un SELECT y un WITH, con o sin ";" final', () => {
    expect(guardDiagnosticQuery('select 1').ok).toBe(true);
    expect(guardDiagnosticQuery('  WITH x AS (select 1) select * from x;  ').ok).toBe(true);
  });

  it('rechaza escrituras y DDL', () => {
    for (const q of [
      'delete from tenants',
      'update x set a=1',
      'insert into x values (1)',
      'drop table x',
      'set role postgres',
    ]) {
      expect(guardDiagnosticQuery(q).ok).toBe(false);
    }
  });

  it('rechaza varias sentencias, también escondidas tras un comentario', () => {
    expect(guardDiagnosticQuery('select 1; commit; delete from tenants').ok).toBe(false);
    expect(guardDiagnosticQuery('select 1 -- ;\n; delete from x').ok).toBe(false);
    expect(guardDiagnosticQuery('select 1 /* hola */; drop table x').ok).toBe(false);
  });

  it('rechaza funciones de administración', () => {
    expect(guardDiagnosticQuery('select pg_terminate_backend(1)').ok).toBe(false);
    expect(guardDiagnosticQuery("select pg_read_file('/etc/passwd')").ok).toBe(false);
    expect(guardDiagnosticQuery("select set_config('transaction_read_only','off',true)").ok).toBe(
      false,
    );
  });

  it('sin texto o vacía', () => {
    expect(guardDiagnosticQuery(undefined).ok).toBe(false);
    expect(guardDiagnosticQuery('  ;  ').ok).toBe(false);
  });
});
