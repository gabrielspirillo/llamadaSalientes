import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard/finanzas',
  useSearchParams: () => new URLSearchParams('tab=resumen'),
}));
vi.mock('@/app/(dashboard)/dashboard/finanzas/actions', () => ({
  createEntryAction: vi.fn(),
  updateEntryAction: vi.fn(),
  markEntryPaidAction: vi.fn(),
  deleteEntryAction: vi.fn(),
  deleteEntryFileAction: vi.fn(),
  replicateRecurringAction: vi.fn(),
  createCategoryAction: vi.fn(),
  updateCategoryAction: vi.fn(),
  reorderCategoriesAction: vi.fn(),
  saveFinanceSettingsAction: vi.fn(),
}));
vi.mock('@/components/finanzas/charts-lazy', () => ({
  IncomeExpenseChart: () => <div data-chart="income-expense" />,
  CumulativeNetChart: () => <div data-chart="net" />,
  ShareDonut: () => <div data-chart="donut" />,
}));

import { FinanzasNav } from '@/app/(dashboard)/dashboard/finanzas/finanzas-nav';
import { AjustesTab } from '@/components/finanzas/ajustes-tab';
import { DocumentosTab } from '@/components/finanzas/documentos-tab';
import { MovimientosTab } from '@/components/finanzas/movimientos-tab';
import { ResumenTab } from '@/components/finanzas/resumen-tab';
import type { LedgerLine } from '@/lib/finance/model';
import { parseFinanceParams } from '@/lib/finance/params';
import type { FinanceCategoryRecord, FinanceProfessional } from '@/lib/finance/queries';

/**
 * El HTML que sale del servidor tiene que ser el mismo que el navegador
 * construye al parsearlo: si un <p> lleva un <div> dentro, o un <a> otro <a>,
 * el navegador lo reescribe y React falla la hidratación (error #418) en
 * producción, donde no se ve el motivo. Este test recorre el HTML de cada
 * pestaña con las reglas de anidamiento que los navegadores corrigen.
 */

const BLOCK_IN_P = new Set([
  'div',
  'p',
  'ul',
  'ol',
  'dl',
  'table',
  'form',
  'fieldset',
  'details',
  'section',
  'nav',
  'article',
  'header',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'pre',
  'blockquote',
  'hr',
  'main',
  'aside',
]);
const VOID = new Set([
  'input',
  'img',
  'br',
  'hr',
  'meta',
  'link',
  'area',
  'base',
  'col',
  'embed',
  'source',
  'track',
  'wbr',
]);

/** Errores de anidamiento que el navegador corrige por su cuenta. */
function nestingProblems(html: string): string[] {
  const problems: string[] = [];
  const stack: string[] = [];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let m: RegExpExecArray | null = tagRe.exec(html);
  while (m !== null) {
    const raw = m[0];
    const tag = (m[1] as string).toLowerCase();
    const attrs = m[2] ?? '';
    if (raw.startsWith('</')) {
      const idx = stack.lastIndexOf(tag);
      if (idx >= 0) stack.splice(idx);
    } else if (!VOID.has(tag) && !attrs.trim().endsWith('/')) {
      const path = stack.join('>');
      if (BLOCK_IN_P.has(tag) && stack.includes('p'))
        problems.push(`<${tag}> dentro de <p> (${path})`);
      if (tag === 'a' && stack.includes('a')) problems.push(`<a> dentro de <a> (${path})`);
      if ((tag === 'button' || tag === 'a') && stack.includes('button')) {
        problems.push(`<${tag}> dentro de <button> (${path})`);
      }
      if (tag === 'button' && stack.includes('a'))
        problems.push(`<button> dentro de <a> (${path})`);
      if (tag === 'form' && stack.includes('form'))
        problems.push(`<form> dentro de <form> (${path})`);
      if (tag === 'label' && stack.includes('label'))
        problems.push(`<label> dentro de <label> (${path})`);
      if (tag === 'li' && !['ul', 'ol', 'menu'].includes(stack[stack.length - 1] ?? '')) {
        problems.push(`<li> fuera de lista (${path})`);
      }
      if (
        (tag === 'dt' || tag === 'dd') &&
        !['dl', 'div'].includes(stack[stack.length - 1] ?? '')
      ) {
        problems.push(`<${tag}> fuera de <dl> (${path})`);
      }
      stack.push(tag);
    }
    m = tagRe.exec(html);
  }
  return problems;
}

