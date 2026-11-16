import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export default function WhatsappIntegrationsRedirectPage() {
  redirect('/dashboard/configuration?tab=whatsapp');
}

export const metadata: Metadata = { title: 'Conexión de WhatsApp' };
