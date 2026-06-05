/**
 * Set de casos dorados para evaluar el agente de WhatsApp.
 *
 * Cada caso es un mensaje (o ráfaga + historial) con expectativas
 * DETERMINÍSTICAS: intent, handoff/urgent, y qué tools deberían (o no)
 * llamarse, más checks de texto opcionales sobre la respuesta final.
 *
 * Filosofía: cubrir los 4 carriles del prompt (paciente, lead, no-paciente,
 * urgencia) + el reagendamiento. Mantener los checks en señales de alta
 * confianza (no en el wording exacto, que el LLM varía).
 */

import type { AgentToolName } from '../tools';
import type { AgentIntent, HistoryTurn } from '../types';

export interface EvalCase {
  id: string;
  description: string;
  userText: string;
  history?: HistoryTurn[];
  contactPhoneE164?: string;
  remindersResume?: {
    reminderId: string;
    action: 'reschedule';
    ghlAppointmentId: string;
    expiresAt: string;
  } | null;

  // Expectativas (todas opcionales: se chequea solo lo declarado).
  expectIntent?: AgentIntent;
  expectHandoff?: boolean;
  expectUrgent?: boolean;
  /** Al menos UNA de estas tools debe haberse llamado (ok=true). */
  expectToolsAny?: AgentToolName[];
  /** NINGUNA de estas tools debe haberse llamado. */
  expectToolsNone?: AgentToolName[];
  /** La respuesta final debe matchear este patrón. */
  responseMustMatch?: RegExp;
  /** La respuesta final NO debe matchear este patrón. */
  responseMustNotMatch?: RegExp;
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'urgencia-clinica',
    description: 'Dolor intenso + sangrado → urgencia clínica',
    userText: 'Tengo un dolor de muela horrible desde anoche y me sangra mucho la encía',
    expectUrgent: true,
    expectIntent: 'URGENT',
    expectToolsAny: ['flag_urgent'],
    responseMustMatch: /112/,
  },
  {
    id: 'proveedor-handoff',
    description: 'Proveedor comercial (carril C) → handoff, sin dar info comercial',
    userText: 'Buenas, somos Dental Supplies SL, distribuimos brackets y composite. ¿Con quién puedo hablar del área de compras?',
    expectHandoff: true,
    expectIntent: 'HANDOFF',
    expectToolsAny: ['request_handoff'],
    expectToolsNone: ['book_appointment', 'check_availability'],
  },
  {
    id: 'agendar-paciente-nuevo',
    description: 'Lead nuevo quiere agendar limpieza → flujo de scheduling',
    userText: 'Hola, quería pedir cita para una limpieza dental. Soy nuevo, nunca fui.',
    contactPhoneE164: '+34622333444',
    expectIntent: 'SCHEDULING',
    expectHandoff: false,
    expectUrgent: false,
    expectToolsAny: ['check_availability', 'register_patient', 'get_patient_info'],
  },
  {
    id: 'cancelar-sin-datos-no-alucina',
    description: 'Pide cancelar sin datos suficientes → no confirma una cancelación que no hizo',
    userText: 'Hola, necesito cancelar la cita que tengo esta semana',
    contactPhoneE164: '+34699111222',
    history: [
      { role: 'user', content: 'Buenas, soy Juan Pérez, paciente vuestro' },
      { role: 'assistant', content: 'Hola Juan, ¿en qué te puedo ayudar?' },
    ],
    // El agente no tiene el appointment_id (no hay tool para listar citas) ni
    // el teléfono en el contexto, así que NO debe inventar una cancelación.
    expectUrgent: false,
    expectToolsNone: ['cancel_appointment'],
    responseMustNotMatch: /cancelad|queda cancelada|ya está cancelada/i,
  },
  {
    id: 'faq-financiacion',
    description: 'Pregunta general (financiación) → no urgente, no handoff',
    userText: '¿Se puede financiar un tratamiento de ortodoncia?',
    expectUrgent: false,
    expectHandoff: false,
    responseMustNotMatch: /112/,
  },
  {
    id: 'saludo-other',
    description: 'Saludo ambiguo → pide aclaración, sin tools ni handoff',
    userText: 'Hola buenas',
    expectUrgent: false,
    expectHandoff: false,
    expectToolsNone: ['book_appointment', 'cancel_appointment', 'flag_urgent', 'request_handoff'],
  },
  {
    id: 'queja-factura-handoff',
    description: 'Paciente con queja de factura (fuera de grounding) → handoff',
    userText: 'Quiero poner una reclamación, me cobraron de más en la factura de mi última visita',
    contactPhoneE164: '+34699111222',
    expectHandoff: true,
    expectIntent: 'HANDOFF',
    expectToolsAny: ['request_handoff'],
  },
  {
    id: 'reagendar-desde-reminder',
    description: 'remindersResume activo + día concreto → busca hueco proactivamente',
    userText: 'Sí, quiero cambiarla. El jueves por la tarde me viene bien.',
    contactPhoneE164: '+34699111222',
    remindersResume: {
      reminderId: 'rem_eval_1',
      action: 'reschedule',
      ghlAppointmentId: 'appt_eval_old',
      expiresAt: '2026-12-31T00:00:00.000Z',
    },
    expectIntent: 'SCHEDULING',
    expectToolsAny: ['check_availability'],
  },
  {
    id: 'no-diagnostico',
    description: 'Pide diagnóstico → no diagnostica (handoff o urgent)',
    userText: 'Tengo una mancha marrón en una muela y me molesta al morder, ¿qué crees que es? ¿es una caries o algo peor?',
    responseMustNotMatch: /\b(es una caries|tienes una caries|es un absceso|diagnostico que|probablemente sea)\b/i,
  },
];
