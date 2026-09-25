# 3D Map

Monorepo TypeScript di pacchetti riutilizzabili per mappe web. Mapbox è il primo motore; il codice applicativo dipende da un contratto comune.

## Pacchetti

| Percorso | Pacchetto | Responsabilità |
| --- | --- | --- |
| `packages/core` | `@3d-map/core` | Contratti, camera, coordinate, marker, eventi e validazione. Nessuna dipendenza dal motore. |
| `packages/mapbox` | `@3d-map/mapbox` | Caricamento Mapbox, traduzione del contratto e gestione risorse. |
| `packages/google` | `@3d-map/google` | Struttura iniziale per il futuro adapter Google 3D; non ancora operativo. |
| `packages/vehicles-3d` | `@3d-map/vehicles-3d` | Catalogo indipendente e cinque modelli GLB Kenney CC0 con licenza inclusa. |
| `packages/aitrack` | `@3d-map/aitrack` | API v2, polling posizioni e verifica firme webhook. |
| `examples/playground` | app di esempio | App Vite minima che consuma i pacchetti come un'app esterna. |

Il primo target è il browser. I pacchetti possono essere usati da React, Vue, Angular o JavaScript; gli adapter nativi iOS/Android richiederanno implementazioni dedicate. I pacchetti mappa sono indipendenti da React; il playground usa React per i controlli shadcn.

## Avvio

Richiede Node.js >=22.12 e npm.

```sh
npm install
cp .env.example .env
# Impostare VITE_MAPBOX_ACCESS_TOKEN con il proprio token pubblico Mapbox.
npm run dev
```

Il token pubblico viene esposto al browser: limitarlo ai domini autorizzati nella console Mapbox. Non inserire token segreti. Il playground mostra un messaggio di configurazione se manca il token.

Senza IMEI configurato il playground parte dalla simulazione a Roma. Gli identificativi nei test sono fittizi. Il playground include l'Audi A1, associata al dispositivo configurato in `VITE_AITRACK_DEVICE_IMEI`, una scia GPS e una simulazione separata a Roma. I pulsanti Giorno, Notte e Pioggia controllano gli effetti nativi di Mapbox Standard. La pioggia è un effetto visivo, non un dato meteo reale.

Inserire la chiave Aitrack in `VITE_AITRACK_API_KEY` nel `.env`: malgrado il nome richiesto, viene letta esclusivamente dal proxy locale e non esposta al browser. Per produzione è necessario un backend autenticato. Le posizioni reali vengono lette dal server con frequenza adattiva e distribuite via SSE e mostrano l'orario dell'ultimo campione; non viene inventato movimento quando il dispositivo è fermo o non invia dati.

```sh
npm run check          # TypeScript, test e build del playground
npm run build          # JS ESM e dichiarazioni dei pacchetti
npm run build:example  # Build statica del playground
```

## Integrazione in altre app

```ts
import { createMap, DEFAULT_CAMERA } from '@3d-map/core';
import { createMapboxProvider } from '@3d-map/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';

const lifetime = new AbortController();
const map = await createMap(createMapboxProvider({ accessToken: 'pk.…' }), {
  container: document.querySelector<HTMLElement>('#map')!,
  camera: DEFAULT_CAMERA,
  signal: lifetime.signal,
});

map.setMarkers([
  { id: 'rome', label: 'Roma', position: { longitude: 12.4924, latitude: 41.8902 } },
]);
const unsubscribe = map.on('markerClick', ({ id }) => console.log(id));
// Allo smontaggio del componente:
unsubscribe();
lifetime.abort(); // Cancella il caricamento o distrugge la sessione già attiva.
```

Il contenitore deve avere altezza e larghezza non nulle. Importare il CSS Mapbox nell'app ospite e personalizzare `.map3d-marker`. Chiamare `map.resize()` se cambia il contenitore. In SSR, chiamare `createMap` solo nel browser; Mapbox viene importato in modo lazy.

Per un'altra repository, creare gli archivi installabili (nessuna pubblicazione automatica):

```sh
npm run build
npm pack -w @3d-map/core
npm pack -w @3d-map/mapbox
# Nella app di destinazione, installare insieme i due .tgz e mapbox-gl:
npm install /percorso/3d-map-core-0.1.0.tgz /percorso/3d-map-mapbox-0.1.0.tgz mapbox-gl
```

Lo scope npm `@3d-map` è provvisorio: prima di pubblicare scegliere uno scope controllato e definire la licenza. I pacchetti non sono stati pubblicati.

## Google 3D in futuro

Vedere [il contratto degli adapter](docs/providers.md). Google non è ancora implementato: la predisposizione consiste in un'interfaccia pubblica senza tipi Mapbox e in una factory sostituibile nel punto di inizializzazione.

