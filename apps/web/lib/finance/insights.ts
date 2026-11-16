// Recomendaciones del Resumen de Finanzas y previsión del mes. Puro, sin base:
// recibe lo que el Resumen ya calculó y devuelve frases con cifras de esa
// clínica, ordenadas por lo que más dinero mueve. Tests en
// tests/unit/finanzas-recomendaciones.test.ts.

import {
  type AgingBucket,
  type BreakEven,
  type FinanceSummary,
  type OpenBalances,
  deltaPct,
  formatCents,
  plural,
} from '@/lib/finance/model';

export type InsightTone = 'urgent' | 'improve' | 'good';

export type InsightAction =
  | { kind: 'link'; label: string; href: string }
  /** Abre el alta de un gasto (lo pinta el Resumen con su diálogo). */
  | { kind: 'new-expense'; label: string };

export interface Insight {
  key: string;
  tone: InsightTone;
  title: string;
  body: string;
  /** Dinero que mueve, para ordenar y para enseñarlo. */
  impactCents: number | null;
  action: InsightAction | null;
}

export interface MonthForecast {
  /** Lo que ya entró en el mes. */
  soFarCents: number;
  /** Lo que se espera de las citas que quedan (precio o ticket medio). */
  upcomingCents: number;
  projectedCents: number;
  upcomingSessions: number;
  /** Citas que quedan sin precio conocido (se estiman con el ticket medio). */
  estimatedSessions: number;
}

/**
 * Cierre previsto del mes: lo cobrado más lo que valen las citas ya
 * agendadas hasta fin de mes. Las que no tienen precio de tratamiento se
 * estiman con el ticket medio; sin ticket, no se cuentan.
 */
export function monthForecast(input: {
  soFarCents: number;
  upcoming: { count: number; knownCents: number; unpricedCount: number };
  avgTicketCents: number | null;
}): MonthForecast {
  const estimated = input.avgTicketCents ? input.upcoming.unpricedCount : 0;
  const upcomingCents =
    input.upcoming.knownCents + (input.avgTicketCents ?? 0) * input.upcoming.unpricedCount;
  return {
    soFarCents: input.soFarCents,
    upcomingCents,
    projectedCents: input.soFarCents + upcomingCents,
    upcomingSessions: input.upcoming.count,
    estimatedSessions: estimated,
  };
}

export interface InsightInput {
  current: FinanceSummary;
  previous: FinanceSummary;
  open: OpenBalances;
  breakEven: BreakEven;
  aging: AgingBucket[];
  periodLabel: string;
  previousLabel: string;
  todayKey: string;
  /** ¿Hay algún gasto en todo el libro cargado? Distingue "no hubo" de "no se apunta". */
  anyExpenseRecorded: boolean;
  unpricedTreatments: number;
  /** Precio de lista típico (mediana de los tratamientos con precio). */
  listPriceCents: number | null;
  monthlyGoalCents: number | null;
  forecast: MonthForecast | null;
  hrefs: {
    pendingIncome: string;
    pendingExpense: string;
    treatments: string;
    agenda: string;
    category: (categoryId: string) => string;
  };
}

const TONE_WEIGHT: Record<InsightTone, number> = { urgent: 3, improve: 2, good: 1 };

