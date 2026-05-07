import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { SignIn } from '@clerk/nextjs';
import { ArrowRight, Lock } from 'lucide-react';
import Link from 'next/link';

export default function SignInPage() {
  if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <AuthShell>
        <SignIn />
      </AuthShell>
    );
  }

  // Fase 0: placeholder visual sin Clerk
  return (
    <AuthShell>
      <div className="w-full max-w-sm">
        <Link href="/" className="inline-flex items-center gap-2 mb-8">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-black">
            <span className="text-xs font-semibold text-white">D</span>
          </div>
          <span className="text-[15px] font-semibold tracking-tight">DentalVoice</span>
        </Link>

        <h1 className="text-3xl font-semibold tracking-tight">Bienvenido de vuelta</h1>
        <p className="text-sm text-zinc-500 mt-2">
          Ingresá a tu panel para gestionar tu agente de voz.
        </p>

        <form className="mt-8 space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="vos@clinica.com" className="mt-2" />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Contraseña</Label>
              <Link href="#" className="text-xs text-blue-600 hover:underline">
                ¿Olvidaste?
              </Link>
            </div>
            <Input id="password" type="password" className="mt-2" />
          </div>
          <Button className="w-full" size="lg" type="submit">
            Continuar <ArrowRight className="h-4 w-4" />
          </Button>
        </form>

        <div className="my-6 flex items-center gap-3 text-xs text-zinc-400">
          <div className="h-px flex-1 bg-zinc-200" />
          o
          <div className="h-px flex-1 bg-zinc-200" />
        </div>

        <Button variant="secondary" className="w-full" size="lg">
          Continuar con Google
        </Button>

        <p className="mt-8 text-sm text-zinc-500 text-center">
          ¿No tenés cuenta?{' '}
          <Link href="/sign-up" className="font-medium text-zinc-900 hover:underline">
            Crear una
          </Link>
        </p>

        <div className="mt-10 flex items-center justify-center gap-1.5 text-xs text-zinc-400">
          <Lock className="h-3 w-3" /> Conexión cifrada · Clerk pendiente (Fase 1)
        </div>
      </div>
    </AuthShell>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-white">
      <div className="flex items-center justify-center px-8 py-12">{children}</div>
      <div className="hidden lg:flex relative bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 items-center justify-center p-12 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.18),transparent_60%)]" />
        <div className="relative max-w-md text-white">
          <p className="text-sm text-zinc-400 mb-4 uppercase tracking-wider">Caso real</p>
          <h2 className="text-3xl font-semibold leading-tight">
            "Pasamos de perder 3 de cada 10 llamadas a contestar el 100%. La conversión a cita subió
            28% en el primer mes."
          </h2>
          <div className="mt-8 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-violet-500" />
            <div>
              <p className="font-medium">Dra. Patricia Mendoza</p>
              <p className="text-sm text-zinc-400">Directora · Sonrisa Clínica Estética</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
