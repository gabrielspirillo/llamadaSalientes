import { PageHeader } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Save } from 'lucide-react';

const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Clínica"
        description="Información que el agente usa al hablar con pacientes."
        actions={
          <Button size="sm">
            <Save className="h-4 w-4" /> Guardar cambios
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <div className="p-6 space-y-5">
              <h3 className="text-base font-semibold tracking-tight">Información general</h3>
              <Field label="Nombre de la clínica" defaultValue="Clínica Demo Sonrisa" />
              <Field label="Dirección" defaultValue="Av. Reforma 123, Col. Centro, CDMX" />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Teléfono principal" defaultValue="+52 555 100 2000" />
                <Field label="Zona horaria" defaultValue="America/Mexico_City" />
              </div>
              <div>
                <Label>Mensaje fuera de horario</Label>
                <Textarea
                  className="mt-2"
                  defaultValue="Gracias por llamar. Estamos cerrados. Por favor, llamá entre las 9 y las 19 hs de lunes a viernes."
                />
              </div>
            </div>
          </Card>

          <Card>
            <div className="p-6">
              <h3 className="text-base font-semibold tracking-tight mb-4">Horarios</h3>
              <div className="space-y-2">
                {days.map((d, i) => (
                  <div key={d} className="flex items-center gap-4">
                    <span className="w-24 text-sm font-medium">{d}</span>
                    {i < 5 ? (
                      <>
                        <Input className="w-28" defaultValue="09:00" />
                        <span className="text-zinc-400 text-sm">a</span>
                        <Input className="w-28" defaultValue="19:00" />
                      </>
                    ) : i === 5 ? (
                      <>
                        <Input className="w-28" defaultValue="10:00" />
                        <span className="text-zinc-400 text-sm">a</span>
                        <Input className="w-28" defaultValue="14:00" />
                      </>
                    ) : (
                      <span className="text-sm text-zinc-400">Cerrado</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <div className="p-6">
              <h3 className="text-base font-semibold tracking-tight">Texto de consentimiento</h3>
              <p className="text-sm text-zinc-500 mt-1 mb-4">
                Lo que el agente dice al inicio de cada llamada (verbatim).
              </p>
              <Textarea defaultValue="Esta llamada se está grabando para mejorar la calidad del servicio. Si no querés que se grabe podés colgar y nuestra recepción te llamará de vuelta." />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <div className="p-6">
              <h3 className="text-base font-semibold tracking-tight">Idioma del agente</h3>
              <div className="mt-4 space-y-2">
                <button
                  type="button"
                  className="w-full flex items-center justify-between rounded-xl border border-zinc-900 bg-zinc-50 px-4 py-3"
                >
                  <span className="font-medium">Español neutro</span>
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                </button>
                <button
                  type="button"
                  className="w-full flex items-center justify-between rounded-xl border border-zinc-200 px-4 py-3 hover:border-zinc-300"
                >
                  <span className="text-zinc-600">English (US)</span>
                </button>
              </div>
            </div>
          </Card>

          <Card>
            <div className="p-6">
              <h3 className="text-base font-semibold tracking-tight">Integración GHL</h3>
              <div className="mt-3 flex items-center gap-2 text-sm">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-zinc-700">Conectado</span>
                <span className="ml-auto text-xs text-zinc-400">hace 5 días</span>
              </div>
              <p className="text-sm text-zinc-500 mt-3">
                Sub-account: <span className="font-medium text-zinc-700">Clínica Demo</span>
              </p>
              <Button variant="secondary" size="sm" className="mt-4 w-full">
                Reconectar
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Field({ label, defaultValue }: { label: string; defaultValue: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input className="mt-2" defaultValue={defaultValue} />
    </div>
  );
}
