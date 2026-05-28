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
        <TabsTrigger value="queue">Cola activa ({queueCount})</TabsTrigger>
        <TabsTrigger value="offers">Ofertas en curso ({offersCount})</TabsTrigger>
        <TabsTrigger value="history">Histórico ({historyCount})</TabsTrigger>
      </TabsList>
      <TabsContent value="queue">{queue}</TabsContent>
      <TabsContent value="offers">{offers}</TabsContent>
      <TabsContent value="history">{history}</TabsContent>
    </Tabs>
  );
}
