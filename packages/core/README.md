# @3d-map/core

Contratto TypeScript indipendente dal motore per app web: `MapProvider`, `MapSession`, `Camera`, `MapMarker` e `MapEvents`.

`createMap(provider, options)` valida la camera iniziale e delega il montaggio. Importabile senza DOM a runtime; il montaggio richiede un `HTMLElement`. Nessuna dipendenza Mapbox o Google.

Consultare il README del monorepo per l'esempio completo.
