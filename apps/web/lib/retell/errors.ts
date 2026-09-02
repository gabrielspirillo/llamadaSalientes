import 'server-only';
import Retell from 'retell-sdk';

/**
 * Traduce un fallo de la API de Retell a algo que se pueda enseñar en pantalla.
 *
 * Sin esto, cualquier problema de la cuenta (crédito agotado, clave caducada,
 * agente borrado) llegaba al navegador como un 500 pelado: el usuario leía
 * "Error 500" y no había forma de saber si la culpa era nuestra o de Retell.
 * Los mensajes van dirigidos a quien lleva la clínica, no a un programador.
 */
export function describeRetellError(err: unknown): { status: number; message: string } {
  if (err instanceof Retell.APIError) {
    const detail =
      (typeof err.error === 'object' && err.error && 'message' in err.error
        ? String((err.error as { message?: unknown }).message ?? '')
        : '') || err.message;

    switch (err.status) {
      case 402:
        return {
          status: 402,
          message:
            'La cuenta de Retell se ha quedado sin crédito: hay que añadir un método de pago en su panel para poder llamar. Hasta entonces el asistente no puede atender ni llamar.',
        };
      case 401:
      case 403:
        return {
          status: 502,
          message:
            'Retell ha rechazado nuestras credenciales. Hay que revisar la clave de API en la configuración del servidor.',
        };
      case 404:
        return {
          status: 502,
          message:
            'Retell no encuentra el agente configurado. Puede que se haya borrado desde su panel: revisa el Agent ID en Asistente.',
        };
      case 429:
        return {
          status: 429,
          message: 'Retell está limitando las peticiones. Espera unos segundos y vuelve a probar.',
        };
      default:
        return {
          status: 502,
          message: `Retell ha devuelto un error${err.status ? ` (${err.status})` : ''}${
            detail ? `: ${detail}` : '.'
          }`,
        };
    }
  }

  if (err instanceof Retell.APIConnectionError) {
    return {
      status: 504,
      message: 'No se ha podido contactar con Retell. Puede ser un corte temporal suyo.',
    };
  }

  return {
    status: 500,
    message: err instanceof Error ? err.message : 'Error inesperado al hablar con Retell.',
  };
}
