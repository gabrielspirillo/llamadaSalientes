import 'server-only';
import Retell from 'retell-sdk';

// Lo que ve quien lleva la clínica: neutro, sin nombrar a Retell, ni crédito,
// ni claves, ni agentes. Esos detalles son internos —del operador del
// sistema— y no accionables para el usuario final. El motivo real de cada
// fallo queda en `detail` para el log del servidor, no en pantalla.
const USER_MESSAGE =
  'Estamos haciendo unos ajustes en el sistema y el asistente no está disponible ahora mismo. Vuelve a intentarlo en un rato.';

/**
 * Traduce un fallo de la API de Retell a lo que se muestra en pantalla más el
 * detalle técnico para el log.
 *
 * `message` es siempre el mismo aviso neutro: cualquier problema (crédito
 * agotado, clave caducada, agente borrado, corte de red) se enseña como "unos
 * ajustes en el sistema", nunca como el error crudo. Antes esto subía como un
 * "Error 500" pelado; ahora el usuario lee algo tranquilizador y quien opera
 * el sistema tiene el porqué exacto en `detail`.
 */
export function describeRetellError(err: unknown): {
  status: number;
  message: string;
  detail: string;
} {
  if (err instanceof Retell.APIError) {
    const detail =
      (typeof err.error === 'object' && err.error && 'message' in err.error
        ? String((err.error as { message?: unknown }).message ?? '')
        : '') || err.message;

    // El status HTTP sí refleja la causa (para métricas y para el cliente),
    // aunque el texto sea el mismo para todos.
    const status = err.status === 402 || err.status === 429 ? err.status : err.status ? 502 : 500;

    return { status, message: USER_MESSAGE, detail: `retell ${err.status}: ${detail}` };
  }

  if (err instanceof Retell.APIConnectionError) {
    return { status: 504, message: USER_MESSAGE, detail: `conexión con retell: ${err.message}` };
  }

  return {
    status: 500,
    message: USER_MESSAGE,
    detail: err instanceof Error ? err.message : String(err),
  };
}
