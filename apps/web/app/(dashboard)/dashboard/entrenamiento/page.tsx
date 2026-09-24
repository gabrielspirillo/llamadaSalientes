import { PageHeader } from '@/components/dashboard/page-header';
import { WhatsappTester } from '@/components/dashboard/whatsapp-tester';
import { LessonActions } from '@/components/entrenamiento/lesson-actions';
import { LessonDialog } from '@/components/entrenamiento/lesson-dialog';
import { QuestBoard } from '@/components/entrenamiento/quest-board';
import { type ChatTurn, TrainerChat } from '@/components/entrenamiento/trainer-chat';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Callout, EmptyState } from '@/components/ui/feedback';
import { Stagger } from '@/components/ui/motion';
import { SegmentedNav } from '@/components/ui/tabs';
import {
  listAppliedQuestIds,
  listLessons,
  listTrainingMessages,
} from '@/lib/agent-training/lessons';
import {
  LESSON_KIND_LABEL,
  LESSON_KIND_TONE,
  MAX_LESSONS_IN_PROMPT,
} from '@/lib/agent-training/model';
import { levelFor, pendingQuests } from '@/lib/agent-training/quests';
import { getWhatsappAgentSettings } from '@/lib/data/whatsapp-agent-settings';
import { getCurrentTenant } from '@/lib/tenant';
import { BookOpen, GraduationCap, MessageSquare, Plus, Sparkles } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

/**
 * Entrenar al asistente.
 *
 * Tres pestañas, y las tres son el mismo círculo: le cuentas qué salió mal,
 * apruebas lo que te propone, y lo pruebas ahí mismo con el asistente de
 * verdad. Sin ese último paso el entrenamiento es un acto de fe.
 *
 * Las pestañas se resuelven por URL, no con `TabsContent`: son Server
 * Components y Radix sólo las esconde con CSS, así que las tres se
 * ejecutarían y se enviarían en cada visita.
 */
const PESTANAS = ['ensenar', 'aprendido', 'probar'] as const;
type Pestana = (typeof PESTANAS)[number];

function normalizar(v: string | undefined): Pestana {
  return PESTANAS.includes(v as Pestana) ? (v as Pestana) : 'ensenar';
}

const DESCRIPCION: Record<Pestana, string> = {
  ensenar:
    'Cuéntale qué quieres que responda mejor, o aplica uno de los ajustes que te recomienda.',
  aprendido: 'Todo lo que tu asistente ha aprendido de vosotros. Se puede editar y pausar.',
  probar: 'Escríbele como si fueras un paciente y comprueba que ha aprendido.',
};

