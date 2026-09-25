import { describe, it, expect } from 'vitest';
import { nearbyCameras, distanceMeters } from '../src/index.js';
import { validateCamera, publicCamera, createRtspService } from '../src/server.js';
import { createServer, get } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const input = { name: 'Ingresso', rtspUrl: 'rtsp://user:secret@192.168.1.2/live', latitude: 41.9, longitude: 12.5, radiusMeters: 200, enabled: true };
describe('RTSP integration', () => {
    it('validates coordinates and only accepts RTSP sources', () => { expect(() => validateCamera({ ...input, rtspUrl: 'file:///etc/passwd' })).toThrow(); expect(() => validateCamera({ ...input, latitude: NaN })).toThrow(); expect(() => validateCamera({ ...input, radiusMeters: 0 })).toThrow(); expect(validateCamera(input).name).toBe('Ingresso'); });
    it('never exposes source credentials in public metadata', () => { expect(JSON.stringify(publicCamera({ ...input, id: 'a' }))).not.toContain('secret'); expect(publicCamera({ ...input, id: 'a' })).not.toHaveProperty('rtspUrl'); });
    it('uses distance, activation and exit hysteresis', () => { const c = { ...publicCamera({ ...input, id: 'a' }), latitude: 0, longitude: 0, radiusMeters: 100 }; expect(distanceMeters(c, c)).toBe(0); expect(nearbyCameras([c], { latitude: 0, longitude: .00095 })).toHaveLength(0); expect(nearbyCameras([c], { latitude: 0, longitude: .00095 }, new Set(['a']))).toHaveLength(1); expect(nearbyCameras([{ ...c, enabled: false }], c)).toHaveLength(0); });
    it('persists privately, rejects cross-origin writes, and stops serving disabled cameras', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'rtsp-test-'));
        const service = createRtspService({ storageDir: dir });
        const server = createServer((req, res) => { void service.middleware(req, res, () => res.writeHead(404).end()); });
        await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
        const address = server.address() as {
            port: number;
        };
        const origin = `http://127.0.0.1:${address.port}`;
        const post = (path: string, body: unknown, from = origin) => fetch(origin + path, { method: 'POST', headers: { Origin: from, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        try {
            expect((await post('/api/cameras', input, 'https://evil.example')).status).toBe(403);
            const added = await (await post('/api/cameras', input)).json();
            expect(added.rtspUrl).toBeUndefined();
            const result = await (await fetch(origin + '/api/cameras')).json();
            expect(result.enabled).toBe(false);
            expect(result.cameras).toHaveLength(1);
            expect(JSON.stringify(result)).not.toContain('secret');
            expect((await post(`/api/cameras/${added.id}/start`, {})).status).toBe(409);
            expect(JSON.parse(readFileSync(join(dir, 'cameras.json'), 'utf8')).cameras[0].rtspUrl).toBe(input.rtspUrl);
            expect(await new Promise<number | undefined>((resolve, reject) => { get(origin + '/api/cameras', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject); })).toBe(403);
        }
        finally {
            service.close();
            await new Promise<void>(r => server.close(() => r()));
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
