import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReconnectController } from '../src/reconnect.js';

afterEach(() => vi.useRealTimers());
describe('camera reconnect lifecycle', () => {
    it('coalesces errors and never overlaps a pending connection', async () => {
        vi.useFakeTimers();
        let finish!: () => void;
        const attempt = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
        const controller = createReconnectController(attempt);
        controller.start();
        controller.start();
        controller.retry();
        controller.retry();
        await vi.advanceTimersByTimeAsync(60000);
        expect(attempt).toHaveBeenCalledTimes(1);
        finish();
        await vi.advanceTimersByTimeAsync(3999);
        expect(attempt).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(attempt).toHaveBeenCalledTimes(2);
        controller.dispose();
        finish();
    });
    it('backs off to 30 seconds and resets only when playback is healthy', async () => {
        vi.useFakeTimers();
        const attempt = vi.fn(async () => { throw new Error('offline'); });
        const controller = createReconnectController(attempt);
        controller.start();
        await vi.advanceTimersByTimeAsync(0);
        for (const delay of [4000, 8000, 16000, 30000, 30000]) {
            const count = attempt.mock.calls.length;
            await vi.advanceTimersByTimeAsync(delay - 1);
            expect(attempt).toHaveBeenCalledTimes(count);
            await vi.advanceTimersByTimeAsync(1);
            expect(attempt).toHaveBeenCalledTimes(count + 1);
        }
        controller.healthy();
        const count = attempt.mock.calls.length;
        await vi.advanceTimersByTimeAsync(60000);
        expect(attempt).toHaveBeenCalledTimes(count);
        controller.retry();
        controller.retry();
        await vi.advanceTimersByTimeAsync(4000);
        expect(attempt).toHaveBeenCalledTimes(count + 1);
        controller.dispose();
    });
    it('aborts an in-flight request and ignores late failures after closing', async () => {
        vi.useFakeTimers();
        let reject!: (error: Error) => void;
        const attempt = vi.fn((_signal: AbortSignal) => new Promise<void>((_, fail) => { reject = fail; }));
        const controller = createReconnectController(attempt);
        controller.start();
        controller.retry();
        controller.dispose();
        expect(attempt.mock.calls[0][0].aborted).toBe(true);
        reject(new Error('late failure'));
        controller.retry();
        controller.start();
        await vi.advanceTimersByTimeAsync(60000);
        expect(attempt).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});
