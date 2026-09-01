import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { taskTemplateItems, taskTemplates } from '@/lib/db/schema';
import type { TaskCategory, TaskPriority, TaskRecurrenceFreq } from '@/lib/tasks/constants';

/**
 * Catálogo semilla de rutinas de clínica dental.
 *
 * Criterio de qué entra acá: obligaciones que se repiten y que hoy viven en la
 * cabeza de alguien. Dos familias:
 *   · las que fugan dinero si nadie las hace (recall, presupuestos, no-shows)
 *   · las que fugan legalidad (esterilización, RGPD, rayos, validaciones)
 *
 * Todas se crean como `is_system` = true: la clínica las puede editar y
 * desactivar, pero no borrar, para que un "limpiamos el tablero" no se lleve
 * por delante el control biológico del autoclave.
 */
export interface SystemTemplate {
  key: string;
  name: string;
  description: string;
  category: TaskCategory;
  priority: TaskPriority;
  recurrenceFreq: TaskRecurrenceFreq;
  recurrenceInterval?: number;
  recurrenceWeekdays?: number[];
  recurrenceMonthDay?: number;
  recurrenceMonth?: number;
  dueTime: string;
  leadDays?: number;
  defaultRole?: string;
  requiresEvidence?: boolean;
  /** Arrancan apagadas las que dependen de datos que la clínica quizá no tiene. */
  enabledByDefault?: boolean;
  items: string[];
}

