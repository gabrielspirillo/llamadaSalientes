import { redirect } from 'next/navigation';

export default function WhatsappIntegrationsRedirectPage() {
  redirect('/dashboard/configuration?tab=whatsapp');
}
