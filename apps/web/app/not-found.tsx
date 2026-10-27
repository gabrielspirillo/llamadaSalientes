import Link from 'next/link';

/** 404 fuera del panel: en español y con salida, no la página de Next. */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-(--color-canvas) px-4 text-center">
      <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-brand-700">
        Error 404
      </p>
      <h1 className="text-2xl font-extrabold text-zinc-900">No encontramos esta página</h1>
      <p className="max-w-sm text-[15px] text-zinc-600">
        Puede que el enlace esté mal escrito o que la página ya no exista.
      </p>
      <Link
        href="/"
        className="rounded-[14px] bg-brand-600 px-5 py-2.5 text-[15px] font-semibold text-white"
      >
        Volver al inicio
      </Link>
    </main>
  );
}
