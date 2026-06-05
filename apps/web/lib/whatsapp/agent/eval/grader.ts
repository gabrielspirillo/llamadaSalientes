/**
 * Grader determinístico para los casos de eval. No usa LLM-as-judge (queda
 * para una iteración futura): chequea señales de alta confianza del
 * AgentOutput contra las expectativas declaradas en cada caso.
 */

import type { AgentOutput } from '../types';
import type { EvalCase } from './cases';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface CaseResult {
  id: string;
  description: string;
  passed: boolean;
  checks: Check[];
  output: AgentOutput;
}

export function gradeCase(c: EvalCase, output: AgentOutput): CaseResult {
  const checks: Check[] = [];
  const okToolNames = output.toolsCalled.filter((t) => t.ok).map((t) => t.name);
  const allToolNames = output.toolsCalled.map((t) => t.name);
  const text = output.responseText ?? '';

  if (c.expectIntent !== undefined) {
    checks.push({
      name: 'intent',
      ok: output.intent === c.expectIntent,
      detail: `esperado ${c.expectIntent}, obtenido ${output.intent}`,
    });
  }
  if (c.expectHandoff !== undefined) {
    checks.push({
      name: 'handoff',
      ok: output.handoff === c.expectHandoff,
      detail: `esperado ${c.expectHandoff}, obtenido ${output.handoff}`,
    });
  }
  if (c.expectUrgent !== undefined) {
    checks.push({
      name: 'urgent',
      ok: output.urgent === c.expectUrgent,
      detail: `esperado ${c.expectUrgent}, obtenido ${output.urgent}`,
    });
  }
  if (c.expectToolsAny && c.expectToolsAny.length) {
    const hit = c.expectToolsAny.some((t) => okToolNames.includes(t));
    checks.push({
      name: 'tools_any',
      ok: hit,
      detail: `esperaba alguna de [${c.expectToolsAny.join(', ')}], llamó [${okToolNames.join(', ') || '—'}]`,
    });
  }
  if (c.expectToolsNone && c.expectToolsNone.length) {
    const violated = c.expectToolsNone.filter((t) => allToolNames.includes(t));
    checks.push({
      name: 'tools_none',
      ok: violated.length === 0,
      detail: violated.length ? `no debía llamar [${violated.join(', ')}]` : 'ok',
    });
  }
  if (c.responseMustMatch) {
    checks.push({
      name: 'response_match',
      ok: c.responseMustMatch.test(text),
      detail: `debía matchear ${c.responseMustMatch}`,
    });
  }
  if (c.responseMustNotMatch) {
    checks.push({
      name: 'response_no_match',
      ok: !c.responseMustNotMatch.test(text),
      detail: `no debía matchear ${c.responseMustNotMatch}`,
    });
  }
  if (output.errorText) {
    checks.push({
      name: 'no_error',
      ok: false,
      detail: `errorText=${output.errorText}`,
    });
  }

  return {
    id: c.id,
    description: c.description,
    passed: checks.every((ck) => ck.ok),
    checks,
    output,
  };
}
