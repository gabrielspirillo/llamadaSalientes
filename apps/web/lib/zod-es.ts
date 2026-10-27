import { type ZodErrorMap, ZodIssueCode, z } from 'zod';

/**
 * Mensajes de Zod en español para todo el servidor. Los esquemas que no ponen
 * su propio mensaje devolvían el de Zod en inglés ("String must contain at
 * most 800 character(s)") y llegaba tal cual al panel.
 */
export const spanishErrorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.too_big:
      return {
        message:
          issue.type === 'string'
            ? `Demasiado largo: máximo ${issue.maximum} caracteres.`
            : `El valor es demasiado grande (máximo ${issue.maximum}).`,
      };
    case ZodIssueCode.too_small:
      return {
        message:
          issue.type === 'string'
            ? Number(issue.minimum) <= 1
              ? 'Este campo es obligatorio.'
              : `Demasiado corto: mínimo ${issue.minimum} caracteres.`
            : `El valor es demasiado pequeño (mínimo ${issue.minimum}).`,
      };
    case ZodIssueCode.invalid_enum_value:
      return { message: 'Elige una de las opciones.' };
    case ZodIssueCode.invalid_string:
      return { message: issue.validation === 'email' ? 'Correo no válido.' : 'Formato no válido.' };
    case ZodIssueCode.invalid_type:
      return {
        message: issue.received === 'undefined' ? 'Falta un dato obligatorio.' : 'Dato no válido.',
      };
    default:
      return { message: ctx.defaultError };
  }
};

z.setErrorMap(spanishErrorMap);
