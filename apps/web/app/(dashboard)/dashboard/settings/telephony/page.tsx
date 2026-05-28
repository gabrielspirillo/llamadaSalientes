import { redirect } from 'next/navigation';

export default function TelephonyRedirectPage() {
  redirect('/dashboard/configuration?tab=telephony');
}
