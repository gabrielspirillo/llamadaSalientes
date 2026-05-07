import { SignUp } from '@clerk/nextjs';
import { CheckCircle2 } from 'lucide-react';

export default function SignUpPage() {
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-white">
      <div className="flex items-center justify-center px-8 py-12">
        <SignUp />
      </div>
      <div className="hidden lg:flex relative bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 items-center justify-center p-12 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(168,85,247,0.18),transparent_60%)]" />
        <div className="relative max-w-md text-white">
          <p className="text-sm text-zinc-400 mb-4 uppercase tracking-wider">Lo que incluye</p>
          <ul className="space-y-4">
            {[
              'Agente de voz IA listo en minutos',
              'Integración GoHighLevel en un click',
              'Atención 24/7 en español',
              'Dashboard de llamadas + analytics',
              'Cifrado AES-256 + compliance',
              '14 días gratis · sin tarjeta',
            ].map((b) => (
              <li key={b} className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
