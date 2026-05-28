import { ModuleGate } from '@/components/dashboard/module-gate';
import type { ReactNode } from 'react';

export default function CallsModuleLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="inbound">{children}</ModuleGate>;
}
