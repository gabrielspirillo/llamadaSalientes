import { PageHeader } from '@/components/dashboard/page-header';
import { AgentTester } from '@/components/dashboard/agent-tester';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getAgentConfig } from '@/lib/data/agent-config';
import { getCurrentTenantOrNull } from '@/lib/tenant';
import Link from 'next/link';
import { saveAgentConfigAction } from './actions';

export default async function AgentPage() {
  const ctx = await getCurrentTenantOrNull();
  const config = ctx ? await getAgentConfig(ctx.tenant.id) : null;

  return (
    <>
      <PageHeader
        title="Configuración del agente"
        description="Voz, prompt, comportamiento y prueba en vivo."
        actions={
          <Button asChild variant="secondary" size="sm">
            <a href="https://dashboard.retellai.com" target="_blank" rel="noreferrer">
              Abrir Retell ↗
            </a>
          </Button>
        }
      />

      <Tabs defaultValue="test">
        <TabsList>
          <TabsTrigger value="test">Probar en vivo</TabsTrigger>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="prompt">Prompt</TabsTrigger>
        </TabsList>

        {/* Test (live web call) */}
        <TabsContent value="test">
          {!config?.retellAgentId && !process.env.RETELL_DEFAULT_AGENT_ID ? (
            <Card>
              <div className="p-10 text-center max-w-lg mx-auto">
                <h3 className="text-lg font-semibold tracking-tight">Falta vincular el agente</h3>
                <p className="text-sm text-zinc-500 mt-2">
                  Para probar el agente necesitamos su <strong>Retell Agent ID</strong>. Lo encontrás
                  en el dashboard de Retell debajo del nombre de tu agente.
                </p>
                <Button asChild className="mt-5">
                  <Link href="?tab=general">Configurar Agent ID</Link>
                </Button>
              </div>
            </Card>
          ) : (
            <AgentTester />
          )}
        </TabsContent>

        {/* General config */}
        <TabsContent value="general">
          {!ctx ? (
            <Card>
              <div className="p-10 text-center text-sm text-zinc-500">Iniciá sesión para configurar.</div>
            </Card>
          ) : (
            <Card>
              <form action={saveAgentConfigAction} className="p-6 space-y-5 max-w-2xl">
                <Field
                  label="Retell Agent ID"
                  name="retellAgentId"
                  defaultValue={config?.retellAgentId ?? ''}
                  placeholder="agent_xxxxxxxxxxxxxxxxxxxxxx"
                  hint="Lo encontrás debajo del nombre del agente en dashboard.retellai.com"
                />
                <Field
                  label="Voz"
                  name="voiceId"
                  defaultValue={config?.voiceId ?? ''}
                  placeholder="11labs-Sofia"
                  hint="ID de la voz que elegiste en Retell."
                />
                <Field
                  label="Mensaje de bienvenida"
                  name="welcomeMessage"
                  defaultValue={config?.welcomeMessage ?? ''}
                  placeholder="Dental Nobel, soy Manuel. ¿En qué le puedo ayudar?"
                />
                <Field
                  label="Número de transferencia"
                  name="transferNumber"
                  defaultValue={config?.transferNumber ?? ''}
                  placeholder="+34 91 000 0000"
                  hint="Si el paciente pide un humano, se transfiere acá."
                />
                <div>
                  <label className="text-sm font-medium" htmlFor="tone">
                    Tono
                  </label>
                  <select
                    id="tone"
                    name="tone"
                    defaultValue={config?.tone ?? 'cercano'}
                    className="mt-2 w-full h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm"
                  >
                    <option value="cercano">Cercano</option>
                    <option value="formal">Formal</option>
                    <option value="neutral">Neutral</option>
                  </select>
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-zinc-100">
                  <p className="text-xs text-zinc-500">
                    {config ? (
                      <>
                        Última actualización:{' '}
                        <span className="font-medium">
                          {new Date(config.updatedAt).toLocaleString('es-ES')}
                        </span>
                      </>
                    ) : (
                      'Sin configuración guardada todavía.'
                    )}
                  </p>
                  <Button type="submit">Guardar cambios</Button>
                </div>
              </form>
            </Card>
          )}
        </TabsContent>

        {/* Prompt editor */}
        <TabsContent value="prompt">
          {!ctx ? (
            <Card>
              <div className="p-10 text-center text-sm text-zinc-500">Iniciá sesión para configurar.</div>
            </Card>
          ) : (
            <Card>
              <div className="flex items-center justify-between p-6 pb-3">
                <div>
                  <h3 className="text-base font-semibold tracking-tight">Editor de prompt local</h3>
                  <p className="text-sm text-zinc-500 mt-0.5">
                    Esta es una copia de referencia. El prompt productivo vive en Retell — los cambios
                    se sincronizan al guardar.
                  </p>
                </div>
                <Badge tone={config?.published ? 'success' : 'neutral'}>
                  v{config?.promptVersion ?? 1} · {config?.published ? 'publicado' : 'borrador'}
                </Badge>
              </div>
              <form action={saveAgentConfigAction} className="p-6 pt-0">
                <textarea
                  name="currentPromptText"
                  defaultValue={config?.currentPromptText ?? ''}
                  className="w-full font-mono text-xs min-h-[440px] leading-relaxed rounded-lg border border-zinc-200 px-3 py-3"
                  placeholder="Eres Manuel, asistente de Dental Nobel..."
                />
                <div className="flex items-center justify-end mt-4">
                  <Button type="submit">Guardar prompt</Button>
                </div>
              </form>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  hint,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="text-sm font-medium" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="mt-2 w-full h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
      />
      {hint && <p className="text-xs text-zinc-500 mt-1.5">{hint}</p>}
    </div>
  );
}
