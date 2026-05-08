import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { processCall } from '@/lib/inngest/functions/process-call';

export const runtime = 'nodejs';

// Inngest expone su propio handler. La validación de firma corre adentro
// usando INNGEST_SIGNING_KEY del env.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processCall],
});