export default async function EntrenamientoPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const tab = normalizar((await searchParams).tab);
  const { tenant } = await getCurrentTenant();

  const [lessons, settings] = await Promise.all([
    listLessons(tenant.id),
    getWhatsappAgentSettings(tenant.id).catch(() => null),
  ]);
  const activas = lessons.filter((l) => l.status === 'ACTIVE');
  const agentName = settings?.agentName?.trim() || 'tu asistente';

  const items = [
    {
      value: 'ensenar',
      label: (
        <span className="inline-flex items-center gap-1.5">
          <GraduationCap className="h-3.5 w-3.5" />
          Enseñar
        </span>
      ),
      href: '/dashboard/entrenamiento?tab=ensenar',
    },
    {
      value: 'aprendido',
      label: (
        <span className="inline-flex items-center gap-1.5">
          <BookOpen className="h-3.5 w-3.5" />
          Lo aprendido
          {activas.length > 0 && (
            <Badge tone="brand" size="sm">
              {activas.length}
            </Badge>
          )}
        </span>
      ),
      href: '/dashboard/entrenamiento?tab=aprendido',
    },
    {
      value: 'probar',
      label: (
        <span className="inline-flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5" />
          Probar
        </span>
      ),
      href: '/dashboard/entrenamiento?tab=probar',
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Asistente"
        icon={<Sparkles className="h-5 w-5" />}
        title="Entrenar al asistente"
        description={DESCRIPCION[tab]}
        actions={
          tab === 'aprendido' ? (
            <LessonDialog
              trigger={
                <Button size="sm">
                  <Plus className="h-4 w-4" /> Enseñar a mano
                </Button>
              }
            />
          ) : undefined
        }
      />

      <SegmentedNav items={items} activeValue={tab} className="mb-5" />

      {tab === 'ensenar' && (
        <div className="grid gap-5 lg:grid-cols-3 lg:items-start">
          <div className="lg:col-span-2">
            <TrainerChat
              agentName={agentName}
              initialTurns={(await listTrainingMessages(tenant.id)).map(
                (m): ChatTurn => ({
                  id: m.id,
                  role: m.role,
                  content: m.content,
                  proposals: m.proposals,
                }),
              )}
            />
          </div>
          <QuestBoard
            level={levelFor(activas.length)}
            pending={pendingQuests(await listAppliedQuestIds(tenant.id))}
            activeLessons={activas.length}
          />
        </div>
      )}

      {tab === 'aprendido' && (
        <div className="space-y-4">
          {activas.length >= MAX_LESSONS_IN_PROMPT && (
            <Callout tone="warn" title="Has llegado al máximo">
              Tu asistente tiene en cuenta las {MAX_LESSONS_IN_PROMPT} enseñanzas más recientes.
              Pausa o borra las que ya no apliquen para que entren las nuevas.
            </Callout>
          )}

          {lessons.length === 0 ? (
            <Card>
              <EmptyState
                icon={<BookOpen className="h-5 w-5" />}
                title="Tu asistente aún no ha aprendido nada vuestro"
                description="Atiende con lo que sabe de la clínica: tratamientos, preguntas frecuentes, horarios y la agenda. Cuéntale en la pestaña Enseñar qué quieres que haga distinto."
                action={
                  <Button asChild size="sm">
                    <Link href="/dashboard/entrenamiento?tab=ensenar">
                      <GraduationCap className="h-4 w-4" /> Enseñarle algo
                    </Link>
                  </Button>
                }
              />
            </Card>
          ) : (
            <Stagger className="space-y-3">
              {lessons.map((l) => (
                <Card
                  key={l.id}
                  className={`p-4 sm:p-5 ${l.status === 'PAUSED' ? 'opacity-60' : ''}`}
                >
                  <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:gap-4">
                    <div className="w-full min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge tone={LESSON_KIND_TONE[l.kind]} size="sm">
                          {LESSON_KIND_LABEL[l.kind]}
                        </Badge>
                        {l.status === 'PAUSED' && (
                          <Badge tone="neutral" size="sm">
                            En pausa
                          </Badge>
                        )}
                        {l.source === 'MANUAL' && (
                          <span className="text-[12px] text-zinc-400">escrita a mano</span>
                        )}
                      </div>
                      <p className="text-[15px] font-semibold text-zinc-900">{l.title}</p>
                      {l.situation && (
                        <p className="mt-0.5 text-[12px] text-zinc-500">Cuando {l.situation}</p>
                      )}
                      <p className="mt-2 text-[14px] leading-relaxed text-zinc-600">
                        {l.instruction}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <LessonDialog
                        lesson={{
                          id: l.id,
                          kind: l.kind,
                          title: l.title,
                          situation: l.situation,
                          instruction: l.instruction,
                        }}
                        trigger={
                          <Button variant="ghost" size="sm">
                            Editar
                          </Button>
                        }
                      />
                      <LessonActions id={l.id} status={l.status} />
                    </div>
                  </div>
                </Card>
              ))}
            </Stagger>
          )}
        </div>
      )}

      {tab === 'probar' && (
        <div className="space-y-4">
          <Callout tone="brand" icon={<Sparkles className="h-4 w-4" />}>
            Hablas con el asistente de verdad, con lo que ya le has enseñado
            {activas.length > 0 ? ` (${activas.length})` : ''}. Consulta la agenda de verdad, así
            que si reservas una cita en la prueba, la cita queda.
          </Callout>
          <WhatsappTester />
        </div>
      )}
    </>
  );
}
