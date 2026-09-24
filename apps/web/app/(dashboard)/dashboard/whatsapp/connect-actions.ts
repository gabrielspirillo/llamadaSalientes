'use server';

import { revalidatePath } from 'next/cache';

import { canManageWhatsappConnection } from '@/lib/whatsapp/connection-access';

import { connectEvolution, disconnect, getEvolutionConnectionState } from './integrations/actions';

/**
 * Alta de WhatsApp para la propia clínica (dueño o administrador).
 *
 * La pantalla técnica de conexiones vive en `/dashboard/configuration` y sólo
 * la ve Futura, así que hasta aquí una clínica no tenía forma de vincular su
 * número por su cuenta. Esta capa expone LO MÍNIMO —pedir el código y saber si
 * ya quedó vinculado— y traduce los errores del proveedor a un mensaje que
 * pueda leer quien atiende la recepción: el nombre del proveedor, la instancia
 * y el detalle del fallo se quedan en el log del servidor.
 */

export type ConnectResult<T> = { success: true; data: T } | { success: false; error: string };

const GENERIC_ERROR =
  'No pudimos generar el código de vinculación. Inténtalo de nuevo en unos segundos; si sigue fallando, avísanos.';

/** Gate de rol: vincular el número de la clínica es cosa del administrador. */
async function assertAdmin(): Promise<string | null> {
  return (await canManageWhatsappConnection())
    ? null
    : 'Solo el administrador de la clínica puede conectar o desconectar WhatsApp.';
}

export async function requestWhatsappQr(): Promise<
  ConnectResult<{ qrBase64: string | null; pairingCode: string | null; connected: boolean }>
> {
  const denied = await assertAdmin();
  if (denied) return { success: false, error: denied };

  const res = await connectEvolution();
  if (!res.success) {
    console.warn('[whatsapp-connect] no se pudo pedir el QR:', res.error);
    return { success: false, error: GENERIC_ERROR };
  }

  revalidatePath('/dashboard/whatsapp');

  // Sin QR ni código, el número ya estaba vinculado: lo confirmamos contra el
  // servidor en vez de asumirlo, que es lo que distingue "conectado" de "el
  // proveedor no nos devolvió nada".
  if (!res.data.qrBase64 && !res.data.pairingCode) {
    const state = await getEvolutionConnectionState();
    return {
      success: true,
      data: {
        qrBase64: null,
        pairingCode: null,
        connected: state.success && state.data.status === 'CONNECTED',
      },
    };
  }

  return {
    success: true,
    data: {
      qrBase64: res.data.qrBase64,
      pairingCode: res.data.pairingCode,
      connected: false,
    },
  };
}

export async function checkWhatsappLink(): Promise<ConnectResult<{ connected: boolean }>> {
  const denied = await assertAdmin();
  if (denied) return { success: false, error: denied };

  const res = await getEvolutionConnectionState();
  if (!res.success) {
    console.warn('[whatsapp-connect] no se pudo consultar el estado:', res.error);
    return { success: false, error: 'No pudimos comprobar el estado de la conexión.' };
  }

  const connected = res.data.status === 'CONNECTED';
  if (connected) revalidatePath('/dashboard/whatsapp');
  return { success: true, data: { connected } };
}

export async function disconnectWhatsapp(): Promise<ConnectResult<null>> {
  const denied = await assertAdmin();
  if (denied) return { success: false, error: denied };

  const res = await disconnect({ mode: 'EVOLUTION' });
  if (!res.success) {
    console.warn('[whatsapp-connect] no se pudo desconectar:', res.error);
    return {
      success: false,
      error:
        'No pudimos cerrar la sesión de WhatsApp. Inténtalo de nuevo; si sigue fallando, avísanos.',
    };
  }

  revalidatePath('/dashboard/whatsapp');
  return { success: true, data: null };
}
