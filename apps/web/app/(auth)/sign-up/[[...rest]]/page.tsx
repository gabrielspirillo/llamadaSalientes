import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { SignUp } from '@clerk/nextjs';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

export default function SignUpPage() {
  if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <AuthShell>
        <SignUp />
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="w-full max-w-sm">
        <Link href="/" className="inline-flex items-center gap-2 mb-8">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-black">
            <span className="text-xs font-semibold text-white">D</span>
          </div>
          <span className="text-[15px] font-semibold tracking-tight">DentalVoice</span>
        </Link>

        <h1 className="text-3xl font-semibold tracking-tight">Empezá tu prueba</h1>
        <p className="text-sm text-zinc-500 mt-2">14 días gratis · sin tarjeta</p>

        <form className="mt-8 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="first">Nombre</Label>
              <Input id="first" className="mt-2" />
            </div>
            <div>
              <Label htmlFor="last">Apellido</Label>
              <Input id="last" className="mt-2" />
            </div>
          </div>
          <div>
            <Label htmlFor="email">Email del trabajo</Label>
            <Input id="email" type="email" placeholder="vos@clinica.com" className="mt-2" />
          </div>
          <div>
            <Label htmlFor="clinic">Nombre de la clínica</Label>
            <Input id="clinic" className="mt-2" />
          </div>
          <div>
            <Label htmlFor="password">Contraseña</Label>
            <Input id="password" type="password" className="mt-2" />
          </div>
          <Button className="w-full" size="lg" type="submit">
            Crear cuenta <ArrowRight className="h-4 w-4" />
          </Button>
        </form>

        <p className="mt-8 text-sm text-zinc-500 text-center">
          ¿Ya tenés cuenta?{' '}
          <Link href="/sign-in" className="font-medium text-zinc-900 hover:underline">
            Iniciar sesión
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-white">
      <div className="flex items-center justify-center px-8 py-12">{children}</div>
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
