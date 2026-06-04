-- Contador de mensajes entrantes sin leer por conversación de WhatsApp.
-- Se incrementa al recibir un inbound nuevo (persistInboundMessage) y se
-- resetea a 0 al abrir la conversación en el inbox.
ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS unread_count integer NOT NULL DEFAULT 0;
