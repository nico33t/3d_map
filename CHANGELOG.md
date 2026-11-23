# Changelog

Le modifiche successive alla prima versione sono raccolte in **Non rilasciato**.
Le versioni qui indicate descrivono il progetto: non implicano la pubblicazione
su npm, una release GitHub o il cambio di visibilità della repository.

## Non rilasciato

### App 3d.gpsitalia.com (`apps/gpsitalia-3d`)

- Nuovo progetto Cloudflare Pages, non pubblicato. Il middleware protegge ogni
  richiesta con il login condiviso della piattaforma:
  - token RS256 verificato con la sola chiave pubblica;
  - token admin e refresh rifiutati;
  - cookie host-only `map3d_session`, con il cookie condiviso `authToken` come
    alternativa.
- Accesso riservato al ruolo creator. Gli altri ruoli ricevono «non disponibile»
  (403) su pagine e API.
- Redirect al login condiviso. Al ritorno l'URL viene ripulito dal token e il
  refresh token scartato. Logout tramite auth.
- Proxy di sola lettura `/api/platform/*`: elenco chiuso di percorsi (posizioni
  live, mezzi, posizione e storico del singolo mezzo) e di parametri, token
  dell'utente, ruolo ricontrollato a ogni chiamata, nessun cookie o redirect
  dalla piattaforma.
- `noindex` su tutte le risposte e `robots.txt` con `Disallow: /`.
- Configurazione solo da variabili d'ambiente (`.dev.vars` ignorato da Git).
- Limite: la mappa vera e propria (live, timelapse, inattività) non è ancora inclusa.

### Testi dell'interfaccia

- Testi visibili del playground con il marchio GPS Italia e il termine «mezzo»;
  titolo e manifest «Mappa 3D GPS Italia». Separatori «·» sostituiti da
  virgole, parentesi o due punti.
- Messaggi d'errore mostrati all'utente dai pacchetti `@3d-map/aitrack` e
  `@3d-map/aitrack-server` resi neutri («Servizio GPS…»).
- README: nomi dei pulsanti aggiornati («Connessione GPS Italia», «Telecamere RTSP»).
- Identificatori tecnici invariati per compatibilità: nomi dei pacchetti,
  `AitrackError`, `createAitrackClient`, variabili `VITE_AITRACK_*`, intestazioni
  `X-Aitrack-*` dei webhook e indirizzo dell'API.

### 0.2.0 — in preparazione

- Aree Aitrack (geofence) in 3D: `listAreas`, `getArea` e `listAllAreas` in
  `@3d-map/aitrack` leggono API v3 (beta, permesso `read_areas`); devices ed
  eventi restano su v2. Il gateway locale inoltra solo `GET /areas` e
  `GET /areas/{id}` verso v3.
- `areaOutline`, `areaWalls` e `areaFootprints`: geometria indipendente dal
  motore per cerchi, luoghi, poligoni e tracciati con margine (`buffer_m`).
- `createMapboxAreaWalls` in `@3d-map/mapbox`: muri virtuali semitrasparenti
  (8 m) nel colore salvato su Aitrack, con pavimento tenue. Nel playground:
  pulsanti “Aree 3D” (mostra/nascondi) e “Vai alle aree”.
- Limiti: sola lettura; i buchi dei poligoni non esistono nel modello v3; API
  v3 in beta, il formato può cambiare.

- Scelta dei loghi anteriori e posteriori dell’Audi A1: originali (default)
  oppure neri, indipendente dalla carrozzeria e salvata per veicolo.
  Gli altri dettagli cromati conservano il loro materiale.

- Selettore shadcn del colore carrozzeria nel pannello e nel parco auto.
- Audi A1 argento predefinito, sette colori e ripristino del colore originale.
- Scelta salvata nel browser per veicolo e modello; simulazione separata.
- Colorazione limitata al materiale carrozzeria dell’Audi: vetri, ruote,
  texture e geometria restano invariati. File GLB originali non modificati.
- Selettore disabilitato sui modelli senza materiale carrozzeria separato
  (attualmente i modelli Kenney). Nessun nuovo asset o servizio esterno.

## 0.1.1 — 2026-09-25

