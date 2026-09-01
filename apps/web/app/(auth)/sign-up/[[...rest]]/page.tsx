import { AuthAside, AuthBrand } from '@/components/auth/auth-aside';
import { SignUp } from '@clerk/nextjs';
import { CheckCircle2 } from 'lucide-react';

const BENEFITS = [
  'Asistente de voz con IA listo en minutos',
  'Integración con GoHighLevel en un clic',
  'Atención en español, las 24 horas',
  'Panel de llamadas y estadísticas',
  'Cifrado AES-256 y cumplimiento normativo',
  '14 días gratis, sin tarjeta',
];

export default function SignUpPage() {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-2">
      <div className="relative flex flex-col justify-center px-4 py-10 sm:px-8 sm:py-12">
        <AuthBrand />
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full animate-fade-up">
            <SignUp />
          </div>
        </div>
      </div>

      <AuthAside eyebrow="Lo que incluye">
        <h2 className="text-[34px] font-extrabold leading-tight tracking-tight">
          Tu asistente de voz,
          <br />
          atendiendo llamadas esta semana.
        </h2>
        <ul className="mt-8 space-y-3.5">
          {BENEFITS.map((b, i) => (
            <li
              key={b}
              className="flex animate-fade-up items-start gap-3 text-[17px] text-white/90"
              style={{ animationDelay: `${200 + i * 90}ms` }}
            >
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </AuthAside>
    </div>
  );
}
