# @3d-map/mapbox

Adapter Mapbox GL JS v3 per `@3d-map/core`.

`createMapboxProvider({ accessToken, style?, loadTimeoutMs? })` crea un provider con token per istanza e caricamento lazy. Default: Mapbox Standard, timeout 30 secondi.

L'app ospite deve installare `mapbox-gl`, importare `mapbox-gl/dist/mapbox-gl.css`, dimensionare il contenitore e gestire la pulizia con `AbortSignal` o `destroy()`. Le etichette dei marker usano pulsanti accessibili, personalizzabili con `.map3d-marker`.

Richiede Mapbox GL JS >=3.30. Le estensioni `createMapboxVehicle(session, options)` e `setMapboxEnvironment(session, { light: 'night', rain: true })` aggiungono un modello GLB con scia e gli effetti nativi di Mapbox Standard. I veicoli vengono rimossi insieme alla sessione; camera, asset e sorgenti GPS restano separati dal motore.

`setMapboxBasemap(session, 'hybrid' | 'standard', signal?)` aggiorna solo
l'import `basemap` della mappa, mantenendo sorgenti, scie, layer e asset dei
veicoli. Attende `style.import.load` e supporta annullamento e timeout.
Le immagini e gli edifici del nuovo sfondo possono richiedere un caricamento.

`createLightningEffect(container)` aggiunge un effetto decorativo SVG sopra la
mappa, senza intercettare i controlli. `setEnabled()` attiva/disattiva i fulmini;
`destroy()` elimina DOM, timer e listener. Non rappresenta fulmini meteorologici
reali. Le scariche sono distanziate, si sospendono nelle schede nascoste e non
vengono animate con `prefers-reduced-motion: reduce`.