### Modifiche

- Player telecamere: tentativi di connessione serializzati, retry accorpati con
  attesa progressiva fino a 30 secondi e annullamento della richiesta alla chiusura.
  Implementazione autonoma ispirata alla gestione del ciclo di vita di go2rtc.

- Quando il pannello dei controlli è chiuso, la mappa occupa tutta la finestra:
  margini, padding e border-radius sono zero. Riaprendo il pannello vengono
  ripristinati gli spazi e gli angoli arrotondati, anche nel layout mobile.

### Licenza e distribuzione

- Codice originale sotto licenza MIT, Copyright © 2026 Nicola Tomassini.
  Licenze e attribuzioni dei componenti e modelli di terzi conservate.
- Versioni dei workspace e dipendenze interne allineate a 0.1.1.
- Istruzioni locali dell’agente escluse dal versionamento.

### Documentazione

- Ricerca di Threebox, Traccar Web e go2rtc con revisioni, licenze, limiti di
  riuso degli asset e decisioni documentate in `docs/open-source-references.md`.

- Aggiunto questo changelog per distinguere la prima versione dalle modifiche
  successive non ancora rilasciate.
- Aggiunto `IMPLEMENTS.md` con stato dei pacchetti, funzionalità implementate e
  limiti attuali.

## 0.1.0 — 2026-09-25

Prima versione del monorepo TypeScript, con cronologia predisposta per la
pubblicazione senza identificativi personali negli esempi e nei test.

### Funzionalità

- Pacchetti riutilizzabili per il contratto mappa, Mapbox, veicoli 3D, Aitrack,
  gateway locale Aitrack e telecamere RTSP.
- Pacchetto Google predisposto tramite il contratto comune; adapter non ancora
  operativo.
- Mappa Mapbox Standard e ibrida 3D, modalità giorno/notte automatica con override,
  pioggia ed effetto grafico dei fulmini.
- Veicoli 3D con scala, pivot e orientamento normalizzati, movimento interpolato,
  aggiornamento immediato della direzione, scia e camera al seguito.
- Parco auto con associazione locale tra dispositivo e modello 3D.
- Controlli Button, ToggleGroup e Select shadcn, inclusi i Select del parco auto.
- Pannello apribile e richiudibile con ridimensionamento della mappa.
- Integrazione Aitrack con dispositivi, storico e posizioni; letture adattive
  condivise dal server e aggiornamenti SSE al browser.
- Ricevitore webhook con verifica HMAC sul body originale e deduplicazione
  temporanea delle consegne.
- Integrazione RTSP attivabile, configurazione locale delle telecamere, ricerca,
  segnaposto e riquadri automatici in prossimità del veicolo.
- Conversione video RTSP in HLS tramite FFmpeg, fino a tre flussi contemporanei,
  riconnessione e arresto dei processi inattivi.
- Avvio gestito dell’app e del tunnel webhook, riavvio dei processi in caso di
  uscita, manifest web e modalità standalone.

### Protezione dei dati e licenze

- Configurazioni locali, credenziali, dati delle telecamere e file generati
  esclusi da Git; chiave Aitrack e indirizzi RTSP conservati lato server.
- Controlli dei segreti e dei dati personali nei file e nella cronologia dei
  branch, tag e remoti destinati alla pubblicazione.
- Modelli Kenney con licenza CC0 e Audi A1 con licenza dichiarata CC BY 4.0;
  attribuzioni, provenienza e modifiche documentate in THIRD_PARTY_NOTICES.md.
- Avviso MIT incluso per i componenti shadcn.

### Limiti della prima versione

- Registrazione del webhook nel pannello Aitrack ancora manuale; il tunnel
  temporaneo cambia indirizzo quando viene ricreato.
- Gli eventi webhook anticipano una lettura GPS, ma non sostituiscono una
  trasmissione di ogni singolo punto da parte del dispositivo.
- Video HLS con alcuni secondi di ritardo; FFmpeg deve essere installato a parte.
- Server destinato all’uso locale su una postazione fidata; nessun servizio
  di avvio al login, hosting pubblico o app Electron incluso.
- Nessun modello Alfa Romeo Stelvio incluso.
