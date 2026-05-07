import path from 'node:path';
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../lib/db/schema';
import { faqs, tenants, treatments } from '../lib/db/schema';

config({ path: path.resolve(__dirname, '../.env.local') });

const TREATMENTS = [
  {
    name: 'Limpieza dental',
    description: 'Profilaxis + revisión.',
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
    priceMin: '0',
    priceMax: '0',
  },
  {
    name: 'Ortodoncia (consulta)',
    description: 'Diagnóstico ortodóntico.',
    durationMinutes: 60,
    priceMin: '0',
    priceMax: '0',
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
];

const FAQS = [
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
];

async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ DIRECT_URL or DATABASE_URL must be set');
    process.exit(1);
  }

  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 30 });
  const db = drizzle(sql, { schema });

  try {
    const allTenants = await db.select({ id: tenants.id, name: tenants.name }).from(tenants);
    if (allTenants.length === 0) {
      console.log(
        '⚠️  No hay tenants en la DB. Creá tu organización en /sign-up primero, después corré este script.',
      );
      return;
    }

    for (const t of allTenants) {
      // Skip si ya tiene tratamientos
      const existing = await db
        .select({ id: treatments.id })
        .from(treatments)
        .where(eq(treatments.tenantId, t.id))
        .limit(1);
      if (existing.length > 0) {
        console.log(`→ ${t.name}: ya tiene tratamientos, salteo`);
        continue;
      }

      await db
        .insert(treatments)
        .values(TREATMENTS.map((tr) => ({ tenantId: t.id, ...tr, currency: 'USD' as const })));
      await db.insert(faqs).values(FAQS.map((f) => ({ tenantId: t.id, ...f })));

      console.log(
        `✅ ${t.name}: sembrados ${TREATMENTS.length} tratamientos + ${FAQS.length} FAQs`,
      );
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
