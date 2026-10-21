import { AuthAside, AuthPanel, authAppearance } from '@/components/auth/auth-aside';
import { SignIn } from '@clerk/nextjs';
import { Quote } from 'lucide-react';

const IMAGE = '/auth/acceso.webp';
const IMAGE_POSITION = '72% 30%';

export default function SignInPage() {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[minmax(0,45fr)_minmax(0,55fr)]">
      <AuthPanel
        image={IMAGE}
        imagePosition={IMAGE_POSITION}
        title="Hola de nuevo"
        subtitle="Entra al panel de tu clínica: agenda, pacientes, llamadas y WhatsApp en un solo sitio."
      >
        <SignIn appearance={authAppearance} />
      </AuthPanel>

      <AuthAside image={IMAGE} imagePosition={IMAGE_POSITION} eyebrow="Caso real">
        <div className="rounded-[26px] bg-white/10 p-7 ring-1 ring-inset ring-white/15 backdrop-blur-xl">
          <Quote className="mb-4 h-7 w-7 text-[#6bc2a4]" />
          <blockquote className="text-[24px] font-bold leading-snug tracking-tight xl:text-[27px]">
            Pasamos de perder 3 de cada 10 llamadas a contestarlas todas. Las citas cerradas por
            teléfono subieron un 28% el primer mes.
          </blockquote>
          <div className="mt-6 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-full bg-[linear-gradient(135deg,#5fa896,#6bc2a4)] text-[14px] font-bold ring-2 ring-white/25">
              PM
            </div>
            <div>
              <p className="text-[15px] font-bold">Dra. Patricia Mendoza</p>
              <p className="text-[13px] text-white/65">Directora · Sonrisa Clínica Estética</p>
            </div>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-3">
          {[
            { k: '100%', v: 'llamadas atendidas' },
            { k: '+28%', v: 'conversión a cita' },
            { k: '24 h', v: 'todos los días' },
          ].map((s, i) => (
            <div
              key={s.k}
              className="animate-fade-up rounded-2xl bg-white/10 p-4 ring-1 ring-inset ring-white/15 backdrop-blur-xl"
              style={{ animationDelay: `${300 + i * 120}ms` }}
            >
              <dt className="text-[24px] font-extrabold leading-none tracking-tight">{s.k}</dt>
              <dd className="mt-1.5 text-[12px] leading-tight text-white/65">{s.v}</dd>
            </div>
          ))}
        </dl>
      </AuthAside>
    </div>
  );
}