const categories: FinanceCategoryRecord[] = [
  {
    id: 'c1',
    kind: 'EXPENSE',
    slug: 'alquiler',
    name: 'Alquiler',
    isFixed: true,
    active: true,
    isSystem: true,
    sortOrder: 0,
  },
  {
    id: 'c2',
    kind: 'EXPENSE',
    slug: 'material',
    name: 'Material',
    isFixed: false,
    active: true,
    isSystem: true,
    sortOrder: 1,
  },
  {
    id: 'c3',
    kind: 'EXPENSE',
    slug: 'vieja',
    name: 'Vieja',
    isFixed: false,
    active: false,
    isSystem: false,
    sortOrder: 2,
  },
  {
    id: 'c4',
    kind: 'INCOME',
    slug: 'bonos',
    name: 'Bonos',
    isFixed: false,
    active: true,
    isSystem: true,
    sortOrder: 0,
  },
];
const professionals: FinanceProfessional[] = [
  { id: 'p1', fullName: 'Dra. Ruiz', color: '#37766a', active: true },
  { id: 'p2', fullName: 'Dr. Vega', color: '#37766a', active: true },
];
let seq = 0;
function line(partial: Partial<LedgerLine> & { kind: LedgerLine['kind'] }): LedgerLine {
  seq += 1;
  const source = partial.source ?? 'entry';
  return {
    key: `${source}:${seq}`,
    source,
    sourceId: `id-${seq}`,
    concept: 'Concepto',
    counterparty: null,
    categoryId: null,
    categoryName: null,
    isFixed: false,
    amountCents: 1000,
    taxCents: 0,
    status: 'PAID',
    occurredOn: '2026-09-10',
    paidOn: '2026-09-10',
    paymentMethod: null,
    professionalId: null,
    professionalName: null,
    treatmentName: null,
    patientKey: null,
    patientName: null,
    isRecurring: false,
    recurrence: null,
    notes: null,
    files: [],
    ...partial,
  };
}
const ledger: LedgerLine[] = [
  line({
    kind: 'INCOME',
    source: 'charge',
    amountCents: 4500,
    paymentMethod: 'CARD',
    professionalId: 'p1',
    professionalName: 'Dra. Ruiz',
    treatmentName: 'Fisio',
    patientKey: 'pat:1',
    patientName: 'Lucía',
    files: [{ id: 'f1', name: 'ticket.pdf', kind: 'INVOICE' }],
  }),
  line({
    kind: 'INCOME',
    source: 'charge',
    amountCents: 5500,
    paymentMethod: 'CASH',
    professionalId: 'p2',
    professionalName: 'Dr. Vega',
    treatmentName: 'Primera',
    patientKey: 'pat:2',
    patientName: 'Mateo',
  }),
  line({
    kind: 'INCOME',
    source: 'appointment',
    amountCents: 4500,
    status: 'PENDING',
    paidOn: null,
    occurredOn: '2026-08-20',
    patientKey: 'pat:3',
    patientName: 'Nora',
    professionalId: 'p1',
    professionalName: 'Dra. Ruiz',
  }),
  line({
    kind: 'INCOME',
    amountCents: 3000,
    categoryId: 'c4',
    categoryName: 'Bonos',
    counterparty: 'Familia García',
  }),
  line({
    kind: 'EXPENSE',
    amountCents: 80000,
    categoryId: 'c1',
    categoryName: 'Alquiler',
    isFixed: true,
    counterparty: 'Inmobiliaria',
    isRecurring: true,
    recurrence: 'MONTHLY',
    files: [{ id: 'f2', name: 'factura.pdf', kind: 'INVOICE' }],
  }),
  line({
    kind: 'EXPENSE',
    amountCents: 12000,
    categoryId: 'c2',
    categoryName: 'Material',
    status: 'PENDING',
    paidOn: null,
  }),
  line({
    kind: 'EXPENSE',
    amountCents: 9000,
    categoryId: 'c1',
    categoryName: 'Alquiler',
    isFixed: true,
    occurredOn: '2026-08-05',
    paidOn: '2026-08-05',
  }),
];
const todayKey = '2026-09-23';
const settings = { monthlyRevenueGoalCents: 600000 };
const counterparties = [{ name: 'Inmobiliaria', kind: 'EXPENSE' as const, categoryId: 'c1' }];

function check(name: string, html: string) {
  const problems = nestingProblems(html);
  expect(problems, `${name}: ${problems.join(' | ')}`).toEqual([]);
}

describe('HTML del módulo Finanzas sin anidamientos que el navegador reescriba', () => {
  it('el validador detecta lo que buscamos', () => {
    expect(nestingProblems('<p>a<div>b</div></p>')).toHaveLength(1);
    expect(nestingProblems('<a href="/"><a href="/x">y</a></a>')).toHaveLength(1);
    expect(nestingProblems('<button><a>y</a></button>')).toHaveLength(1);
    expect(nestingProblems('<p><span>ok</span><input/></p>')).toEqual([]);
  });

  it('Resumen con datos y vacío', () => {
    const params = parseFinanceParams({ tab: 'resumen' }, todayKey, { canManage: true });
    check(
      'resumen',
      renderToStaticMarkup(
        <ResumenTab
          params={params}
          ledger={ledger}
          categories={categories}
          professionals={professionals}
          counterparties={counterparties}
          settings={settings}
          todayKey={todayKey}
        />,
      ),
    );
    check(
      'resumen vacío',
      renderToStaticMarkup(
        <ResumenTab
          params={params}
          ledger={[]}
          categories={categories}
          professionals={professionals}
          counterparties={[]}
          settings={{ monthlyRevenueGoalCents: null }}
          todayKey={todayKey}
        />,
      ),
    );
  });

  it('Movimientos, Documentos y Ajustes', () => {
    const params = parseFinanceParams(
      { tab: 'movimientos', method: 'CARD', q: 'fisio' },
      todayKey,
      { canManage: true },
    );
    check(
      'movimientos',
      renderToStaticMarkup(
        <MovimientosTab
          params={params}
          ledger={ledger}
          categories={categories}
          professionals={professionals}
          counterparties={counterparties}
          recurring={{ candidates: 2, alreadyCopied: 0 }}
          todayKey={todayKey}
          canWrite
          canManage
        />,
      ),
    );
    check(
      'documentos',
      renderToStaticMarkup(
        <DocumentosTab
          params={parseFinanceParams({ tab: 'documentos' }, todayKey, { canManage: true })}
          ledger={ledger}
          categories={categories}
          professionals={professionals}
          counterparties={counterparties}
          todayKey={todayKey}
          canWrite
        />,
      ),
    );
    check(
      'ajustes',
      renderToStaticMarkup(
        <AjustesTab
          categories={categories}
          counts={{ c1: 3 }}
          settings={settings}
          invoiceSettings={null}
          year={2026}
        />,
      ),
    );
    check(
      'nav',
      renderToStaticMarkup(<FinanzasNav params={params} canManage documentsCount={2} />),
    );
  });
});
