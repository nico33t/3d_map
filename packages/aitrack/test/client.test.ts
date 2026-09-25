import { afterEach, expect, it, vi } from 'vitest';
import { createAitrackClient, AitrackError } from '../src/index.js';
import { verifyAitrackWebhook } from '../src/webhooks.js';
import { createHmac } from 'node:crypto';

afterEach(() => vi.useRealTimers());

it('uses the documented v2 endpoint and X-API-Key header', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [], meta: { pagination: { limit: 1, offset: 0, count: 0 } } })));
  const client = createAitrackClient({ apiKey: 'test-secret', fetch: fetcher });
  const result = await client.listDevices({ limit: 1 });
  expect(result.data).toEqual([]);
  expect(fetcher.mock.calls[0]![0]).toBe('https://api.aitrack.it/api/v2/devices?limit=1');
  expect(fetcher.mock.calls[0]![1].headers).toEqual({ Accept: 'application/json', 'X-API-Key': 'test-secret' });
  expect(fetcher.mock.calls[0]![1].redirect).toBe('error');
});

it('supports the browser proxy without adding credentials', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] })));
  await createAitrackClient({ baseUrl: '/api/aitrack', fetch: fetcher }).listEvents();
  expect(fetcher.mock.calls[0]![0]).toBe('/api/aitrack/events');
  expect(fetcher.mock.calls[0]![1].headers).not.toHaveProperty('X-API-Key');
});

it.each([
  [{ error: { code: 'DEVICE_NOT_FOUND', message: 'Missing device' } }, 404, 'DEVICE_NOT_FOUND'],
  [{ error: 'Rate limit superato' }, 429, 'HTTP_429'],
])('normalizes documented structured and legacy errors', async (body, status, code) => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: status as number }));
  await expect(createAitrackClient({ fetch: fetcher }).listDevices()).rejects.toMatchObject({ name: 'AitrackError', code });
});

it('deduplicates timestamps and stops polling after cancellation', async () => {
  vi.useFakeTimers();
  const location = { latitude: 41, longitude: 12, speed_kmh: 0, recorded_at: '2026-09-25T10:00:00Z' };
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data: location })));
  const onLocation = vi.fn();
  const stop = createAitrackClient({ fetch: fetcher }).watchLocation('000000000000001', { onLocation });
  await vi.advanceTimersByTimeAsync(10_001);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(onLocation).toHaveBeenCalledOnce();
  stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('stops on a revoked/unauthorized key instead of retrying indefinitely', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }));
  const onError = vi.fn();
  createAitrackClient({ fetch: fetcher }).watchLocation('000000000000001', { onLocation: vi.fn(), onError });
  await vi.advanceTimersByTimeAsync(120_000);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(onError.mock.calls[0]![0]).toBeInstanceOf(AitrackError);
});

it('verifies webhook HMAC over the raw body and rejects tampering', () => {
  const body = '{"id":"evt_test","data":{}}';
  const signature = 'sha256=' + createHmac('sha256', 'test-secret').update(body).digest('hex');
  expect(verifyAitrackWebhook(body, signature, 'test-secret')).toBe(true);
  expect(verifyAitrackWebhook(body + ' ', signature, 'test-secret')).toBe(false);
  expect(verifyAitrackWebhook(body, 'invalid', 'test-secret')).toBe(false);
  expect(verifyAitrackWebhook(body, signature, 'test-secret', 'v2')).toBe(false);
});
