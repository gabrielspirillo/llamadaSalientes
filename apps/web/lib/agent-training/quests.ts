/**
 * Retos: lo que la sección de entrenamiento le RECOMIENDA a la clínica.
 *
 * Nadie sabe de entrada qué hay que enseñarle a un asistente. La pantalla en
 * blanco es lo que hace que una clínica entre una vez, no se le ocurra nada y
 * no vuelva. Por eso el panel propone ajustes concretos, de uno en uno, con el
 * texto ya escrito: se leen, se aplican con un clic y el asistente cambia.
 *
 * Es un catálogo fijo y puro a propósito, no una llamada al LLM: sale al
 * instante, no cuesta tokens, es igual para todas las clínicas y se puede
 * testear. Para lo que no está aquí está el entrenador, que sí conversa.
 *
 * Un reto aplicado no vuelve a recomendarse: la enseñanza guarda su `questId`.
 */

import type { LessonKind } from './model';

export interface Quest {
  id: string;
  /** Titular del reto, en la voz del panel. */
  title: string;
  /** Por qué le conviene a la clínica. Una frase, sin jerga. */
  why: string;
  kind: LessonKind;
  /** Cuándo aplica, tal como entra en el prompt. Null = siempre. */
  situation: string | null;
  /** La instrucción que acaba leyendo el asistente. */
  instruction: string;
}

/**
 * El orden importa: es el orden en que se recomiendan. Delante lo que más
 * cambia una conversación con un lead, detrás los remates.
 */
export const QUESTS: readonly Quest[] = [
  {
    id: 'saludo-nombre',
    title: 'Que pregunte con quién habla',
    why: 'Saber el nombre desde el primer mensaje cambia el tono de toda la conversación.',
    kind: 'STYLE',
    situation: 'empiezas una conversación con alguien a quien no tienes identificado',
    instruction:
      'Después de presentarte, pregunta su nombre en la misma frase: "¿Con quién tengo el gusto de hablar?". Cuando te lo diga, úsalo en el resto de la conversación.',
  },
  {
    id: 'precio-valoracion',
    title: 'Que el precio no cierre la conversación',
    why: 'Soltar la cifra y callar es la forma más rápida de perder a alguien interesado.',
    kind: 'ANSWER',
    situation: 'preguntan cuánto cuesta un tratamiento',
    instruction:
      'Da el precio del catálogo si lo tienes, explica en una frase de qué depende el importe final y ofrécele una primera cita de valoración. No te quedes sólo en la cifra.',
  },
  {
    id: 'cierre-concreto',
    title: 'Que nunca deje la conversación abierta',
    why: '"Cualquier cosa me dices" es una conversación perdida. Una propuesta concreta no.',
    kind: 'RULE',
    situation: null,
    instruction:
      'Termina siempre con una pregunta o una propuesta concreta: un día y una hora, o si quiere que le reserves. Nunca cierres con "cualquier cosa me dices" ni con "quedo a tu disposición".',
  },
  {
    id: 'primera-visita',
    title: 'Que explique cómo es la primera visita',
    why: 'Quien no ha venido nunca no pide cita porque no sabe a qué viene.',
    kind: 'RULE',
    situation: 'alguien pide cita por primera vez',
    instruction:
      'Antes de ofrecerle hueco, explícale en una frase qué incluye la primera visita y cuánto dura. Después ofrécele las horas disponibles.',
  },
  {
    id: 'dolor-hoy',
    title: 'Que trate el dolor como lo que es',
    why: 'Quien escribe con dolor se va a otra clínica si le das hora para la semana que viene.',
    kind: 'RULE',
    situation: 'alguien dice que tiene dolor o que es urgente',
    instruction:
      'Ofrécele el primer hueco libre de hoy, aunque no lo haya pedido. Si hoy no queda ninguno, pasa la conversación a recepción explicando que es urgente.',
  },
  {
    id: 'mensajes-cortos',
    title: 'Que escriba corto',
    why: 'Un ladrillo de texto por WhatsApp no se lee.',
    kind: 'STYLE',
    situation: null,
    instruction:
      'Responde en dos o tres frases como mucho. Si hace falta contar más, pregunta primero si quiere el detalle en vez de soltar el texto entero.',
  },
  {
    id: 'sin-promesas',
    title: 'Que no prometa resultados',
    why: 'Una promesa por WhatsApp es una reclamación en la sala de espera.',
    kind: 'BOUNDARY',
    situation: null,
    instruction:
      'No prometas resultados, plazos de curación ni que un tratamiento no duele. Di que eso lo valora el profesional en la consulta.',
  },
  {
    id: 'datos-de-otro',
    title: 'Que proteja los datos del paciente',
    why: 'Detrás de un móvil puede haber alguien que no es el paciente.',
    kind: 'BOUNDARY',
    situation: 'te preguntan por la cita o el tratamiento de otra persona',
    instruction:
      'No des información clínica ni de citas a quien no sea el titular del teléfono. Pídele que escriba la persona interesada desde su móvil, o pasa la conversación a recepción.',
  },
  {
    id: 'fuera-de-horario',
    title: 'Que avise cuando escriben de madrugada',
    why: 'Saber cuándo le contestan evita el "no me habéis respondido".',
    kind: 'RULE',
    situation: 'te escriben fuera del horario de la clínica',
    instruction:
      'Dilo en una frase y añade a qué hora abre la clínica. Sigue atendiéndole con normalidad: no le dejes esperando.',
  },
  {
    id: 'como-llegar',
    title: 'Que explique cómo llegar',
    why: 'La dirección sola no sirve: la referencia y el parking, sí.',
    kind: 'ANSWER',
    situation: 'preguntan dónde estáis o cómo llegar',
    instruction:
      'Da la dirección de la clínica y añade una referencia para encontrarla. Si te preguntan por aparcar, contesta con lo que sepas y, si no lo sabes, dilo en vez de inventarlo.',
  },
  {
    id: 'segunda-oportunidad',
    title: 'Que insista una vez a quien no reserva',
    why: 'La mayoría de los que preguntan y no cierran, cierran si les das dos horas concretas.',
    kind: 'RULE',
    situation: 'alguien ha preguntado por un tratamiento y no ha reservado',
    instruction:
      'Antes de despedirte, ofrécele dos huecos concretos de esta semana. Si dice que se lo piensa, no insistas más de una vez.',
  },
  {
    id: 'confirmar-al-cerrar',
    title: 'Que confirme lo acordado al despedirse',
    why: 'Media línea de confirmación evita la mitad de los pacientes que no aparecen.',
    kind: 'STYLE',
    situation: 'acabas de reservar o cambiar una cita',
    instruction:
      'Despídete repitiendo en una línea el día, la hora y el tratamiento acordados. Si sabes su nombre, úsalo.',
  },
] as const;

