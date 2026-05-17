// Punto de entrada del módulo de analytics. Para nuevos consumers,
// importar directo desde los sub-módulos (./global, ./outbound, etc.).
// Este index mantiene back-compat con `@/lib/data/analytics`.

export type { AnalyticsRange, InboundAnalytics } from './inbound';
export { getInboundAnalytics } from './inbound';

// Alias legacy: el dashboard actual sigue usando getAnalytics.
export { getInboundAnalytics as getAnalytics } from './inbound';
