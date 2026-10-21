import { AuthAside, AuthPanel, authAppearance } from '@/components/auth/auth-aside';
import { SignUp } from '@clerk/nextjs';
import { CheckCircle2 } from 'lucide-react';

const IMAGE = '/auth/registro.webp';
const IMAGE_POSITION = '62% 50%';

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
    <div className="grid min-h-screen bg-white lg:grid-cols-[minmax(0,45fr)_minmax(0,55fr)]">
      <AuthPanel
        image={IMAGE}
        imagePosition={IMAGE_POSITION}
        title="Crea tu cuenta"
        subtitle="En unos minutos tu clínica tiene su asistente atendiendo llamadas y WhatsApp."
      >
        <SignUp appearance={authAppearance} />
      </AuthPanel>

      <AuthAside image={IMAGE} imagePosition={IMAGE_POSITION} eyebrow="Lo que incluye">
        <div className="rounded-[26px] bg-white/10 p-7 ring-1 ring-inset ring-white/15 backdrop-blur-xl">
          <h2 className="text-[26px] font-extrabold leading-tight tracking-tight xl:text-[29px]">
            Tu asistente de voz, atendiendo llamadas esta semana.
          </h2>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {BENEFITS.map((b, i) => (
              <li
                key={b}
                className="flex animate-fade-up items-start gap-2.5 text-[14px] leading-snug text-white/90"
                style={{ animationDelay: `${200 + i * 90}ms` }}
              >
                <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[#6bc2a4]" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </AuthAside>
    </div>
  );
}
