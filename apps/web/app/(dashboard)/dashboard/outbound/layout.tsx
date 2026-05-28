import { ModuleGate } from '@/components/dashboard/module-gate';
import type { ReactNode } from 'react';

export default function OutboundModuleLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="outbound">{children}</ModuleGate>;
}
