# Mappa 3D GPS Italia (apps/gpsitalia-3d)

Progetto Cloudflare Pages per 3d.gpsitalia.com. Non è pubblicato: la
pubblicazione e il DNS richiedono una decisione esplicita.

## Cosa fa oggi

- **Accesso condiviso.** Nessun login proprio. La funzione `functions/_middleware.ts`
  protegge ogni pagina, asset e API:
  - legge il token della piattaforma dal cookie `map3d_session` (host-only) o dal
    cookie condiviso `authToken`: vince il primo token valido con un ruolo ammesso;
  - lo verifica in RS256 con la sola chiave **pubblica** (`JWT_PUBLIC_KEY`);
  - rifiuta token admin (`aud`) e refresh (`typ`, `rtv`).
- **Senza sessione:** redirect a `AUTH_URL/login?redirect=…`. Al ritorno con
  `?token=` il token va in un cookie httpOnly, il refresh token viene scartato e
  l'URL viene ripulito.
- **Solo creator.** Tutti gli altri ruoli ricevono «non disponibile» (403), anche
  sulle API. `ALLOWED_ROLES` permette di aprire ad altri ruoli in futuro.
- **Proxy di sola lettura** `/api/platform/*` verso `PLATFORM_API_URL`, con il token
  dell'utente e un elenco chiuso di percorsi e parametri:
  - `last-locations`
  - `vehicles`
  - `vehicles/:imei/location`
  - `vehicles/:imei/history`

  Niente cookie dalla piattaforma, niente cache, niente redirect seguiti.
- `/api/session`: nome e ruolo di chi è entrato.
- `/logout`: uscita ovunque tramite auth.
- **Non indicizzato:** `X-Robots-Tag: noindex, nofollow`, `robots.txt` con
  `Disallow: /` e meta robots.

- **Mappa live** (`web/`, build Vite in `dist/`):
  - tutti i mezzi visibili su un unico livello GeoJSON, colorati per stato (in movimento, fermo, dato non recente), con il nome da zoom 13;
  - elenco con ricerca per nome o targa;
  - il mezzo scelto diventa un modello 3D (Kenney CC0) con movimento interpolato verso l'ultimo punto GPS, senza mai superarlo, e camera al seguito;
  - vista Standard 3D o Satellite 3D;
  - aggiornamento dell'elenco ogni 30 s fino a 200 mezzi, poi più diradato (60, 120, 180 s), sospeso a scheda nascosta;
  - il mezzo scelto si aggiorna ogni 10 s con una lettura leggera della sola posizione.
- **Rinnovo del token** (dura 1 ora): 3 minuti prima della scadenza la pagina passa da `AUTH_URL` e ripristina mezzo scelto, vista, tipo di mappa, ricerca e timelapse. Auth vieta gli iframe, quindi il passaggio è una navigazione completa: conta un caricamento Mapbox in più all'ora.
- **Inattività:** dopo 10 minuti senza interazioni compare «Sei ancora qui?» con 60 secondi di conto alla rovescia, poi rimando su `APP_URL`. Tornando su una scheda nascosta oltre la scadenza, il rimando è immediato.
- **Dati minimi:** il proxy pagina `last-locations` (al massimo 200 righe per richiesta) e lascia passare solo `imei`, `name`, `targa`, posizione, direzione, velocità e orario. Telefono, indirizzo e dati IO non arrivano al browser.
- `/api/config` consegna il token pubblico Mapbox solo dopo l'accesso: il token non è nel bundle statico.

- **Timelapse:** dal mezzo scelto, «Timelapse del percorso» carica un giorno di storico (al massimo 20.000 punti) e lo riproduce:
  - modello 3D con la scia;
  - cursore del tempo e velocità da 1 minuto a 1 ora al secondo;
  - conteggio delle soste;
  - nelle interruzioni di registrazione oltre 10 minuti il mezzo aspetta fermo, non viene inventato nessun tragitto.

- **Moduli su attivazione** (fuori da ogni piano, spenti per tutti di base):
  - si accendono con una variabile del progetto Pages, per ruolo o per singolo utente: `MODULO_VIDEO="role:creator"` oppure `MODULO_VIDEO="id:42, id:57"`. Voci malformate non abilitano nessuno;
  - il controllo avviene sul server dal token verificato: `/api/session` risponde `modules: { video: true|false }` e il middleware risponde 404 ai file `/assets/modulo-video-*` per chi non è abilitato;
  - su Cloudflare Pages una variabile cambiata vale dal deploy successivo: per accendere o spegnere serve ridistribuire.
- **Modulo «video»:** nel timelapse compare «Esporta come video». Il codice si scarica solo al primo uso. Il video si registra nel browser in tempo reale dalla mappa:
  - formati 16:9, 9:16 e 1:1 (1920 × 1080, 1080 × 1920, 1080 × 1080), durata 30 s, 1 o 2 min;
  - inquadratura al seguito del mezzo o sul percorso intero;
  - scritte facoltative (nome, orario e data, velocità, targa spenta di base), marchio GPS Italia e attribuzione Mapbox e OpenStreetMap sempre visibili;
  - MP4 H.264 dove possibile, altrimenti WebM;
  - la scheda deve restare in primo piano: se viene nascosta, o se si annulla o chiude, la registrazione si ferma senza file parziali; il rinnovo del token aspetta la fine della registrazione.

## Variabili d'ambiente

Si impostano nel progetto Pages, oppure in `.dev.vars` in locale (ignorato da Git;
vedi `.dev.vars.example`). Nessuna chiave nel codice.

| Variabile | Uso |
| --- | --- |
| `JWT_PUBLIC_KEY` | Chiave pubblica PEM dei token della piattaforma. Obbligatoria. |
| `PLATFORM_API_URL` | Origine HTTPS del server della piattaforma. Obbligatoria per il proxy. |
| `AUTH_URL` | Default `https://auth.gpsitalia.com`. |
| `APP_URL` | Default `https://app.gpsitalia.com`. |
| `ALLOWED_ROLES` | Default `creator`. |
| `MAPBOX_TOKEN` | Token pubblico Mapbox (`pk.`), limitato all'URL del sito. |
| `MODULO_VIDEO` | Facoltativa. Chi ha il modulo video: `role:creator`, `id:42`, separati da virgole. Vuota o assente: nessuno. |

## Sviluppo

```sh
cp .dev.vars.example .dev.vars   # compilare con valori locali
npm run build:3d                 # dalla radice: pacchetti + dist/ dell'app
cd apps/gpsitalia-3d && npx wrangler pages dev dist --compatibility-date=2026-05-01
npm test                         # dalla radice: include i test dell'app
```

Richiede `wrangler` installato.

## Prova contro la piattaforma (sola lettura)

`scripts/prova-piattaforma.sh` controlla che la piattaforma accetti le richieste
del proxy (token Bearer, nessuna intestazione Origin). Legge il token di nascosto,
non lo salva né lo stampa, e mostra solo stato HTTP e numero di elementi.
