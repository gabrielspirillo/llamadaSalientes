// Datos default que se insertan automáticamente al crear un tenant nuevo.
// Permite al usuario ver el dashboard "vivo" desde el primer login y customizar.

export const SEED_TREATMENTS = [
  {
    name: 'Limpieza dental',
    description: 'Profilaxis + revisión completa.',
    durationMinutes: 30,
    priceMin: '40',
    priceMax: '80',
  },
  {
    name: 'Blanqueamiento',
    description: 'Sesión completa con luz LED.',
    durationMinutes: 60,
    priceMin: '200',
    priceMax: '400',
  },
  {
    name: 'Carillas (consulta inicial)',
    description: 'Evaluación + diseño digital.',
    durationMinutes: 60,
    priceMin: '200',
    priceMax: '200',
  },
  {
    name: 'Endodoncia',
    description: 'Tratamiento de conducto.',
    durationMinutes: 60,
    priceMin: '300',
    priceMax: '500',
  },
  {
    name: 'Implante (consulta)',
    description: 'Evaluación de candidato.',
    durationMinutes: 60,
    priceMin: null,
    priceMax: null,
  },
  {
    name: 'Ortodoncia (consulta)',
    description: 'Diagnóstico ortodóntico.',
    durationMinutes: 60,
    priceMin: null,
    priceMax: null,
  },
  {
    name: 'Extracción simple',
    description: 'Pieza no impactada.',
    durationMinutes: 30,
    priceMin: '100',
    priceMax: '100',
  },
  {
    name: 'Diseño de sonrisa',
    description: 'Plan estético integral.',
    durationMinutes: 60,
    priceMin: '150',
    priceMax: '150',
  },
] as const;

export const SEED_FAQS = [
  {
    category: 'Precios',
    question: '¿Cuánto cuesta una limpieza dental?',
    answer: 'Entre $40 y $80 USD según el caso. Incluye revisión y profilaxis.',
    priority: 10,
  },
  {
    category: 'Pagos',
    question: '¿Aceptan tarjeta de crédito?',
    answer: 'Sí, aceptamos Visa, Mastercard y American Express. También transferencia y efectivo.',
    priority: 9,
  },
  {
    category: 'Ubicación',
    question: '¿Dónde está la clínica?',
    answer: 'Av. Reforma 123, Col. Centro. Hay estacionamiento gratuito en el subterráneo.',
    priority: 8,
  },
  {
    category: 'Pagos',
    question: '¿Tienen planes de financiación?',
    answer:
      'Sí, hasta 12 meses sin intereses con tarjetas participantes para tratamientos de más de $500.',
    priority: 7,
  },
  {
    category: 'Logística',
    question: '¿Qué llevar a la primera consulta?',
    answer:
      'Identificación oficial y, si los tienes, estudios previos (radiografías, tomografías).',
    priority: 6,
  },
  {
    category: 'Política',
    question: '¿Cuál es la política de cancelación?',
    answer: 'Pedimos avisar al menos 24 horas antes para reagendar sin costo.',
    priority: 5,
  },
  {
    category: 'Emergencias',
    question: '¿Atienden emergencias fuera de horario?',
    answer:
      'Tenemos un teléfono de guardia para urgencias. Te conectamos con un dentista de turno.',
    priority: 4,
  },
] as const;
