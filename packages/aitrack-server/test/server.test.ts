import { it, expect, vi } from 'vitest';
import { createLocationHub, nextPollDelay } from '../src/hub.js';
import { createAitrackGateway } from '../src/index.js';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
it('shares one GPS request and deduplicates fixes across listeners', async () => {
    const fix = { longitude: 12, latitude: 41, recorded_at: new Date().toISOString(), speed_kmh: 30 };
    const fetcher = vi.fn(async () => fix as any);
    const hub = createLocationHub(fetcher);
    const a = vi.fn(), b = vi.fn();
    const stopA = hub.subscribe('000000000000001', a), stopB = hub.subscribe('000000000000001', b);
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    hub.notifyEvent();
    await Promise.resolve();
    expect(a).toHaveBeenCalledTimes(1);
    stopA();
    expect(hub.activeDevices).toBe(1);
    stopB();
    expect(hub.activeDevices).toBe(0);
    hub.close();
});
it('slows polling when stopped or stale', () => { const fix = { recorded_at: new Date().toISOString(), speed_kmh: 0 } as any; expect(nextPollDelay(fix)).toBe(45000); expect(nextPollDelay({ ...fix, recorded_at: '2020-01-01' })).toBe(60000); });
it('public ingress only accepts signed deliveries and deduplicates the delivery header', async () => {
    const secret = 'test-webhook-secret';
    const gateway = createAitrackGateway({ apiKey: '', webhookSecret: secret });
    const server = createServer((req, res) => { void gateway.webhook(req, res); });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    try {
        expect((await fetch(origin + '/api/cameras')).status).toBe(404);
        const body = JSON.stringify({ type: 'ping' }), signature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
        const send = (sig = signature) => fetch(origin + '/webhooks/aitrack', { method: 'POST', body, headers: { 'x-aitrack-signature': sig, 'x-aitrack-timestamp': String(Date.now()), 'x-aitrack-delivery-id': 'delivery-one' } });
        expect((await send('invalid')).status).toBe(401);
        expect((await send()).status).toBe(202);
        expect(await (await send()).json()).toMatchObject({ duplicate: true });
    }
    finally {
        gateway.close();
        await new Promise<void>(r => server.close(() => r()));
    }
});
