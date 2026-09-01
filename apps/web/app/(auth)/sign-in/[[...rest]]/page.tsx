import { AuthAside, AuthBrand } from '@/components/auth/auth-aside';
import { SignIn } from '@clerk/nextjs';
import { Quote } from 'lucide-react';

export default function SignInPage() {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-2">
      <div className="relative flex flex-col justify-center px-4 py-10 sm:px-8 sm:py-12">
        <AuthBrand />
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full animate-fade-up">
            <SignIn />
          </div>
        </div>
      </div>

      <AuthAside eyebrow="Caso real">
        <Quote className="mb-5 h-8 w-8 text-white/25" />
        <blockquote className="text-[28px] font-bold leading-snug tracking-tight">
          Pasamos de perder 3 de cada 10 llamadas a contestarlas todas. Las citas cerradas por
          teléfono subieron un 28% el primer mes.
        </blockquote>
        <div className="mt-8 flex items-center gap-3">
          <div className="h-11 w-11 rounded-full bg-[linear-gradient(135deg,#5fa896,#6bc2a4)] ring-2 ring-white/20" />
          <div>
            <p className="text-[15px] font-bold">Dra. Patricia Mendoza</p>
            <p className="text-[14px] text-white/60">Directora · Sonrisa Clínica Estética</p>
          </div>
        </div>

        <dl className="mt-10 grid grid-cols-3 gap-3">
          {[
            { k: '100%', v: 'llamadas atendidas' },
            { k: '+28%', v: 'conversión a cita' },
            { k: '24 h', v: 'todos los días' },
          ].map((s, i) => (
            <div
              key={s.k}
              className="animate-fade-up rounded-2xl bg-white/10 p-3.5 ring-1 ring-inset ring-white/10"
              style={{ animationDelay: `${300 + i * 120}ms` }}
            >
              <dt className="text-[22px] font-extrabold leading-none tracking-tight">{s.k}</dt>
              <dd className="mt-1.5 text-[12px] leading-tight text-white/60">{s.v}</dd>
            </div>
          ))}
        </dl>
      </AuthAside>
    </div>
  );
}
