# @3d-map/aitrack

Client riutilizzabile per Aitrack API v2. Indipendente da mappe e rendering. Implementa solo letture: dispositivi, dispositivo singolo, ultima posizione, storico, dispositivi vicini, eventi e coda comandi. Lo scope `read_history_summary` è documentato ma manca la rotta negli allegati forniti: non viene inventato un endpoint.

## Server

```ts
import { createAitrackClient } from '@3d-map/aitrack';
const client = createAitrackClient({ apiKey: process.env.VITE_AITRACK_API_KEY });
const { data } = await client.getLocation('000000000000001');
```

Autenticazione tramite `X-API-Key`, nessun header `Authorization` o `X-API-Version`. Ogni metodo restituisce `{ data, meta? }`; gli errori diventano `AitrackError` con `status` e `code`. Supportati timeout, cancellazione e il formato errore legacy con stringa.

## Browser e polling

```ts
const client = createAitrackClient({ baseUrl: '/api/aitrack' });
const stop = client.watchLocation('000000000000001', {
  onLocation: location => console.log(location),
  onError: error => console.error(error),
}, { intervalMs: 10_000 });
// Smontaggio: stop();
```

Il playground legge `VITE_AITRACK_API_KEY` solo nel server Vite. `envPrefix` esclude questa chiave dal bundle browser. Il proxy è limitato alle rotte GET documentate e alla destinazione `https://api.aitrack.it/api/v2`; le risposte non vengono messe in cache.

Il proxy locale non è un backend di produzione: un sito pubblicato deve avere un backend autenticato che verifichi l'accesso dell'utente alla flotta. Una build statica da sola non contiene né sostituisce questo backend.

Polling sequenziale ogni 10 secondi (circa 360 richieste/ora per veicolo), con backoff massimo 120 secondi in caso di errore. 403 e dispositivo inesistente fermano il polling. Le posizioni duplicate o più vecchie vengono ignorate. I limiti della chiave sono condivisi con altre app e veicoli: aumentare l'intervallo se necessario.

## Webhook

```ts
import { verifyAitrackWebhook } from '@3d-map/aitrack/webhooks';
const valid = verifyAitrackWebhook(rawBody, signatureHeader, webhookSecret);
```

L'entry point `/webhooks` è solo Node e usa HMAC-SHA256 con confronto costante sul corpo originale. Il server ricevente deve memorizzare/deduplicare l'ID evento o `Idempotency-Key` prima di applicare effetti. Il timestamp nell'header non fa parte dell'HMAC descritto dagli allegati e non fornisce da solo protezione dai replay.

Nessun webhook è stato registrato: per l'attuale posizione del veicolo basta il polling. Per configurare gli eventi push serviranno un endpoint HTTPS pubblico e il suo segreto; la documentazione fornita descrive webhook di eventi, non garantisce un evento per ogni nuova posizione GPS.
