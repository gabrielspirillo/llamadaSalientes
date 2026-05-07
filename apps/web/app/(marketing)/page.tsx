import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center space-y-6">
        <h1 className="text-5xl font-bold tracking-tight">DentalVoice</h1>
        <p className="text-lg text-gray-600">
          Agente de voz con IA para clínicas estéticas odontológicas. Atiende llamadas 24/7, agenda
          citas y se sincroniza con GoHighLevel.
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/sign-in" className="px-6 py-3 bg-black text-white rounded-md font-medium">
            Iniciar sesión
          </Link>
          <Link href="/sign-up" className="px-6 py-3 border border-gray-300 rounded-md font-medium">
            Crear cuenta
          </Link>
        </div>
      </div>
    </main>
  );
}
