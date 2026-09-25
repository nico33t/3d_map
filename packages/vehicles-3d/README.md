# @3d-map/vehicles-3d

Pacchetto autonomo di asset, catalogo e interpolazione percorsi, senza dipendenze da Mapbox, Google, React o Three.js. Il rendering sulla mappa è implementato nell'estensione `createMapboxVehicle` del pacchetto Mapbox.

Include cinque veicoli stilizzati Kenney Car Kit 3.1: berlina, SUV, SUV luxury, compatta sportiva e van. Sono modelli leggeri CC0, non riproduzioni fotorealistiche di auto di marca. La licenza originale è inclusa in `assets/kenney/LICENSE.txt`.

L'Audi A1 Quattro fornita dall'utente è esportata separatamente come `audiA1`, con licenza CC BY 4.0 e crediti in `assets/audi/LICENSE.txt`. L'originale resta in `originals/`, la versione preparata per Mapbox in `assets/audi/`. Lo script `scripts/normalize-audi.py` adatta scala e pivot e rimuove le linee ausiliarie invisibili di SketchUp che producono artefatti nel layer nativo. Le superfici visibili e le texture restano inalterate. È un modello dettagliato da circa 45 MB, non ancora decimato per dispositivi meno potenti.

## Uso

Copiare l'intera cartella `assets` nel percorso pubblico dell'app (ad esempio `public/vehicles`). Questi GLB fanno riferimento a `Textures/colormap.png`: mantenere la struttura delle cartelle. In questo modo gli asset funzionano anche senza un bundler specifico.

```ts
import { vehicles, getVehicleUrl } from '@3d-map/vehicles-3d';

const url = getVehicleUrl('kenney-suv', new URL('/vehicles/', window.location.origin));
// Passare url al loader glTF del renderer scelto.
console.log(vehicles, url);
```

Il pacchetto espone anche i file tramite `@3d-map/vehicles-3d/assets/*`. Configurare la copia delle texture nel bundler quando si importano direttamente i GLB.

## Modelli realistici aggiuntivi

Formato preferito: GLB, texture 2K come sorgente di qualità. Prima dell'utilizzo sulla mappa controllare materiali, scala, orientamento, numero di triangoli e memoria texture; preparare una versione ottimizzata separata dall'originale.

Per ogni nuovo modello conservare autore, URL sorgente, licenza esatta e crediti richiesti. CC BY richiede attribuzione e non va presentata come CC0. Il catalogo incluso contiene solo CC0. Non è ancora inclusa alcuna Stelvio: vedere `SOURCES.md` per l'esito della ricerca.

Il modulo esporta anche `createFleetAssignments(storage)`: associa un IMEI a un ID
modello, valida i dati salvati e usa uno storage fornito dall'app ospite. `set()`
restituisce `false` se la persistenza fallisce, mantenendo la scelta in memoria.
Il playground usa localStorage, mostra il parco auto Aitrack e segue un veicolo
alla volta con il modello scelto. Le associazioni non sono sincronizzate sul server.

`createVehicleMotion()` interpola la posizione tra fix GPS e applica subito il nuovo orientamento, senza
estrapolare oltre il punto ricevuto. `target(pose, durationMs)` imposta la meta;
`advance(deltaMs)` avanza l'animazione usando il clock dell'app. Il primo fix è
immediato; un nuovo target parte dalla posa visualizzata. Sospendere il clock
congela il movimento e `reset()` elimina lo stato al cambio di veicolo.
Nel playground le transizioni durano da 1 a 10 secondi in base all'intervallo GPS;
la scia cresce con il movimento. I tratti intermedi sono interpolati in linea
retta, non sono rilevamenti GPS aggiuntivi né percorsi agganciati alle strade.

I cinque asset Kenney vengono preparati da `scripts/normalize-kenney.py`: una
radice comune centra il modello sul piano orizzontale e appoggia le ruote a quota
zero, conservando le trasformazioni relative delle parti. Le lunghezze nominali
sono 4–5 metri (modelli stilizzati, non misure di veicoli reali). Gli originali
rimangono in `originals/kenney`. Il catalogo espone `mapScale` e `headingOffset`
per la calibrazione del singolo asset; l'app non applica più una scala basata
sulla categoria grafica. L'Audi mantiene la calibrazione precedente.
