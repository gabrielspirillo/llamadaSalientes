import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowRight, MessageCircle } from 'lucide-react';
import Link from 'next/link';

export function WhatsappModule() {
  return (
    <Card>
      <div className="px-6 py-16 text-center max-w-md mx-auto">
        <div className="h-12 w-12 inline-flex items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 mb-4">
          <MessageCircle className="h-5 w-5" />
        </div>
        <p className="text-base font-semibold tracking-tight">WhatsApp</p>
        <p className="text-sm text-zinc-500 mt-1.5">
          Conversaciones activas, handoff, mensajes por hora y revenue atribuido aparecerán
          acá cuando se conecte la integración.
        </p>
        <Button asChild variant="secondary" size="sm" className="mt-5">
          <Link href="/dashboard/whatsapp">
            Ir a WhatsApp <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </Card>
  );
}
