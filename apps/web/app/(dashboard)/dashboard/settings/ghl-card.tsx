'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { CheckCircle2, ExternalLink, KeyRound, Loader2, Unplug } from 'lucide-react';
import { useState, useTransition } from 'react';
import { connectGhlPitAction, disconnectGhlAction } from './ghl-actions';

type Props = {
  status:
    | { kind: 'disconnected' }
    | {
        kind: 'connected';
        locationId: string;
        scopes: string;
        connectedAt: Date;
        expiresAt: Date;
        method: 'oauth' | 'pit';
      };
};

export function GhlCard({ status }: Props) {
  if (status.kind === 'disconnected') return <DisconnectedState />;
  return (
    <ConnectedState
      locationId={status.locationId}
      scopes={status.scopes}
      connectedAt={status.connectedAt}
      method={status.method}
    />
  );
}

function DisconnectedState() {
  const [pitOpen, setPitOpen] = useState(false);
  const [pit, setPit] = useState('');
  const [locationId, setLocationId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handlePitConnect() {
    setError(null);
    startTransition(async () => {
      const r = await connectGhlPitAction({ pit, locationId });
      if (r.ok) {
        setPitOpen(false);
        setPit('');
        setLocationId('');
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <Card>
      <div className="p-6">
        <h3 className="text-base font-semibold tracking-tight">Integración GoHighLevel</h3>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <div className="h-2 w-2 rounded-full bg-zinc-300" />
          <span className="text-zinc-600">No conectada</span>
        </div>
        <p className="text-sm text-zinc-500 mt-3 leading-relaxed">
          Conectá tu sub-account de GHL para que el agente pueda agendar citas, sincronizar
          contactos y leer calendarios.
        </p>

        <div className="mt-5 space-y-2">
          <Dialog open={pitOpen} onOpenChange={setPitOpen}>
            <DialogTrigger asChild>
              <Button variant="primary" className="w-full">
                <KeyRound className="h-4 w-4" /> Conectar con Private Token
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Conectar GHL con Private Integration Token</DialogTitle>
                <DialogDescription>
                  En GHL: Settings → Integrations → Private Integrations → New Integration. Copiá el
                  token y el Location ID de tu sub-account.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 mt-2">
                <div>
                  <label className="text-sm font-medium" htmlFor="ghl-pit">
                    Private Integration Token
                  </label>
                  <input
                    id="ghl-pit"
                    type="password"
                    value={pit}
                    onChange={(e) => setPit(e.target.value)}
                    placeholder="pit-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="mt-1.5 w-full h-10 rounded-lg border border-zinc-200 px-3 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium" htmlFor="ghl-location">
                    Location ID
                  </label>
                  <input
                    id="ghl-location"
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                    placeholder="abc123XYZ..."
                    className="mt-1.5 w-full h-10 rounded-lg border border-zinc-200 px-3 text-sm font-mono"
                  />
                  <p className="text-xs text-zinc-500 mt-1.5">
                    Lo encontrás en GHL → Settings → Business Profile, o en la URL después de
                    /location/
                  </p>
                </div>
              </div>
              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setPitOpen(false)} disabled={isPending}>
                  Cancelar
                </Button>
                <Button onClick={handlePitConnect} disabled={isPending || !pit || !locationId}>
                  {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Conectar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Button asChild variant="secondary" className="w-full">
            <a href="/api/ghl/oauth/authorize">
              <ExternalLink className="h-4 w-4" /> O usar OAuth (marketplace)
            </a>
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ConnectedState({
  locationId,
  scopes,
  connectedAt,
  method,
}: {
  locationId: string;
  scopes: string;
  connectedAt: Date;
  method: 'oauth' | 'pit';
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDisconnect() {
    setError(null);
    startTransition(async () => {
      const r = await disconnectGhlAction();
      if (r.ok) setOpen(false);
      else setError(r.error);
    });
  }

  return (
    <Card>
      <div className="p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold tracking-tight">Integración GoHighLevel</h3>
          <Badge tone="success">
            <CheckCircle2 className="h-3 w-3" /> Conectada
          </Badge>
        </div>
        <div className="mt-4 space-y-2 text-sm">
          <Row label="Location ID" value={<code className="text-xs">{locationId}</code>} />
          <Row
            label="Método"
            value={method === 'pit' ? 'Private Integration Token' : 'OAuth'}
          />
          <Row
            label="Conectada"
            value={connectedAt.toLocaleDateString('es', { dateStyle: 'medium' })}
          />
          {method === 'oauth' && (
            <Row label="Permisos" value={`${scopes.split(' ').length} scopes`} />
          )}
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="secondary" size="sm" className="w-full mt-5">
              <Unplug className="h-4 w-4" /> Desconectar
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Desconectar GoHighLevel</DialogTitle>
              <DialogDescription>
                El agente dejará de poder agendar citas o consultar contactos. Las llamadas
                entrantes van a seguir contestándose, pero sin acceso al calendario van a derivarse
                a humano para agendar. ¿Seguro?
              </DialogDescription>
            </DialogHeader>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
                Cancelar
              </Button>
              <Button variant="danger" onClick={handleDisconnect} disabled={isPending}>
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Desconectar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
