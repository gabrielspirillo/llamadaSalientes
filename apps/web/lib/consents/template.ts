// Plantilla del consentimiento informado y lo que se rellena en ella.
//
// El texto del consentimiento es de la clínica (lo redactó ella y lo cambia
// ella), así que vive en la base (`consent_templates`) como bloques
// estructurados, no en el código. Este módulo sólo sabe leerlos y rellenar
// el mensaje de WhatsApp. Es puro: sin base, sin `server-only`, con tests.

import { z } from 'zod';

export const consentBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal('paragraph'), text: z.string().trim().min(1).max(4000) }),
  z.object({
    type: z.literal('bullets'),
    items: z.array(z.string().trim().min(1).max(1000)).min(1).max(40),
  }),
  z.object({
    type: z.literal('numbered'),
    items: z
      .array(z.object({ title: z.string().trim().min(1).max(200), text: z.string().trim().max(3000) }))
      .min(1)
      .max(40),
  }),
]);
export type ConsentBlock = z.infer<typeof consentBlockSchema>;

export const consentBodySchema = z.array(consentBlockSchema).min(1).max(80);
export type ConsentBody = z.infer<typeof consentBodySchema>;

/** Lo que el tutor declara al firmar. Se imprimen antes de la firma. */
export const acknowledgmentsSchema = z.array(z.string().trim().min(1).max(600)).max(12);

export function parseConsentBody(raw: unknown): ConsentBody | null {
  const parsed = consentBodySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseAcknowledgments(raw: unknown): string[] {
  const parsed = acknowledgmentsSchema.safeParse(raw ?? []);
  return parsed.success ? parsed.data : [];
}

export interface ConsentTemplate {
  id: string;
  key: string;
  title: string;
  body: ConsentBody;
  acknowledgments: string[];
  /** Texto del WhatsApp con el enlace. Null = el texto por defecto. */
  messageTemplate: string | null;
}

/** Quién firma y por quién. Todo lo que se imprime relleno en el PDF. */
export interface ConsentParties {
  clinicName: string;
  childName: string;
  /** 'dd/mm/aaaa' ya formateada, o null si no consta. */
  childBirthDate: string | null;
  guardianName: string;
  guardianDni: string | null;
  guardianAddress: string | null;
  guardianPhone: string | null;
  guardianPhone2: string | null;
  guardianEmail: string | null;
  /** Fecha de emisión, 'dd/mm/aaaa' en hora de la clínica. */
  issuedOn: string;
}

export const DEFAULT_CONSENT_MESSAGE =
  'Hola {{tutor}}, te escribimos de {{clinica}}. Para poder atender a {{paciente}} necesitamos que leas y firmes el consentimiento informado. Puedes hacerlo desde el móvil, en este enlace:\n{{enlace}}\nSi tienes cualquier duda, respóndenos por aquí.';

export interface ConsentMessageVars {
  tutor: string;
  paciente: string;
  clinica: string;
  enlace: string;
}

/**
 * Rellena el mensaje de WhatsApp. Los marcadores son {{tutor}}, {{paciente}},
 * {{clinica}} y {{enlace}}; cualquier otro se deja tal cual, para que un
 * error de tipeo en la plantilla se vea en vez de desaparecer. Si la plantilla
 * no lleva {{enlace}}, se añade al final: un mensaje sin el enlace no sirve.
 */
export function renderConsentMessage(template: string | null, vars: ConsentMessageVars): string {
  const base = template?.trim() || DEFAULT_CONSENT_MESSAGE;
  const filled = base.replace(/\{\{\s*(tutor|paciente|clinica|enlace)\s*\}\}/g, (_m, key) => {
    return vars[key as keyof ConsentMessageVars];
  });
  return filled.includes(vars.enlace) ? filled : `${filled}\n${vars.enlace}`;
}

/** 'YYYY-MM-DD' → 'dd/mm/aaaa'. Devuelve null si no parsea. */
export function formatDateKeyEs(key: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key ?? '');
  if (!m) return null;
  return `${m[3]}/${m[2]}/${m[1]}`;
}
