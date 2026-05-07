// Datos mock — solo visuales mientras el DB schema se construye en Fase 1.
// NO usar en producción. Reemplazar por queries Drizzle reales.

export type MockCall = {
  id: string;
  patientName: string;
  fromNumber: string;
  intent: 'book' | 'reschedule' | 'cancel' | 'faq' | 'pricing' | 'human' | 'other';
  status: 'completed' | 'transferred' | 'missed';
  duration: string;
  startedAt: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  summary: string;
};

export const mockCalls: MockCall[] = [
  {
    id: 'call_01',
    patientName: 'María González',
    fromNumber: '+52 555 123 4567',
    intent: 'book',
    status: 'completed',
    duration: '3:42',
    startedAt: 'hace 12 min',
    sentiment: 'positive',
    summary: 'Agendó limpieza dental para el viernes a las 10:00.',
  },
  {
    id: 'call_02',
    patientName: 'Carlos Ruiz',
    fromNumber: '+52 555 234 5678',
    intent: 'pricing',
    status: 'completed',
    duration: '2:18',
    startedAt: 'hace 28 min',
    sentiment: 'neutral',
    summary: 'Consultó precio de blanqueamiento. Se le informó rango $200-$400.',
  },
  {
    id: 'call_03',
    patientName: 'Ana Martínez',
    fromNumber: '+52 555 345 6789',
    intent: 'reschedule',
    status: 'completed',
    duration: '1:55',
    startedAt: 'hace 1 h',
    sentiment: 'positive',
    summary: 'Reagendó cita de ortodoncia del jueves al lunes 14:00.',
  },
  {
    id: 'call_04',
    patientName: 'Desconocido',
    fromNumber: '+52 555 456 7890',
    intent: 'human',
    status: 'transferred',
    duration: '4:12',
    startedAt: 'hace 2 h',
    sentiment: 'negative',
    summary: 'Paciente con dolor agudo. Transferido a recepción.',
  },
  {
    id: 'call_05',
    patientName: 'Luis Hernández',
    fromNumber: '+52 555 567 8901',
    intent: 'cancel',
    status: 'completed',
    duration: '1:30',
    startedAt: 'hace 3 h',
    sentiment: 'neutral',
    summary: 'Canceló cita del viernes. No se reagendó.',
  },
  {
    id: 'call_06',
    patientName: 'Sofía Pérez',
    fromNumber: '+52 555 678 9012',
    intent: 'faq',
    status: 'completed',
    duration: '2:05',
    startedAt: 'hace 4 h',
    sentiment: 'positive',
    summary: 'Preguntó sobre formas de pago y financiación. Respondida con FAQ.',
  },
  {
    id: 'call_07',
    patientName: 'Roberto Silva',
    fromNumber: '+52 555 789 0123',
    intent: 'book',
    status: 'completed',
    duration: '3:18',
    startedAt: 'hace 5 h',
    sentiment: 'positive',
    summary: 'Primera consulta para implantes. Agendada para el martes 11:00.',
  },
  {
    id: 'call_08',
    patientName: 'Valeria Torres',
    fromNumber: '+52 555 890 1234',
    intent: 'book',
    status: 'completed',
    duration: '2:42',
    startedAt: 'hace 6 h',
    sentiment: 'positive',
    summary: 'Agendó endodoncia para el miércoles 16:00.',
  },
];

export type MockTreatment = {
  id: string;
  name: string;
  duration: number;
  priceMin: number;
  priceMax: number;
  ghlCalendar: string;
  active: boolean;
};

export const mockTreatments: MockTreatment[] = [
  {
    id: 't1',
    name: 'Limpieza dental',
    duration: 30,
    priceMin: 40,
    priceMax: 80,
    ghlCalendar: 'Limpiezas — Dr. García',
    active: true,
  },
  {
    id: 't2',
    name: 'Blanqueamiento',
    duration: 60,
    priceMin: 200,
    priceMax: 400,
    ghlCalendar: 'Estética — Dra. Mendoza',
    active: true,
  },
  {
    id: 't3',
    name: 'Carillas (consulta)',
    duration: 60,
    priceMin: 200,
    priceMax: 200,
    ghlCalendar: 'Estética — Dra. Mendoza',
    active: true,
  },
  {
    id: 't4',
    name: 'Endodoncia',
    duration: 60,
    priceMin: 300,
    priceMax: 500,
    ghlCalendar: 'Endodoncia — Dr. Soto',
    active: true,
  },
  {
    id: 't5',
    name: 'Implante (consulta)',
    duration: 60,
    priceMin: 0,
    priceMax: 0,
    ghlCalendar: 'Cirugía — Dr. García',
    active: true,
  },
  {
    id: 't6',
    name: 'Ortodoncia (consulta)',
    duration: 60,
    priceMin: 0,
    priceMax: 0,
    ghlCalendar: 'Ortodoncia — Dra. Reyes',
    active: true,
  },
  {
    id: 't7',
    name: 'Extracción simple',
    duration: 30,
    priceMin: 100,
    priceMax: 100,
    ghlCalendar: 'Cirugía — Dr. García',
    active: true,
  },
  {
    id: 't8',
    name: 'Diseño de sonrisa',
    duration: 60,
    priceMin: 150,
    priceMax: 150,
    ghlCalendar: 'Estética — Dra. Mendoza',
    active: false,
  },
];

export type MockFaq = {
  id: string;
  category: string;
  question: string;
  answer: string;
  priority: number;
};

