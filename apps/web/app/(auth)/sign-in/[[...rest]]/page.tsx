import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-white">
      <div className="flex items-center justify-center px-8 py-12">
        <SignIn />
      </div>
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