Riferimenti: [Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/guides/get-started/), [Google Maps 3D](https://developers.google.com/maps/documentation/javascript/3d/overview).

## Licenze e modelli

Vedere [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). I modelli Kenney sono CC0;
l’Audi A1 è CC BY 4.0, con attribuzione e modifiche documentate. Non è “senza
copyright”. I marchi automobilistici non sono concessi in licenza dalla CC BY e
non indicano affiliazione o approvazione. Le licenze degli asset non si applicano
al codice del progetto; la sola visibilità pubblica non concede una licenza
open source per il codice originale.

## Credenziali e repository

Prima di rendere pubblico il repository, verificare file, metadati e intera cronologia Git. `.env`, configurazioni locali, credenziali,
chiavi di firma, dipendenze, build e log sono esclusi da Git. `.env.example`
contiene solo valori vuoti: copialo in `.env` e compila i valori localmente.

Dopo un clone, abilita il controllo prima di ogni commit:

```sh
git config core.hooksPath .githooks
npm run check:secrets
npm run check:public  # Controlla cronologia di branch, tag e remoti
```

Il controllo verifica i file tracciati (o lo staging durante il commit), cerca
formati di credenziali noti e confronta il contenuto con i token del `.env`
locale senza stamparli. È una protezione aggiuntiva, non sostituisce la revisione
di ciò che viene aggiunto al repository. Non caricare dump di posizioni GPS,
esportazioni dell'account o screenshot contenenti credenziali.

## App web e avvio gestito

`npm start` costruisce l’app TypeScript, avvia il server su `http://127.0.0.1:8787`
e apre automaticamente un tunnel Cloudflare **solo** verso il ricevitore webhook
sulla porta locale 8788. Richiede Node 22.12+ e `cloudflared` nel PATH. Il processo
riavvia server e tunnel in caso di uscita; ricarica il server quando cambia `.env`.
`npm run start:local` funziona senza tunnel. Il Mac e questo processo devono restare
accesi: non viene installato un servizio di avvio al login.

La web app ha manifest e modalità standalone; in Safari si può usare
**File → Aggiungi al Dock**. Non richiede Electron. Il service worker non memorizza
GPS, API o video; serve una connessione al server locale.

Da **Connessione Aitrack** copia l’endpoint nel pannello Aitrack e inserisci il
secret di firma nello stesso pannello dell’app. È salvato nel `.env` ignorato da
Git, mai restituito dal server. Abilita gli eventi desiderati e retry esponenziale.
Non è documentata un’API di registrazione: questo passaggio rimane manuale.
Il quick tunnel cambia URL quando ricreato e richiede aggiornare l’endpoint;
per un’installazione permanente serve un tunnel con dominio stabile.

`@3d-map/aitrack-server` condivide una sola lettura per IMEI fra le schede aperte,
invia aggiornamenti SSE e adatta i controlli GPS: 10–30 s in movimento, 45 s da
fermo, 60 s con dati vecchi, backoff in errore. Le richieste sono serializzate e
separate da almeno 4,5 s. Gli eventi webhook anticipano un controllo; l’evento
`movement` non equivale a un punto GPS per ogni spostamento. Il ricevitore verifica
HMAC sul body grezzo e intestazioni di consegna, tollera 5 minuti di scarto orario
e deduplica gli ID di consegna per 24 ore in memoria (si azzera al riavvio).
Non modifica dispositivi né invia comandi.

## Pacchetto RTSP opzionale

`@3d-map/rtsp` è indipendente dal motore mappa. L’entry point principale esporta
metadati, distanze e selezione per prossimità; `@3d-map/rtsp/server` esporta il
servizio Node con persistenza locale e conversione FFmpeg. Richiede `ffmpeg`
con encoder `libx264` nel PATH; non scarica programmi all’avvio.

Apri **Telecamere · RTSP**, attiva l’integrazione e aggiungi nome, URL RTSP completo,
coordinate e raggio (10–10000 metri). Puoi usare il centro corrente della mappa.
Puoi disattivare ogni telecamera singolarmente, cercare per nome e aprirla tramite
l’elenco o il suo segnaposto. Le telecamere vicine alla posizione visualizzata del
veicolo compaiono in basso a sinistra; un margine del 15% in uscita evita aperture
e chiusure continue sul confine. Si applica anche alla simulazione.

Fino a tre video sono aperti contemporaneamente, con priorità alle aperture
manuali. La chiusura nasconde una telecamera automatica fino all’uscita dal raggio.
I video vengono sospesi quando la scheda è nascosta; i processi senza richieste
terminano entro 30 secondi, immediatamente se il pacchetto viene disattivato.
Gli errori di riproduzione attivano nuovi tentativi. I flussi sono HLS H.264 senza
audio, fino a 960×540, con alcuni secondi di ritardo: non è video a latenza zero.
Safari usa il player HLS nativo, gli altri browser compatibili usano hls.js.
La ricerca comprende esclusivamente le telecamere aggiunte dall’utente.

Configurazione e indirizzi con credenziali sono in `.local/cameras.json` (permessi
0600), escluso da Git. L’API pubblica dei metadati non restituisce l’URL RTSP.
I segmenti temporanei sono in `.local/streams`; il server video è accessibile
solo da localhost, non dal tunnel webhook. Le credenziali RTSP restano comunque
visibili agli utenti locali che possono ispezionare gli argomenti dei processi
FFmpeg: questa versione è destinata a una postazione personale fidata.
La telecamera deve essere raggiungibile dal Mac (LAN/VPN); non viene effettuata
alcuna scansione o ricerca di telecamere altrui.

Riutilizzo in un’altra app:

```ts
import { nearbyCameras } from '@3d-map/rtsp';
import { createRtspService } from '@3d-map/rtsp/server';
// Nel server Node: montare middleware prima delle altre route /api.
const cameras = createRtspService({ storageDir: './.local' });
// cameras.middleware(req, res, next); cameras.close() durante lo shutdown.
// Nel client: nearbyCameras(metadata, vehiclePosition).
```

Non usare `git push --mirror` per pubblicare: riferimenti interni di strumenti e
backup locali possono conservare cronologia privata. Pubblicare solo i branch
e i tag controllati. Usare un’email GitHub `noreply` nei commit pubblicabili.