export const mockFaqs: MockFaq[] = [
  {
    id: 'f1',
    category: 'Precios',
    question: '¿Cuánto cuesta una limpieza dental?',
    answer: 'Entre $40 y $80 USD según el caso. Incluye revisión y profilaxis.',
    priority: 10,
  },
  {
    id: 'f2',
    category: 'Pagos',
    question: '¿Aceptan tarjeta de crédito?',
    answer: 'Sí, aceptamos Visa, Mastercard y American Express. También transferencia y efectivo.',
    priority: 9,
  },
  {
    id: 'f3',
    category: 'Ubicación',
    question: '¿Dónde está la clínica?',
    answer: 'Av. Reforma 123, Col. Centro. Hay estacionamiento gratuito en el subterráneo.',
    priority: 8,
  },
  {
    id: 'f4',
    category: 'Pagos',
    question: '¿Tienen planes de financiación?',
    answer:
      'Sí, hasta 12 meses sin intereses con tarjetas participantes para tratamientos de más de $500.',
    priority: 7,
  },
  {
    id: 'f5',
    category: 'Logística',
    question: '¿Qué llevar a la primera consulta?',
    answer:
      'Identificación oficial y, si los tienes, estudios previos (radiografías, tomografías).',
    priority: 6,
  },
  {
    id: 'f6',
    category: 'Política',
    question: '¿Cuál es la política de cancelación?',
    answer: 'Pedimos avisar al menos 24 horas antes para reagendar sin costo.',
    priority: 5,
  },
  {
    id: 'f7',
    category: 'Emergencias',
    question: '¿Atienden emergencias fuera de horario?',
    answer:
      'Tenemos un teléfono de guardia para urgencias. Te conectamos con un dentista de turno.',
    priority: 4,
  },
];

export const mockStats = {
  callsToday: 47,
  callsTodayDelta: '+12%',
  aht: '3:24',
  ahtDelta: '-8s',
  conversionRate: 64,
  conversionDelta: '+5pp',
  containmentRate: 78,
  containmentDelta: '+2pp',
};

export const mockCallsByHour = [
  { hour: '08', calls: 2 },
  { hour: '09', calls: 5 },
  { hour: '10', calls: 8 },
  { hour: '11', calls: 12 },
  { hour: '12', calls: 9 },
  { hour: '13', calls: 6 },
  { hour: '14', calls: 11 },
  { hour: '15', calls: 14 },
  { hour: '16', calls: 10 },
  { hour: '17', calls: 7 },
  { hour: '18', calls: 4 },
];

export const mockIntentBreakdown = [
  { intent: 'Agendar', count: 142, color: 'bg-emerald-500' },
  { intent: 'Reagendar', count: 38, color: 'bg-blue-500' },
  { intent: 'Precios', count: 67, color: 'bg-violet-500' },
  { intent: 'Cancelar', count: 21, color: 'bg-amber-500' },
  { intent: 'FAQ', count: 84, color: 'bg-zinc-400' },
  { intent: 'Humano', count: 19, color: 'bg-red-500' },
];

export const mockTeam = [
  {
    id: 'u1',
    name: 'Adrián Spirillo',
    email: 'adrian@clinicademo.com',
    role: 'admin',
    status: 'active' as const,
  },
  {
    id: 'u2',
    name: 'Laura Mendoza',
    email: 'laura@clinicademo.com',
    role: 'operator',
    status: 'active' as const,
  },
  {
    id: 'u3',
    name: 'Carlos Ruiz',
    email: 'carlos@clinicademo.com',
    role: 'viewer',
    status: 'invited' as const,
  },
];

export const mockTranscript = [
  {
    speaker: 'agent' as const,
    text: 'Esta llamada se está grabando para mejorar la calidad del servicio. Hola, soy Sofía de Clínica Demo, ¿en qué te puedo ayudar?',
    t: '0:00',
  },
  { speaker: 'user' as const, text: 'Hola, quería agendar una limpieza dental.', t: '0:08' },
  {
    speaker: 'agent' as const,
    text: 'Por supuesto. ¿Me podrías confirmar tu nombre completo, por favor?',
    t: '0:13',
  },
  { speaker: 'user' as const, text: 'María González.', t: '0:17' },
  {
    speaker: 'agent' as const,
    text: 'Perfecto, María. Veo que tu última visita fue hace 6 meses. La limpieza dental dura 30 minutos y cuesta entre 40 y 80 dólares. ¿Tienes alguna preferencia de día?',
    t: '0:21',
  },
  { speaker: 'user' as const, text: 'Me gustaría el viernes en la mañana si se puede.', t: '0:32' },
  {
    speaker: 'agent' as const,
    text: 'Tengo disponibilidad el viernes 9 de mayo a las 10:00, 11:00 o 12:00. ¿Cuál te conviene?',
    t: '0:37',
  },
  { speaker: 'user' as const, text: 'A las 10 está bien.', t: '0:46' },
  {
    speaker: 'agent' as const,
    text: 'Confirmo: limpieza dental el viernes 9 de mayo a las 10:00 con la Dra. Mendoza. ¿Está bien?',
    t: '0:49',
  },
  { speaker: 'user' as const, text: 'Sí, perfecto.', t: '0:58' },
  {
    speaker: 'agent' as const,
    text: 'Listo, María. Te llegará una confirmación por SMS. Gracias por llamar a Clínica Demo. ¡Que tengas un excelente día!',
    t: '1:01',
  },
];
