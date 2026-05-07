// Tipos comunes (Intent, Role, etc.) — se llenan a partir de Fase 1.
export type Intent =
  | 'book'
  | 'reschedule'
  | 'cancel'
  | 'faq'
  | 'pricing'
  | 'location'
  | 'human'
  | 'other';

export type Role = 'admin' | 'operator' | 'viewer';
