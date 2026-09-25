export function mountSystem(signal: AbortSignal) {
    const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
    const dialog = el<HTMLDialogElement>('system-dialog');
    const refresh = async () => { try {
        const r = await fetch('/api/system/status', { signal });
        if (!r.ok)
            throw Error();
        const s = await r.json();
        el('system-state').textContent = `GPS: ${s.apiConfigured ? 'configurato' : 'chiave mancante'} · Webhook: ${s.webhookConfigured ? 'secret configurato' : 'secret da configurare'}${s.lastWebhook ? ' · Ultima consegna: ' + new Date(s.lastWebhook).toLocaleString('it-IT') : ''}`;
        el<HTMLInputElement>('webhook-url').value = s.webhookUrl ?? 'Avvia con npm start per attivare il tunnel';
    }
    catch {
        if (!signal.aborted)
            el('system-state').textContent = 'Server non disponibile';
    } };
    el('open-system').addEventListener('click', () => { dialog.showModal(); void refresh(); }, { signal });
    el('close-system').addEventListener('click', () => dialog.close(), { signal });
    el('save-webhook').addEventListener('click', async () => { const input = el<HTMLInputElement>('webhook-secret'); try {
        const response = await fetch('/api/system/webhook-secret', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: input.value }) });
        if (!response.ok)
            throw Error('Salvataggio non riuscito: usa l’app avviata con npm start e un secret valido di almeno 16 caratteri.');
        input.value = '';
        el('webhook-save-state').textContent = 'Secret salvato. Riconnessione automatica in corso.';
        void refresh();
    }
    catch (error) {
        el('webhook-save-state').textContent = error instanceof Error ? error.message : 'Errore';
    } }, { signal });
    const timer = setInterval(() => { if (dialog.open)
        void refresh(); }, 10000);
    signal.addEventListener('abort', () => clearInterval(timer), { once: true });
}
