import { Badge } from '@/components/ui/badge';

/** Estado de una campaña saliente, el mismo en la lista y en la ficha. */
export function campaignStatusBadge(status: string) {
  switch (status) {
    case 'draft':
      return <Badge>Borrador</Badge>;
    case 'running':
      return <Badge tone="info">En curso</Badge>;
    case 'completed':
      return <Badge tone="success">Completada</Badge>;
    case 'failed':
      return <Badge tone="danger">Error</Badge>;
    case 'paused':
      return <Badge tone="warn">Pausada</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}
