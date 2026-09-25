# Stato delle implementazioni

Questo documento descrive ciò che è effettivamente implementato nella prima
versione. La cronologia delle modifiche è in [CHANGELOG.md](CHANGELOG.md).
Non contiene configurazioni personali o dati provenienti dai servizi collegati.

## Pacchetti

| Pacchetto | Stato | Responsabilità |
| --- | --- | --- |
| `@3d-map/core` | Implementato | Contratti comuni per provider, camera, coordinate, marker, eventi e ciclo di vita. |
| `@3d-map/mapbox` | Implementato | Adapter Mapbox, mappe Standard e ibride 3D, ambiente, meteo grafico, veicoli e scie. |
| `@3d-map/google` | Predisposto | Struttura per un futuro adapter; Google Earth/Maps 3D non è ancora operativo. |
| `@3d-map/vehicles-3d` | Implementato | Catalogo GLB, modelli normalizzati, percorsi, interpolazione e associazioni del parco auto. |
| `@3d-map/aitrack` | Implementato | Client API, letture GPS, storico, polling e verifica delle firme webhook. |
| `@3d-map/aitrack-server` | Implementato | Proxy locale, richieste condivise e distanziate, SSE, ricezione webhook e distribuzione dell’app. |
| `@3d-map/rtsp` | Implementato, opzionale | Metadati, prossimità, configurazione locale e conversione RTSP/HLS con FFmpeg. |

## Interfaccia e mappa

- Pannello apribile e richiudibile con adeguamento delle dimensioni della mappa.
- A pannello chiuso: mappa senza margini, padding o angoli arrotondati.
- Button, ToggleGroup e Select ufficiali shadcn; Select anche nel parco auto.
- Tema automatico in base all’ora locale, con selezione manuale giorno/notte.
- Standard 3D e ibrida 3D senza ricreare il veicolo a ogni cambio di basemap.
- Pioggia Mapbox ed effetto grafico dei fulmini: non sono misurazioni meteo reali.

## Veicoli e GPS

- Simulazione dimostrativa a Roma oppure dispositivo Aitrack configurato localmente.
- Interpolazione della posizione tra punti ricevuti e rotazione immediata verso
  la nuova direzione; nessuna estrapolazione oltre il dato ricevuto.
- Scia, pausa, pulizia del percorso e camera al seguito.
- Scelta del modello per dispositivo con persistenza nel browser.
- Controlli GPS adattivi e connessione SSE; riconnessione automatica e fallback
  al polling dove SSE non è disponibile.
- Webhook firmati che anticipano il controllo delle posizioni. Registrazione
  dell’endpoint e configurazione del secret restano passaggi manuali.

## Telecamere opzionali

- Interruttore globale RTSP e abilitazione delle singole telecamere.
- Inserimento di nome, URL RTSP, coordinate e raggio di prossimità.
- Ricerca tra le telecamere configurate e apertura dal segnaposto o dall’elenco.
- Riquadri in basso a sinistra quando il veicolo entra nel raggio, con margine
  di uscita per evitare aperture e chiusure continue al confine.
- Massimo tre video contemporanei; HLS nativo in Safari e hls.js dove necessario.
- Ritardo di alcuni secondi, tentativi automatici di riconnessione e arresto
  dei processi inattivi. FFmpeg è una dipendenza esterna, non inclusa.
- Riconnessioni serializzate con attesa progressiva fino a 30 secondi, reset alla
  ripresa del video e annullamento della richiesta quando si chiude il riquadro.
- Nessuna scansione o ricerca automatica di telecamere di terzi.

## Esecuzione e dati

- Web app TypeScript con manifest standalone; nessun contenitore Electron.
- `npm start`: build, server locale e tunnel per il solo ingresso webhook.
- `npm run start:local`: avvio senza tunnel.
- Riavvio dei processi gestiti e rilettura della configurazione quando cambia
  `.env`; non è installato un servizio di avvio al login del sistema operativo.
- API applicative e video su localhost. Il tunnel non espone mappa o telecamere.
- Credenziali e configurazioni personali escluse da Git. Il token pubblico
  Mapbox viene necessariamente fornito al browser e va limitato per dominio.
- Service worker senza cache di posizioni GPS, risposte API o video.

## Licenze e limiti

Vedere [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md): modelli Kenney CC0,
Audi A1 CC BY 4.0 con attribuzione e modifiche documentate, componenti shadcn MIT.
Il codice originale è MIT, Copyright © 2026 Nicola Tomassini; vedere [LICENSE](LICENSE).
Le licenze degli asset restano separate e non concedono automaticamente diritti sui marchi.

Non sono ancora implementati l’adapter Google operativo, un’autenticazione per
hosting pubblico, un tunnel stabile preconfigurato, la sincronizzazione del parco
auto fra più utenti, un’app desktop nativa e un modello Stelvio.
