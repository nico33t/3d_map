# @3d-map/google

Pacchetto separato riservato al futuro adapter Google 3D. Per ora contiene solo lo stato `GOOGLE_ADAPTER_STATUS = 'planned'`: non carica SDK, non richiede credenziali e non espone un provider funzionante.

Quando verrà implementato, esporrà una factory conforme a `MapProvider` di `@3d-map/core`. L'SDK Google e la relativa configurazione resteranno qui, senza dipendenze da `@3d-map/mapbox`.