/** Lo que haría la clínica ahora, de más a menos importante. Máximo `limit`. */
export function financeInsights(input: InsightInput, limit = 5): Insight[] {
  const out: Insight[] = [];
  const { current, previous, open, breakEven: be } = input;
  const ticket = current.avgTicketCents ?? input.listPriceCents;

  // 1. Sin gastos apuntados: sin ellos no hay margen que valga.
  if (current.expenseCents === 0 && !input.anyExpenseRecorded && current.incomeCents > 0) {
    out.push({
      key: 'no_expenses',
      tone: 'urgent',
      title: 'Apunta los gastos para saber cuánto ganas de verdad',
      body: `En ${input.periodLabel} entraron ${formatCents(current.incomeCents)}, pero no hay ningún gasto registrado: el resultado que ves es todo lo que entra. Empieza por los fijos (alquiler, nóminas, seguros, suministros) y el margen y el punto de equilibrio se calculan solos.`,
      impactCents: current.incomeCents,
      action: { kind: 'new-expense', label: 'Añadir un gasto' },
    });
  }

  // 2. Sesiones atendidas sin cobro: dinero que no se ve.
  if (open.unbilledSessions > 0) {
    const est = ticket ? open.unbilledSessions * ticket : null;
    out.push({
      key: 'unbilled',
      tone: open.unbilledSessions >= 5 ? 'urgent' : 'improve',
      title: `${plural(open.unbilledSessions, 'sesión atendida', 'sesiones atendidas')} sin cobro registrado`,
      body: est
        ? `Si se cobraron, apúntalo en la ficha de cada paciente para que cuadren las cuentas; si no, son unos ${formatCents(est)} pendientes (a ${formatCents(ticket ?? 0)} por sesión).`
        : 'Si se cobraron, apúntalo en la ficha de cada paciente para que cuadren las cuentas; si no, es dinero pendiente.',
      impactCents: est,
      action: { kind: 'link', label: 'Ver sesiones', href: input.hrefs.pendingIncome },
    });
  }

  // 3. Cobros que envejecen.
  const old = input.aging.slice(1);
  const oldCents = old.reduce((a, b) => a + b.cents, 0);
  const oldCount = old.reduce((a, b) => a + b.count, 0);
  if (oldCents > 0) {
    out.push({
      key: 'aged_receivables',
      tone: 'urgent',
      title: `${formatCents(oldCents)} llevan más de 30 días sin cobrarse`,
      body: `Son ${plural(oldCount, 'sesión', 'sesiones')}. Cuanto más tiempo pasa, más cuesta cobrarlas: conviene llamar a esas familias esta semana.`,
      impactCents: oldCents,
      action: { kind: 'link', label: 'Ver pendientes', href: input.hrefs.pendingIncome },
    });
  }

  // 4. Tratamientos sin precio.
  if (input.unpricedTreatments > 0) {
    out.push({
      key: 'unpriced',
      tone: 'improve',
      title: `Pon precio a ${plural(input.unpricedTreatments, 'tratamiento', 'tratamientos')}`,
      body: 'Sin precio, las sesiones sin cobrar salen «sin importe», no se sabe cuánto falta por cobrar y la previsión del mes se estima con el ticket medio.',
      impactCents: null,
      action: { kind: 'link', label: 'Ir a tratamientos', href: input.hrefs.treatments },
    });
  }

  // 5. Ingresos: suben o bajan, y por qué.
  const growth = deltaPct(current.incomeCents, previous.incomeCents);
  if (growth !== null && previous.incomeCents > 0) {
    const sessionsDelta = deltaPct(current.sessions, previous.sessions);
    const ticketDelta =
      current.avgTicketCents !== null && previous.avgTicketCents !== null
        ? deltaPct(current.avgTicketCents, previous.avgTicketCents)
        : null;
    const detail = `${plural(current.sessions, 'sesión', 'sesiones')} (antes ${previous.sessions})${
      current.avgTicketCents !== null && previous.avgTicketCents !== null
        ? ` a ${formatCents(current.avgTicketCents)} de media (antes ${formatCents(previous.avgTicketCents)})`
        : ''
    }`;
    if (growth <= -10) {
      const cause =
        ticketDelta !== null && sessionsDelta !== null && ticketDelta < sessionsDelta
          ? 'el precio medio por sesión'
          : 'el número de sesiones';
      out.push({
        key: 'income_drop',
        tone: growth <= -20 ? 'urgent' : 'improve',
        title: `Los ingresos caen un ${Math.abs(growth)} % frente a ${input.previousLabel}`,
        body: `${capitalize(detail)}. Lo que más pesa es ${cause}: ${cause === 'el número de sesiones' ? 'mira los huecos libres de la agenda y la lista de espera.' : 'revisa descuentos y bonos.'}`,
        impactCents: previous.incomeCents - current.incomeCents,
        action:
          cause === 'el número de sesiones'
            ? { kind: 'link', label: 'Ver agenda', href: input.hrefs.agenda }
            : null,
      });
    } else if (growth >= 10) {
      out.push({
        key: 'income_up',
        tone: 'good',
        title: `Los ingresos suben un ${growth} % frente a ${input.previousLabel}`,
        body: `${capitalize(detail)}.`,
        impactCents: current.incomeCents - previous.incomeCents,
        action: null,
      });
    }
  }

  // 6. Ticket por debajo de la tarifa.
  if (
    input.listPriceCents &&
    current.avgTicketCents !== null &&
    current.sessions >= 5 &&
    current.avgTicketCents < input.listPriceCents * 0.92
  ) {
    const gap = (input.listPriceCents - current.avgTicketCents) * current.sessions;
    out.push({
      key: 'ticket_below_list',
      tone: 'improve',
      title: `Cobras de media ${formatCents(current.avgTicketCents)}, por debajo de tu tarifa (${formatCents(input.listPriceCents)})`,
      body: `En ${plural(current.sessions, 'sesión', 'sesiones')} son ${formatCents(gap)} menos. Si no son descuentos que quieras mantener, revisa bonos y precios especiales.`,
      impactCents: gap,
      action: null,
    });
  }

  // 7. Un gasto que se dispara.
  const prevByCat = new Map(previous.expenseByCategory.map((c) => [c.id, c.cents]));
  const spikes = current.expenseByCategory
    .map((c) => ({ c, prev: prevByCat.get(c.id) ?? 0 }))
    .filter(({ c, prev }) => prev > 0 && c.cents - prev >= 5000 && c.cents >= prev * 1.3)
    .sort((a, b) => b.c.cents - b.prev - (a.c.cents - a.prev));
  const spike = spikes[0];
  if (spike) {
    const pctUp = deltaPct(spike.c.cents, spike.prev) ?? 0;
    out.push({
      key: 'expense_spike',
      tone: 'improve',
      title: `${spike.c.name} sube un ${pctUp} % frente a ${input.previousLabel}`,
      body: `${formatCents(spike.c.cents)} frente a ${formatCents(spike.prev)}. Si no es un gasto puntual, compara proveedor o consumo.`,
      impactCents: spike.c.cents - spike.prev,
      action: { kind: 'link', label: 'Ver gastos', href: input.hrefs.category(spike.c.id) },
    });
  }

  // 8. Punto de equilibrio.
  if (be.sessionsPerMonth !== null && be.fixedMonthlyCents > 0) {
    const missing = Math.ceil(be.sessionsPerMonth - be.sessionsPerMonthActual);
    if (missing > 0) {
      out.push({
        key: 'below_breakeven',
        tone: 'urgent',
        title: `Faltan ${plural(missing, 'sesión', 'sesiones')} al mes para cubrir los gastos fijos`,
        body: `Los fijos son ${formatCents(be.fixedMonthlyCents)} al mes y cada sesión deja ${formatCents(be.contributionCents ?? 0)}: hacen falta ${be.sessionsPerMonth} y se hacen ${be.sessionsPerMonthActual.toString().replace('.', ',')}.`,
        impactCents: missing * (be.contributionCents ?? 0),
        action: { kind: 'link', label: 'Ver agenda', href: input.hrefs.agenda },
      });
    } else if (be.sessionsPerMonthActual >= be.sessionsPerMonth * 1.2) {
      out.push({
        key: 'above_breakeven',
        tone: 'good',
        title: 'Los gastos fijos están cubiertos con margen',
        body: `Con ${be.sessionsPerMonth} sesiones al mes se pagan los fijos y se hacen ${be.sessionsPerMonthActual.toString().replace('.', ',')}.`,
        impactCents: null,
        action: null,
      });
    }
  } else if (current.marginPct !== null && current.expenseCents > 0 && current.marginPct < 10) {
    out.push({
      key: 'low_margin',
      tone: 'urgent',
      title: `El margen es del ${Math.round(current.marginPct)} %`,
      body: `De cada 100 € que entran quedan ${Math.max(0, Math.round(current.marginPct))}. Revisa los gastos más grandes y el precio de la sesión.`,
      impactCents: null,
      action: null,
    });
  }

  // 9. Dependencia de una persona.
  const profs = current.incomeByProfessional;
  const top = profs[0];
  if (top && profs.length >= 2 && current.incomeCents > 0) {
    const share = Math.round((top.cents / current.incomeCents) * 100);
    if (share > 85) {
      out.push({
        key: 'concentration',
        tone: 'improve',
        title: `El ${share} % de los ingresos depende de ${top.name}`,
        body: 'Una baja o unas vacaciones dejarían la clínica casi sin ingresos. Repartir pacientes reduce ese riesgo.',
        impactCents: null,
        action: null,
      });
    }
  }

  // 10. Facturas sin pagar.
  const overdue = open.payables.filter((p) => p.occurredOn < input.todayKey);
  if (overdue.length > 0) {
    const cents = overdue.reduce((a, b) => a + (b.amountCents ?? 0), 0);
    out.push({
      key: 'payables',
      tone: 'improve',
      title: `${plural(overdue.length, 'gasto pendiente', 'gastos pendientes')} de pagar`,
      body: `Suman ${formatCents(cents)}. Márcalos como pagados cuando salgan del banco para que la caja cuadre.`,
      impactCents: cents,
      action: { kind: 'link', label: 'Ver gastos pendientes', href: input.hrefs.pendingExpense },
    });
  }

  // 11. Previsión frente al objetivo.
  if (input.forecast && input.monthlyGoalCents) {
    const f = input.forecast;
    const goal = input.monthlyGoalCents;
    if (f.projectedCents < goal) {
      const gap = goal - f.projectedCents;
      const needed = ticket ? Math.ceil(gap / ticket) : null;
      out.push({
        key: 'forecast_short',
        tone: 'improve',
        title: `Con la agenda actual cerrarás el mes en ${formatCents(f.projectedCents)}`,
        body: `${formatCents(gap)} por debajo del objetivo${needed ? `: unas ${plural(needed, 'sesión', 'sesiones')} más lo cubrirían` : ''}. Los huecos libres y la lista de espera son el sitio por donde empezar.`,
        impactCents: gap,
        action: { kind: 'link', label: 'Ver agenda', href: input.hrefs.agenda },
      });
    } else {
      out.push({
        key: 'forecast_ok',
        tone: 'good',
        title: 'Con las citas ya agendadas llegas al objetivo del mes',
        body: `Previsión: ${formatCents(f.projectedCents)} frente a un objetivo de ${formatCents(goal)}.`,
        impactCents: null,
        action: null,
      });
    }
  }

  return out
    .sort(
      (a, b) =>
        TONE_WEIGHT[b.tone] - TONE_WEIGHT[a.tone] || (b.impactCents ?? 0) - (a.impactCents ?? 0),
    )
    .slice(0, limit);
}

/** Mediana de los precios de lista (ignora los tratamientos sin precio). */
export function medianPrice(prices: (number | null)[]): number | null {
  const ps = prices
    .filter((p): p is number => typeof p === 'number' && p > 0)
    .sort((a, b) => a - b);
  if (ps.length === 0) return null;
  const mid = Math.floor(ps.length / 2);
  return ps.length % 2 ? (ps[mid] ?? null) : Math.round(((ps[mid - 1] ?? 0) + (ps[mid] ?? 0)) / 2);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
