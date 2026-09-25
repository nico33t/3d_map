/** Serializes connection attempts and backs off until playback actually resumes. */
export function createReconnectController(attempt: (signal: AbortSignal) => Promise<void>) {
    const abort = new AbortController();
    let running = false;
    let pending = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function schedule() {
        if (abort.signal.aborted || running || timer !== undefined || !pending) return;
        pending = false;
        const delay = Math.min(4000 * 2 ** Math.min(failures++, 3), 30000);
        timer = setTimeout(() => { timer = undefined; void run(); }, delay);
    }
    async function run() {
        if (abort.signal.aborted || running) return;
        running = true;
        try { await attempt(abort.signal); }
        catch { pending = true; }
        finally { running = false; schedule(); }
    }
    return {
        start() { if (timer === undefined) void run(); },
        retry() { if (timer !== undefined || abort.signal.aborted) return; pending = true; schedule(); },
        healthy() {
            failures = 0;
            pending = false;
            clearTimeout(timer);
            timer = undefined;
        },
        dispose() {
            abort.abort();
            pending = false;
            clearTimeout(timer);
            timer = undefined;
        },
    };
}
