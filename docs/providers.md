# Contratto dei motori

L'app seleziona un `MapProvider` nel punto di composizione e utilizza solo `MapSession` nel resto del codice. Nessun oggetto SDK viene esposto dal contratto.

Ogni adapter deve:

1. Implementare `MapProvider.mount` e risolvere solo quando la mappa è utilizzabile.
2. Validare camera e marker; rifiutare ID duplicati prima di modificare la collezione.
3. Tradurre coordinate WGS84, camera e marker nei formati del motore.
4. Emettere `cameraChange` al termine del movimento, `click`, `markerClick` ed `error`.
5. Rilasciare canvas, listener e marker su errore iniziale, timeout, abort o `destroy`.
6. Consentire più istanze, senza configurare token SDK globali.
7. Rendere `destroy` idempotente e rifiutare operazioni dopo la distruzione.

`setMarkers` sostituisce l'intera collezione, mantenendo gli ID stabili. Le etichette sono testo, mai HTML. `AbortSignal` copre sia il caricamento sia la sessione attiva. Il motore resta proprietario delle animazioni e delle interazioni utente.

## Semantica della camera

- Coordinate: longitudine ±180°, latitudine ±85.051129° (intersezione supportata dal contratto iniziale).
- Zoom: 0–22, convenzione Web Mercator con tile di 512 pixel.
- Bearing: gradi, senso orario rispetto al nord.
- Pitch: 0–85°, da vista dall'alto a vista inclinata.

La vista restituita è quella effettiva del motore; gli SDK possono limitarla per terreno, proiezione o quota. Lo zoom non è una distanza in metri.

## Integrazione Google prevista

Per un'esperienza simile a Google Earth in un'app, valutare [Google Maps 3D JavaScript](https://developers.google.com/maps/documentation/javascript/3d/overview) oppure [Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/overview) con un renderer dedicato. Non si tratta di incorporare direttamente l'app Google Earth.

Il pacchetto `@3d-map/google`, attualmente solo una struttura iniziale, implementerà lo stesso contratto. Credenziali e caricamento Google resteranno nel pacchetto. La camera Google basata su range/altitudine richiede una conversione esplicita della scala in funzione di latitudine, campo visivo e dimensioni del viewport: non basta rinominare `zoom` in `range`.

Prima di realizzare l'adapter, verificare la conversione andata/ritorno della camera e la compatibilità di marker, eventi e interazioni su scene reali. Funzionalità non comuni (terreno, modelli 3D, layer proprietari) saranno estensioni dichiarate separatamente; il core non promette supporto universale.

Test richiesti: caricamento/cancellazione, ripetuti mount/unmount, istanze simultanee, round trip camera, aggiornamento/rimozione marker, eventi, gestione errori. I test SDK simulati vanno integrati con una verifica browser con credenziali reali.