export const SYSTEM_TEMPLATES: SystemTemplate[] = [
  {
    key: 'apertura',
    name: 'Apertura de clínica',
    description:
      'Lo que tiene que estar hecho antes del primer paciente. Si falla acá, el retraso se arrastra todo el día.',
    category: 'CLINICAL',
    priority: 'HIGH',
    recurrenceFreq: 'WEEKDAYS',
    dueTime: '08:30',
    defaultRole: 'recepción',
    items: [
      'Encender equipos, compresor y aspiración',
      'Purgar las líneas de agua de cada sillón (2 min)',
      'Comprobar autoclave: agua destilada y ciclo de test',
      'Revisar la agenda del día y marcar los huecos',
      'Verificar qué citas siguen sin confirmar',
      'Preparar el fondo de caja',
      'Dejar sala de espera y gabinetes presentables',
    ],
  },
  {
    key: 'huddle',
    name: 'Reunión de arranque (huddle)',
    description:
      'Diez minutos de pie con todo el equipo. Es la diferencia entre un día reactivo y un día planificado.',
    category: 'TEAM',
    priority: 'MEDIUM',
    recurrenceFreq: 'WEEKDAYS',
    dueTime: '09:00',
    items: [
      'Repasar la agenda paciente por paciente',
      'Marcar los pacientes con tratamiento pendiente de cerrar',
      'Identificar los huecos que hay que llenar hoy',
      'Confirmar qué franjas quedan reservadas para urgencias',
      'Fijar el objetivo de producción del día',
      'Avisos del equipo (ausencias, material, incidencias)',
    ],
  },
  {
    key: 'cierre',
    name: 'Cierre de clínica',
    description:
      'El cierre decide cómo empieza mañana. Incluye el arqueo, que exige evidencia para poder cerrarse.',
    category: 'ADMIN',
    priority: 'HIGH',
    recurrenceFreq: 'WEEKDAYS',
    dueTime: '20:00',
    defaultRole: 'recepción',
    requiresEvidence: true,
    items: [
      'Arqueo de caja y cuadre con los cobros del día',
      'Confirmar que la agenda de mañana está completa',
      'Comprobar que todas las llamadas del día quedaron devueltas',
      'Cargar y lanzar el ciclo de esterilización',
      'Apagar equipos, compresor y aspiración',
      'Dejar los gabinetes preparados para la apertura',
    ],
  },
  {
    key: 'esterilizacion-ciclo',
    name: 'Registro del ciclo de esterilización',
    description:
      'Trazabilidad diaria del autoclave. Es obligación legal registrar carga, resultado e incidencias.',
    category: 'CLINICAL',
    priority: 'HIGH',
    recurrenceFreq: 'WEEKDAYS',
    dueTime: '19:00',
    requiresEvidence: true,
    items: [
      'Anotar número de ciclo y contenido de la carga',
      'Comprobar los integradores químicos de la carga',
      'Archivar el ticket del autoclave',
      'Revisar sellado y etiquetado de las bolsas',
      'Registrar cualquier incidencia del equipo',
    ],
  },
  {
    key: 'control-biologico',
    name: 'Control biológico del autoclave',
    description:
      'El indicador biológico semanal es lo que demuestra que el autoclave realmente esteriliza.',
    category: 'COMPLIANCE',
    priority: 'HIGH',
    recurrenceFreq: 'WEEKLY',
    recurrenceWeekdays: [1],
    dueTime: '09:30',
    requiresEvidence: true,
    items: [
      'Colocar el indicador biológico en la carga',
      'Incubar según instrucciones del fabricante',
      'Leer el resultado a las 24 h',
      'Registrar en el libro de trazabilidad',
      'Guardar la evidencia (foto o ticket)',
    ],
  },
  {
    key: 'recall-semanal',
    name: 'Lista de recall e higienes vencidas',
    description:
      'Los pacientes que no vuelven no avisan: se van en silencio. Esta lista es la que los recupera.',
    category: 'PATIENT',
    priority: 'HIGH',
    recurrenceFreq: 'WEEKLY',
    recurrenceWeekdays: [2],
    dueTime: '10:00',
    defaultRole: 'recepción',
    items: [
      'Extraer el listado de higienes y revisiones vencidas',
      'Llamar a los 20 primeros por antigüedad',
      'Dejar WhatsApp a los que no contestaron',
      'Registrar el resultado de cada contacto',
      'Pasar los no contactables a campaña de reactivación',
    ],
  },
  {
    key: 'presupuestos-pendientes',
    name: 'Presupuestos aceptados sin agendar',
    description:
      'El KPI con mejor retorno de la clínica: el seguimiento sube la aceptación del 45-55% al 65-75%.',
    category: 'PATIENT',
    priority: 'URGENT',
    recurrenceFreq: 'WEEKLY',
    recurrenceWeekdays: [4],
    dueTime: '10:00',
    items: [
      'Listar presupuestos aceptados que no tienen cita',
      'Llamar priorizando por importe',
      'Ofrecer financiación cuando el freno sea el precio',
      'Agendar o registrar el motivo real del no',
      'Actualizar el estado en el CRM',
    ],
  },
  {
    key: 'no-shows-semana',
    name: 'Repaso de citas no asistidas y cancelaciones',
    description:
      'No es solo recuperar al paciente: es detectar qué franja horaria o qué tratamiento falla siempre.',
    category: 'PATIENT',
    priority: 'HIGH',
    recurrenceFreq: 'WEEKLY',
    recurrenceWeekdays: [5],
    dueTime: '12:00',
    items: [
      'Listar las citas no asistidas y las cancelaciones de la semana',
      'Contactar uno por uno para reagendar',
      'Aplicar la política de segunda falta',
      'Anotar la causa declarada',
      'Revisar si hay patrón por franja u odontólogo',
    ],
  },
  {
    key: 'stock',
    name: 'Pedido de material y caducidades',
    description:
      'Quedarse sin fungible en mitad de una endodoncia sale mucho más caro que el pedido.',
    category: 'ADMIN',
    priority: 'MEDIUM',
    recurrenceFreq: 'WEEKLY',
    recurrenceWeekdays: [3],
    dueTime: '16:00',
    items: [
      'Revisar mínimos de fungible por gabinete',
      'Revisar caducidades del mes en curso',
      'Consolidar el pedido en una sola compra',
      'Enviar el pedido a los proveedores',
      'Registrar la entrada de material al recibirlo',
    ],
  },
  {
    key: 'kpis-mensual',
    name: 'Revisión mensual de KPIs',
    description:
      'Una hora al mes mirando números. Sin esto no se sabe si la clínica crece o solo factura más.',
    category: 'ADMIN',
    priority: 'MEDIUM',
    recurrenceFreq: 'MONTHLY',
    recurrenceMonthDay: 1,
    dueTime: '10:00',
    leadDays: 2,
    items: [
      'Producción y cobro del mes cerrado',
      '% de aceptación de presupuestos',
      'Ocupación de gabinetes y huecos perdidos',
      '% de citas no asistidas y cancelaciones',
      'Pacientes nuevos y de dónde vinieron',
      'Elegir UNA acción concreta para el mes que entra',
    ],
  },
  {
    key: 'rgpd-trimestral',
    name: 'Revisión RGPD / LOPDGDD',
    description:
      'Los datos de salud son categoría especial: el RAT tiene que estar al día si la AEPD lo pide.',
    category: 'COMPLIANCE',
    priority: 'HIGH',
    recurrenceFreq: 'QUARTERLY',
    recurrenceMonthDay: 5,
    dueTime: '11:00',
    leadDays: 5,
    requiresEvidence: true,
    items: [
      'Revisar y actualizar el Registro de Actividades de Tratamiento',
      'Revisar contratos con encargados de tratamiento (laboratorio, software, gestoría)',
      'Comprobar consentimientos informados firmados y archivados',
      'Revisar permisos de acceso al software por persona',
      'Registrar incidencias de seguridad del trimestre',
    ],
  },
  {
    key: 'autoclave-validacion',
    name: 'Validación anual del autoclave',
    description:
      'Validación periódica obligatoria para certificar que el equipo trabaja dentro de los parámetros del fabricante.',
    category: 'COMPLIANCE',
    priority: 'URGENT',
    recurrenceFreq: 'YEARLY',
    recurrenceMonth: 1,
    recurrenceMonthDay: 15,
    dueTime: '10:00',
    leadDays: 30,
    requiresEvidence: true,
    items: [
      'Contactar al servicio técnico autorizado',
      'Agendar la validación',
      'Archivar el certificado emitido',
      'Actualizar el libro de mantenimiento del equipo',
    ],
  },
  {
    key: 'radiologia-utpr',
    name: 'Revisión anual de protección radiológica (UTPR)',
    description:
      'La instalación de rayos necesita una Unidad Técnica de Protección Radiológica que la revise y certifique.',
    category: 'COMPLIANCE',
    priority: 'URGENT',
    recurrenceFreq: 'YEARLY',
    recurrenceMonth: 2,
    recurrenceMonthDay: 15,
    dueTime: '10:00',
    leadDays: 30,
    requiresEvidence: true,
    items: [
      'Contactar a la UTPR contratada',
      'Agendar la revisión de los equipos de rayos',
      'Verificar las dosimetrías del personal expuesto',
      'Archivar el informe de la revisión',
      'Renovar la licencia de la instalación si toca',
    ],
  },
  {
    key: 'formacion-equipo',
    name: 'Formación y reciclaje del equipo',
    description:
      'Delegar sin formar es transferir el problema. Una sesión por trimestre sostiene el estándar.',
    category: 'TEAM',
    priority: 'MEDIUM',
    recurrenceFreq: 'QUARTERLY',
    recurrenceMonthDay: 20,
    dueTime: '15:00',
    leadDays: 7,
    items: [
      'Elegir el tema según los errores del trimestre',
      'Agendar la sesión con todo el equipo',
      'Registrar asistentes',
      'Guardar el material en la carpeta compartida',
      'Comprobar a las 4 semanas si cambió algo',
    ],
  },
  {
    key: 'resenas',
    name: 'Pedir reseñas a pacientes satisfechos',
    description:
      'La reseña se pide el mismo día que el paciente sale contento, no cuando hace falta subir la nota.',
    category: 'MARKETING',
    priority: 'LOW',
    recurrenceFreq: 'WEEKLY',
    recurrenceWeekdays: [5],
    dueTime: '17:00',
    items: [
      'Listar los tratamientos finalizados de la semana',
      'Filtrar los pacientes que salieron satisfechos',
      'Enviar el enlace de reseña por WhatsApp',
      'Agradecer las reseñas recibidas',
      'Responder las negativas en menos de 24 h',
    ],
  },
];

