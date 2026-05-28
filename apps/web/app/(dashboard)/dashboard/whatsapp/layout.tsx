import { ModuleGate } from '@/components/dashboard/module-gate';
import type { ReactNode } from 'react';

export default function WhatsappModuleLayout({ children }: { children: ReactNode }) {
  return <ModuleGate moduleKey="whatsapp">{children}</ModuleGate>;
}
