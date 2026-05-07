import { Button } from '@/components/ui/button';
import Link from 'next/link';

export function MarketingTopbar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-200/60 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-black">
            <span className="text-xs font-semibold text-white">D</span>
          </div>
          <span className="text-[15px] font-semibold tracking-tight">DentalVoice</span>
        </Link>

        <nav className="hidden md:flex items-center gap-7 text-sm text-zinc-600">
          <Link href="#producto" className="hover:text-zinc-900 transition-colors">
            Producto
          </Link>
          <Link href="#integraciones" className="hover:text-zinc-900 transition-colors">
            Integraciones
          </Link>
          <Link href="#precios" className="hover:text-zinc-900 transition-colors">
            Precios
          </Link>
          <Link href="/dashboard" className="hover:text-zinc-900 transition-colors">
            Demo
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sign-in">Iniciar sesión</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/sign-up">Empezar</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
