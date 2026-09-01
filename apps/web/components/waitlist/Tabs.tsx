'use client';

import type { ReactNode } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function WaitlistTabs({
  queueCount,
  offersCount,
  historyCount,
  queue,
  offers,
  history,
}: {
  queueCount: number;
  offersCount: number;
  historyCount: number;
  queue: ReactNode;
  offers: ReactNode;
  history: ReactNode;
}) {
  return (
    <Tabs defaultValue="queue">
      <TabsList>
        <TabsTrigger value="queue">
          Cola activa
          <TabCount n={queueCount} />
        </TabsTrigger>
        <TabsTrigger value="offers">
          Ofertas en curso
          <TabCount n={offersCount} />
        </TabsTrigger>
        <TabsTrigger value="history">
          Histórico
          <TabCount n={historyCount} />
        </TabsTrigger>
      </TabsList>
      <TabsContent value="queue">{queue}</TabsContent>
      <TabsContent value="offers">{offers}</TabsContent>
      <TabsContent value="history">{history}</TabsContent>
    </Tabs>
  );
}

/** Contador dentro de la pestaña: hereda color según esté activa o no. */
function TabCount({ n }: { n: number }) {
  return (
    <span className="rounded-full bg-current/15 px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
      {n}
    </span>
  );
}
