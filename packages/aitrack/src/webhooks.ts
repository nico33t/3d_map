import { createHmac, timingSafeEqual } from 'node:crypto';

/** Node-only verification on the exact raw body, before JSON parsing. */
export function verifyAitrackWebhook(rawBody: string | Uint8Array, signature: string | undefined, secret: string, version = 'v1'): boolean {
  if (!secret || version !== 'v1' || !signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}

export interface AitrackWebhookEvent {
  id: string;
  type: string;
  created_at: string;
  data: Record<string, unknown>;
}
