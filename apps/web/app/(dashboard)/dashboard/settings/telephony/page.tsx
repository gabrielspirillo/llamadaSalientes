import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export default function TelephonyRedirectPage() {
  redirect('/dashboard/configuration?tab=telephony');
}

export const metadata: Metadata = { title: 'Telefonía' };
