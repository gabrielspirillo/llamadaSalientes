import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Mic, Phone, Save, Sparkles } from 'lucide-react';

const defaultPrompt = `Eres Sofía, asistente virtual de la clínica dental {{clinic_name}}. Tu rol es atender llamadas entrantes con calidez, profesionalismo y eficiencia.

ANTES DE EMPEZAR
Comienza siempre la primera frase con: "{{recording_consent_text}}".

CONTEXTO DEL PACIENTE
- Nombre detectado: {{patient_name}}
- ¿Es paciente conocido?: {{is_known_patient}}
- Última visita: {{last_visit_summary}}
- Tratamiento pendiente: {{pending_treatment}}

CAPACIDADES
1. Agendar, cancelar, reagendar y modificar citas usando las herramientas disponibles.
2. Responder preguntas sobre tratamientos y precios consultando treatment-info.
3. Responder preguntas sobre la clínica con clinic-info.
4. Transferir a un humano si el paciente lo pide o detectas urgencia médica.

REGLAS DURAS
- NUNCA des diagnósticos médicos.
- NUNCA confirmes precios que no estén en el catálogo.
- SIEMPRE confirma fecha y hora antes de agendar.`;

const voices = [
  { id: 'sofia', name: 'Sofía', accent: 'Español neutro', tone: 'Cercano · Profesional' },
  { id: 'lourdes', name: 'Lourdes', accent: 'Español ES', tone: 'Formal · Cálido' },
  { id: 'pilar', name: 'Pilar Durán', accent: 'Español MX', tone: 'Cercano · Joven' },
  { id: 'andrea', name: 'Andrea', accent: 'Español AR', tone: 'Casual · Amigable' },
];

export default function AgentPage() {
  return (
    <>
      <PageHeader
        title="Configuración del agente"
        description="Voz, prompt y comportamiento de Sofía."
        demoBadge
        actions={
          <>
            <Button variant="secondary" size="sm">
              <Phone className="h-4 w-4" /> Probar agente
            </Button>
            <Button size="sm">
              <Save className="h-4 w-4" /> Guardar
            </Button>
          </>
        }
      />

      <Tabs defaultValue="prompt">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="prompt">Prompt</TabsTrigger>
          <TabsTrigger value="voice">Voz</TabsTrigger>
          <TabsTrigger value="test">Pruebas</TabsTrigger>
          <TabsTrigger value="versions">Versiones</TabsTrigger>
        </TabsList>

        {/* General */}
        <TabsContent value="general">
          <Card>
            <div className="p-6 space-y-5 max-w-2xl">
              <div>
                <Label htmlFor="welcome">Mensaje de bienvenida</Label>
                <Input
                  id="welcome"
                  className="mt-2"
                  defaultValue="Esta llamada se está grabando para mejorar la calidad del servicio."
                />
              </div>
              <div>
                <Label htmlFor="transfer">Número de transferencia humano</Label>
                <Input id="transfer" className="mt-2" defaultValue="+52 555 100 2000" />
              </div>
              <div>
                <Label>Tono</Label>
                <div className="mt-2 flex gap-2">
                  <Button variant="secondary" size="sm">
                    Cercano
                  </Button>
                  <Button variant="ghost" size="sm">
                    Formal
                  </Button>
                  <Button variant="ghost" size="sm">
                    Neutral
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Prompt */}
        <TabsContent value="prompt">
          <Card>
            <div className="flex items-center justify-between p-6 pb-3">
              <div>
                <h3 className="text-base font-semibold tracking-tight">Editor de prompt</h3>
                <p className="text-sm text-zinc-500 mt-0.5">
                  Variables disponibles:{' '}
                  <code className="bg-zinc-100 px-1.5 py-0.5 rounded text-xs">
                    {'{{patient_name}}'}
                  </code>{' '}
                  <code className="bg-zinc-100 px-1.5 py-0.5 rounded text-xs">
                    {'{{clinic_name}}'}
                  </code>{' '}
                  <code className="bg-zinc-100 px-1.5 py-0.5 rounded text-xs">
                    {'{{current_date}}'}
                  </code>
                </p>
              </div>
              <Badge tone="info">v3 · activo</Badge>
            </div>
            <div className="p-6 pt-0">
              <Textarea
                defaultValue={defaultPrompt}
                className="font-mono text-xs min-h-[440px] leading-relaxed"
              />
              <div className="flex items-center justify-between mt-4">
                <p className="text-xs text-zinc-500">2.847 caracteres · ≈ 712 tokens</p>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm">
                    Cancelar
                  </Button>
                  <Button size="sm">
                    <Sparkles className="h-4 w-4" /> Mejorar con IA
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Voice */}
        <TabsContent value="voice">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {voices.map((v, i) => (
              <Card
                key={v.id}
                className={`p-5 cursor-pointer hover:border-zinc-300 transition-all ${i === 0 ? 'ring-2 ring-zinc-900/80 border-zinc-900/80' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center text-white text-sm font-semibold">
                      {v.name[0]}
                    </div>
                    <div>
                      <p className="font-medium">{v.name}</p>
                      <p className="text-xs text-zinc-500">{v.accent}</p>
                    </div>
                  </div>
                  <Button variant="secondary" size="icon">
                    <Mic className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-zinc-500 mt-3">{v.tone}</p>
                {i === 0 && (
                  <Badge tone="success" className="mt-3">
                    Voz activa
                  </Badge>
                )}
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Test */}
        <TabsContent value="test">
          <Card>
            <div className="p-10 text-center">
              <div className="mx-auto h-16 w-16 rounded-full bg-zinc-900 text-white flex items-center justify-center mb-4">
                <Phone className="h-7 w-7" />
              </div>
              <h3 className="text-xl font-semibold tracking-tight">Probar agente</h3>
              <p className="text-sm text-zinc-500 mt-2 max-w-sm mx-auto">
                Iniciá una llamada web para probar tu agente con el prompt y voz actual. No consume
                minutos del plan.
              </p>
              <Button size="lg" className="mt-6">
                <Phone className="h-4 w-4" /> Iniciar llamada de prueba
              </Button>
              <p className="text-xs text-zinc-400 mt-4">Última prueba: hace 2 días · 2:14 min</p>
            </div>
          </Card>
        </TabsContent>

        {/* Versions */}
        <TabsContent value="versions">
          <Card>
            <div className="divide-y divide-zinc-100">
              {[
                {
                  v: 'v3',
                  date: 'Hoy · 14:20',
                  author: 'Adrián',
                  current: true,
                  note: 'Refinado para reducir transferencias',
                },
                {
                  v: 'v2',
                  date: 'Hace 3 días',
                  author: 'Adrián',
                  current: false,
                  note: 'Agregadas FAQs de financiación',
                },
                {
                  v: 'v1',
                  date: 'Hace 1 semana',
                  author: 'Adrián',
                  current: false,
                  note: 'Versión inicial',
                },
              ].map((row) => (
                <div key={row.v} className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-4">
                    <Badge tone={row.current ? 'success' : 'neutral'}>{row.v}</Badge>
                    <div>
                      <p className="font-medium">{row.note}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {row.date} · {row.author}
                      </p>
                    </div>
                  </div>
                  {row.current ? (
                    <Badge tone="success">Activa</Badge>
                  ) : (
                    <Button variant="secondary" size="sm">
                      Restaurar
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