/**
 * Crea las rutinas del catálogo que falten en el tenant. Idempotente:
 * se puede llamar en cada carga de la página sin duplicar nada.
 *
 * No reescribe las existentes — si la clínica editó "Apertura", su versión
 * manda. Solo rellena los huecos (plantillas nuevas del catálogo incluidas).
 */
/**
 * ¿El tenant ya tiene el catálogo sembrado? Una query barata que le permite a
 * la página decidir si necesita provisionar de forma bloqueante (primera
 * visita) o puede mandarlo al background.
 */
export async function hasSystemTemplates(tenantId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: taskTemplates.id })
    .from(taskTemplates)
    .where(eq(taskTemplates.tenantId, tenantId))
    .limit(1);
  return !!row;
}

export async function seedSystemTemplates(tenantId: string): Promise<number> {
  const existing = await db
    .select({ key: taskTemplates.key })
    .from(taskTemplates)
    .where(eq(taskTemplates.tenantId, tenantId));
  const have = new Set(existing.map((r) => r.key).filter((k): k is string => !!k));

  const missing = SYSTEM_TEMPLATES.filter((t) => !have.has(t.key));
  if (missing.length === 0) return 0;

  for (const tpl of missing) {
    const [created] = await db
      .insert(taskTemplates)
      .values({
        tenantId,
        key: tpl.key,
        name: tpl.name,
        description: tpl.description,
        category: tpl.category,
        priority: tpl.priority,
        recurrenceFreq: tpl.recurrenceFreq,
        recurrenceInterval: tpl.recurrenceInterval ?? 1,
        recurrenceWeekdays: tpl.recurrenceWeekdays ?? [],
        recurrenceMonthDay: tpl.recurrenceMonthDay ?? null,
        recurrenceMonth: tpl.recurrenceMonth ?? null,
        dueTime: tpl.dueTime,
        leadDays: tpl.leadDays ?? 0,
        defaultRole: tpl.defaultRole ?? null,
        requiresEvidence: tpl.requiresEvidence ?? false,
        enabled: tpl.enabledByDefault ?? true,
        isSystem: true,
      })
      .onConflictDoNothing()
      .returning({ id: taskTemplates.id });

    if (!created) continue;
    if (tpl.items.length > 0) {
      await db.insert(taskTemplateItems).values(
        tpl.items.map((content, i) => ({
          tenantId,
          templateId: created.id,
          content,
          order: i,
        })),
      );
    }
  }

  return missing.length;
}

/** Items de checklist de varias plantillas, agrupados por templateId. */
export async function loadTemplateItems(
  tenantId: string,
  templateIds: string[],
): Promise<Map<string, { content: string; order: number }[]>> {
  const map = new Map<string, { content: string; order: number }[]>();
  if (templateIds.length === 0) return map;
  const rows = await db
    .select({
      templateId: taskTemplateItems.templateId,
      content: taskTemplateItems.content,
      order: taskTemplateItems.order,
    })
    .from(taskTemplateItems)
    .where(
      and(
        eq(taskTemplateItems.tenantId, tenantId),
        inArray(taskTemplateItems.templateId, templateIds),
      ),
    );
  for (const r of rows) {
    const list = map.get(r.templateId) ?? [];
    list.push({ content: r.content, order: r.order });
    map.set(r.templateId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.order - b.order);
  return map;
}
