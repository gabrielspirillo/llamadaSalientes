import { MarketingTopbar } from '@/components/marketing/topbar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  ArrowRight,
  BarChart3,
  Calendar,
  Headphones,
  Phone,
  Shield,
  Sparkles,
  Zap,
} from 'lucide-react';
import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <MarketingTopbar />

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[600px] bg-gradient-to-b from-zinc-50 to-white" />
        <div className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-blue-100/40 blur-3xl" />

        <div className="mx-auto max-w-6xl px-6 pt-24 pb-16 md:pt-32 md:pb-24 text-center">
          <Badge tone="info" className="mb-6">
            <Sparkles className="h-3 w-3" /> Agente de voz con IA · 24/7
          </Badge>

          <h1 className="mx-auto max-w-4xl text-5xl md:text-7xl font-semibold tracking-tight leading-[1.05]">
            Tu clínica que nunca <br className="hidden md:block" />
            <span className="bg-gradient-to-br from-zinc-900 to-zinc-500 bg-clip-text text-transparent">
              deja un teléfono sin contestar.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg md:text-xl text-zinc-600 leading-relaxed">
            DentalVoice atiende llamadas, identifica al paciente, agenda citas y se sincroniza con
            GoHighLevel — todo sin intervención humana.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/sign-up">
                Probar gratis <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/dashboard">Ver demo →</Link>
            </Button>
          </div>

          <p className="mt-5 text-sm text-zinc-500">
            14 días gratis · Sin tarjeta · Cancelás cuando quieras
          </p>
        </div>

        {/* Mock dashboard preview */}
        <div className="mx-auto max-w-5xl px-6 pb-24">
          <div className="rounded-3xl border border-zinc-200/80 bg-white p-2 shadow-2xl shadow-zinc-200/40">
            <div className="rounded-2xl bg-zinc-50 p-6 md:p-10">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatPreview label="Llamadas hoy" value="47" delta="+12%" />
                <StatPreview label="Tiempo promedio" value="3:24" delta="-8s" />
                <StatPreview label="Conversión" value="64%" delta="+5pp" />
                <StatPreview label="Resueltas por IA" value="78%" delta="+2pp" />
              </div>
              <div className="mt-6 rounded-xl bg-white border border-zinc-200/70 p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-semibold">Últimas llamadas</p>
                  <span className="text-xs text-zinc-500">en vivo</span>
                </div>
                <div className="space-y-3">
                  <CallRowPreview
                    name="María González"
                    intent="Agendar cita"
                    time="hace 12 min"
                    tone="success"
                  />
                  <CallRowPreview
                    name="Carlos Ruiz"
                    intent="Consulta de precios"
                    time="hace 28 min"
                    tone="info"
                  />
                  <CallRowPreview
                    name="Ana Martínez"
                    intent="Reagendar"
                    time="hace 1 h"
                    tone="violet"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="producto" className="border-t border-zinc-200/60">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-blue-600">El producto</p>
            <h2 className="mt-2 text-4xl md:text-5xl font-semibold tracking-tight">
              Pensado para clínicas, no para developers.
            </h2>
            <p className="mt-4 text-lg text-zinc-600">
              Configurás tu agente desde un panel limpio en español. Sin código, sin integraciones
              raras, sin curva de aprendizaje.
            </p>
          </div>

          <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-6">
            <FeatureCard
              icon={<Phone className="h-5 w-5" />}
              title="Atiende 24/7"
              body="Toda llamada entrante se contesta al primer ring, en español neutro o regional."
            />
            <FeatureCard
              icon={<Calendar className="h-5 w-5" />}
              title="Agenda en GoHighLevel"
              body="Verifica disponibilidad, agenda, reagenda y cancela citas en tu sub-account."
            />
            <FeatureCard
              icon={<Sparkles className="h-5 w-5" />}
              title="Memoria del paciente"
              body="Reconoce al paciente por número y recupera contexto de visitas anteriores."
            />
            <FeatureCard
              icon={<Headphones className="h-5 w-5" />}
              title="Transferencia inteligente"
              body="Detecta urgencias y deriva a recepción automáticamente cuando hace falta."
            />
            <FeatureCard
              icon={<BarChart3 className="h-5 w-5" />}
              title="Métricas reales"
              body="AHT, conversión, containment y resúmenes de cada llamada con IA."
            />
            <FeatureCard
              icon={<Shield className="h-5 w-5" />}
              title="Seguro por diseño"
              body="Cifrado AES-256-GCM, RLS por tenant y consentimiento de grabación verbal."
            />
          </div>
        </div>
      </section>

      {/* INTEGRACIONES */}
      <section id="integraciones" className="border-t border-zinc-200/60 bg-zinc-50">
        <div className="mx-auto max-w-6xl px-6 py-24 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-sm font-medium text-blue-600">Integraciones</p>
            <h2 className="mt-2 text-4xl md:text-5xl font-semibold tracking-tight">
              Funciona con lo que ya tenés.
            </h2>
            <p className="mt-4 text-lg text-zinc-600">
              Conectás tu sub-account de GoHighLevel en un click. El número Twilio se importa
              automáticamente. El resto es pura conversación.
            </p>
            <ul className="mt-6 space-y-3 text-zinc-700">
              <li className="flex items-center gap-3">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                GoHighLevel API v2 (OAuth 2.0)
              </li>
              <li className="flex items-center gap-3">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Twilio (SIP termination)
              </li>
              <li className="flex items-center gap-3">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Retell AI · ElevenLabs (voces premium)
              </li>
              <li className="flex items-center gap-3">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Stripe (billing)
              </li>
            </ul>
          </div>
          <Card className="p-8">
            <div className="grid grid-cols-2 gap-3">
              {['GHL', 'Twilio', 'Retell', 'Stripe', 'Clerk', 'OpenAI'].map((n) => (
                <div
                  key={n}
                  className="aspect-[5/3] rounded-xl bg-gradient-to-br from-zinc-100 to-zinc-50 border border-zinc-200/60 flex items-center justify-center text-sm font-medium text-zinc-500"
                >
                  {n}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      {/* PRICING */}
      <section id="precios" className="border-t border-zinc-200/60">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="text-center max-w-2xl mx-auto">
            <p className="text-sm font-medium text-blue-600">Planes simples</p>
            <h2 className="mt-2 text-4xl md:text-5xl font-semibold tracking-tight">
              Pagás por lo que usás.
            </h2>
            <p className="mt-4 text-lg text-zinc-600">
              Sin sorpresas. Sin contratos largos. Cambiás de plan cuando quieras.
            </p>
          </div>

          <div className="mt-14 grid md:grid-cols-3 gap-6">
            <PricingCard
              name="Starter"
              price="$149"
              minutes="200"
              features={[
                '1 número Twilio',
                'Hasta 200 min/mes',
                'Dashboard completo',
                'Soporte por email',
              ]}
            />
            <PricingCard
              name="Pro"
              price="$299"
              minutes="600"
              features={[
                '1 número Twilio',
                'Hasta 600 min/mes',
                'Analytics avanzado',
                'Soporte prioritario',
              ]}
              highlighted
            />
            <PricingCard
              name="Premium"
              price="$499"
              minutes="1.500"
              features={[
                'Múltiples números',
                'Hasta 1.500 min/mes',
                'White-label',
                'Account manager',
              ]}
            />
          </div>

          <p className="mt-10 text-center text-sm text-zinc-500">
            Overage: $0.20/min · Sin costos de setup
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-zinc-200/60 bg-zinc-50">
        <div className="mx-auto max-w-4xl px-6 py-24 text-center">
          <h2 className="text-4xl md:text-5xl font-semibold tracking-tight">
            Empezá hoy. <br />
            <span className="text-zinc-500">Tu próxima llamada se contesta sola.</span>
          </h2>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/sign-up">
                Empezar ahora <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/dashboard">Ver demo</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-zinc-200/60">
        <div className="mx-auto max-w-6xl px-6 py-12 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-zinc-500">
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-black">
              <span className="text-[10px] font-semibold text-white">D</span>
            </div>
            <span>DentalVoice © 2026</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="#" className="hover:text-zinc-900">
              Términos
            </Link>
            <Link href="#" className="hover:text-zinc-900">
              Privacidad
            </Link>
            <Link href="#" className="hover:text-zinc-900">
              Contacto
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function StatPreview({ label, value, delta }: { label: string; value: string; delta: string }) {
  const positive = delta.startsWith('+') || delta.startsWith('-') === false;
  return (
    <div className="rounded-xl bg-white border border-zinc-200/70 p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight">{value}</span>
        <span className={`text-xs ${positive ? 'text-emerald-600' : 'text-zinc-500'}`}>
          {delta}
        </span>
      </div>
    </div>
  );
}

function CallRowPreview({
  name,
  intent,
  time,
  tone,
}: {
  name: string;
  intent: string;
  time: string;
  tone: 'success' | 'info' | 'violet';
}) {
  const dot =
    tone === 'success' ? 'bg-emerald-500' : tone === 'info' ? 'bg-blue-500' : 'bg-violet-500';
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-3">
        <div className={`h-2 w-2 rounded-full ${dot}`} />
        <div>
          <p className="font-medium">{name}</p>
          <p className="text-xs text-zinc-500">{intent}</p>
        </div>
      </div>
      <span className="text-xs text-zinc-400">{time}</span>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card className="p-7 transition-colors hover:border-zinc-300">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-white mb-5">
        {icon}
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm text-zinc-600 leading-relaxed">{body}</p>
    </Card>
  );
}

function PricingCard({
  name,
  price,
  minutes,
  features,
  highlighted,
}: {
  name: string;
  price: string;
  minutes: string;
  features: string[];
  highlighted?: boolean;
}) {
  return (
    <Card
      className={`p-8 ${highlighted ? 'border-zinc-900/80 ring-1 ring-zinc-900/80 shadow-xl shadow-zinc-200/60 scale-[1.02]' : ''}`}
    >
      {highlighted && (
        <Badge tone="info" className="mb-4">
          <Zap className="h-3 w-3" /> Más popular
        </Badge>
      )}
      <h3 className="text-xl font-semibold tracking-tight">{name}</h3>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-4xl font-semibold tracking-tight">{price}</span>
        <span className="text-sm text-zinc-500">/ mes</span>
      </div>
      <p className="mt-1 text-sm text-zinc-500">{minutes} minutos incluidos</p>
      <ul className="mt-6 space-y-2.5 text-sm">
        {features.map((f) => (
          <li key={f} className="flex items-center gap-2 text-zinc-700">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {f}
          </li>
        ))}
      </ul>
      <Button asChild className="mt-7 w-full" variant={highlighted ? 'primary' : 'secondary'}>
        <Link href="/sign-up">Empezar con {name}</Link>
      </Button>
    </Card>
  );
}
