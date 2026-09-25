# Changelog

Le modifiche successive alla prima versione sono raccolte in **Non rilasciato**.
Le versioni qui indicate descrivono il progetto: non implicano la pubblicazione
su npm, una release GitHub o il cambio di visibilità della repository.

## Non rilasciato

Nessuna modifica successiva alla versione 0.1.1.

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
