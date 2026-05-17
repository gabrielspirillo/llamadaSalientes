import { inngest } from '@/lib/inngest/client';
import { processCall } from '@/lib/inngest/functions/process-call';
import { whatsappProcess } from '@/lib/inngest/functions/whatsapp-process';
import { serve } from 'inngest/next';

export const runtime = 'nodejs';

// Inngest expone su propio handler. La validación de firma corre adentro
// usando INNGEST_SIGNING_KEY del env.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processCall, whatsappProcess],
});
