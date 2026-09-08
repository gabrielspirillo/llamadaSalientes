import { AgentTester } from '@/components/dashboard/agent-tester';
import { PageHeader } from '@/components/dashboard/page-header';
import { WhatsappTester } from '@/components/dashboard/whatsapp-tester';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { SegmentedNav } from '@/components/ui/tabs';
import { getAgentConfig } from '@/lib/data/agent-config';
import { getCurrentTenantOrNull } from '@/lib/tenant';
import { Bot, MessageSquare, PhoneIncoming, PhoneOutgoing } from 'lucide-react';

export const dynamic = 'force-dynamic';

/** Los tres canales que atienden a un paciente, y que hay que poder probar. */
const CANALES = ['entrante', 'saliente', 'whatsapp'] as const;
type Canal = (typeof CANALES)[number];

function normalizarCanal(v: string | undefined): Canal {
  return CANALES.includes(v as Canal) ? (v as Canal) : 'entrante';
}

const DESCRIPCION: Record<Canal, string> = {
  entrante: 'Habla con el asistente que atiende a quien llama a la clínica, desde el navegador.',
  saliente: 'Habla con el asistente que llama al paciente. Es otro agente y otro guion.',
  whatsapp: 'Escríbele al asistente de WhatsApp y mira qué consulta antes de responder.',
};

export default async function AgentPage({
  searchParams,
}: {
  searchParams: Promise<{ canal?: string }>;
}) {
  const canal = normalizarCanal((await searchParams).canal);
  const ctx = await getCurrentTenantOrNull();

  // Cada sentido tiene su propio agente: que haya entrante no significa que
  // haya saliente, y decir "listo para probar" sin comprobarlo mandaba al
  // usuario a un error de Retell.
  const [entrante, saliente] = ctx
    ? await Promise.all([
        getAgentConfig(ctx.tenant.id, 'inbound'),
        getAgentConfig(ctx.tenant.id, 'outbound'),
      ])
    : [null, null];

  const hayEntrante =
    Boolean(entrante?.retellAgentId) || Boolean(process.env.RETELL_DEFAULT_AGENT_ID);
  const haySaliente =
    Boolean(saliente?.retellAgentId) ||
    Boolean(process.env.RETELL_OUTBOUND_DEFAULT_AGENT_ID) ||
    Boolean(process.env.RETELL_DEFAULT_AGENT_ID);

  const items = [
    {
      value: 'entrante',
      label: (
        <span className="inline-flex items-center gap-1.5">
          <PhoneIncoming className="h-3.5 w-3.5" />
          Llamadas entrantes
        </span>
      ),
      href: '/dashboard/agent?canal=entrante',
    },
    {
      value: 'saliente',
      label: (
        <span className="inline-flex items-center gap-1.5">
          <PhoneOutgoing className="h-3.5 w-3.5" />
          Llamadas salientes
        </span>
      ),
      href: '/dashboard/agent?canal=saliente',
    },
    {
      value: 'whatsapp',
      label: (
        <span className="inline-flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5" />
          WhatsApp
        </span>
      ),
      href: '/dashboard/agent?canal=whatsapp',
    },
  ];

  const sinAgente = (
    <Card>
      <EmptyState
        icon={<Bot className="h-5 w-5" />}
        title="Asistente sin vincular"
        description="Tu administrador tiene que vincular el asistente antes de que puedas probarlo."
      />
    </Card>
  );

  return (
    <>
      <PageHeader
        eyebrow="Pruebas"
        icon={<Bot className="h-5 w-5" />}
        title="Probar el asistente"
        description={DESCRIPCION[canal]}
      />

      <SegmentedNav items={items} activeValue={canal} className="mb-5" />

      {/* La `key` fuerza a remontar al cambiar de pestaña: sin ella React
          reutiliza el componente y la transcripción del entrante aparecía
          dentro de la prueba del saliente. */}
      {canal === 'whatsapp' ? (
        <WhatsappTester />
      ) : canal === 'saliente' ? (
        haySaliente ? (
          <AgentTester key="saliente" direccion="outbound" />
        ) : (
          sinAgente
        )
      ) : hayEntrante ? (
        <AgentTester key="entrante" direccion="inbound" />
      ) : (
        sinAgente
      )}
    </>
  );
}
