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

La mappa (live dei mezzi, timelapse, inattività) arriva nei prossimi passi.

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

## Sviluppo

```sh
cp .dev.vars.example .dev.vars   # compilare con valori locali
cd apps/gpsitalia-3d && npm run dev
npm test                         # dalla radice: include i test dell'app
```

Richiede `wrangler` installato.

## Prova contro la piattaforma (sola lettura)

`scripts/prova-piattaforma.sh` controlla che la piattaforma accetti le richieste
del proxy (token Bearer, nessuna intestazione Origin). Legge il token di nascosto,
non lo salva né lo stampa, e mostra solo stato HTTP e numero di elementi.