export function questById(id: string): Quest | null {
  return QUESTS.find((q) => q.id === id) ?? null;
}

/** Los retos que todavía no ha aplicado esta clínica, en orden. */
export function pendingQuests(appliedIds: readonly string[]): Quest[] {
  const done = new Set(appliedIds);
  return QUESTS.filter((q) => !done.has(q.id));
}

// ─────────────────────────────────────────────────────────────────────────────
// Nivel del asistente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El nivel cuenta TODAS las enseñanzas activas, no sólo los retos.
 *
 * Si sólo contara los retas del catálogo, la clínica que se toma el trabajo de
 * enseñarle cosas suyas —que es justo lo que queremos— vería su asistente
 * estancado en el primer nivel.
 */
export interface AgentLevel {
  level: number;
  label: string;
  /** Enseñanzas activas que hacen falta para el siguiente nivel. Null en el último. */
  nextAt: number | null;
  /** 0..1 dentro del nivel actual. 1 en el último. */
  progress: number;
  /** Frase corta de estado, para la tarjeta. */
  blurb: string;
}

const NIVELES: ReadonlyArray<{ from: number; label: string; blurb: string }> = [
  {
    from: 0,
    label: 'Recién llegado',
    blurb: 'Atiende con lo que sabe de la clínica. Todavía no ha aprendido nada vuestro.',
  },
  {
    from: 1,
    label: 'Aprendiz',
    blurb: 'Ya tiene vuestras primeras indicaciones. Se nota en cómo abre la conversación.',
  },
  {
    from: 3,
    label: 'De la casa',
    blurb: 'Empieza a responder como responderíais vosotros.',
  },
  {
    from: 6,
    label: 'Veterano',
    blurb: 'Conoce vuestro criterio en lo que más se pregunta.',
  },
  {
    from: 10,
    label: 'Como el mejor de recepción',
    blurb: 'Tiene criterio propio de la clínica en casi todo lo que llega.',
  },
];

export function levelFor(activeLessons: number): AgentLevel {
  const n = Math.max(0, activeLessons);
  let idx = 0;
  for (let i = 0; i < NIVELES.length; i++) {
    if (n >= (NIVELES[i]?.from ?? 0)) idx = i;
  }
  const actual = NIVELES[idx];
  const siguiente = NIVELES[idx + 1];
  const desde = actual?.from ?? 0;
  const hasta = siguiente?.from ?? null;
  return {
    level: idx + 1,
    label: actual?.label ?? 'Recién llegado',
    blurb: actual?.blurb ?? '',
    nextAt: hasta,
    // Sin siguiente nivel la barra se llena: dejarla a medias en el último
    // parece un fallo, no un final.
    progress: hasta === null ? 1 : Math.min(1, (n - desde) / (hasta - desde)),
  };
}
