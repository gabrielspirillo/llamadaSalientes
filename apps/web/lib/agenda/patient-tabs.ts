// Las pestañas de la ficha del paciente: lo que comparten la página (servidor,
// que resuelve `?tab=`) y el componente de pestañas (cliente). Va aparte y
// sin `'use client'` a propósito: una función exportada desde un módulo de
// cliente no se puede llamar desde el servidor, y así se cayó la ficha en
// producción el 2026-09-23.

export type PatientTab = 'visita' | 'anamnesis' | 'historia' | 'citas' | 'contable' | 'actividad';

export const PATIENT_TABS: PatientTab[] = [
  'visita',
  'anamnesis',
  'historia',
  'citas',
  'contable',
  'actividad',
];

export function isPatientTab(value: unknown): value is PatientTab {
  return typeof value === 'string' && (PATIENT_TABS as string[]).includes(value);
}

export interface PatientTabItem {
  value: PatientTab;
  /** La URL de la pestaña, ya resuelta en el servidor: al cliente no le llegan funciones. */
  href: string;
  label: string;
  /** Etiqueta corta para móvil ("Hoy"). */
  shortLabel?: string;
  /** Contador de escritorio ("9/14", "3"). */
  count?: string | null;
  /** Contador de móvil: sólo lo que pide acción. Sin él, en móvil no hay contador. */
  mobileCount?: string | null;
  /** El contador avisa (ámbar): anamnesis a medias, cobros pendientes. */
  warn?: boolean;
}
