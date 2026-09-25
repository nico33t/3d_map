# Progetti di riferimento

Ricerca del 25 settembre 2026. Sono progetti complementari: nessuno dei tre
riproduce da solo la combinazione di flotta Aitrack, veicoli 3D e telecamere
in prossimità presente in questa app.

## Threebox: Mapbox e oggetti 3D

- Repository: https://github.com/jscastro76/threebox
- Revisione consultata: `25c5d4a785081de5bfff984127796f7812ce3d0e`.
- [Licenza della revisione](https://github.com/jscastro76/threebox/blob/25c5d4a785081de5bfff984127796f7812ce3d0e/LICENSE.txt).
- Codice principale MIT; componenti inclusi come SunCalc hanno avvisi propri.
  Copiando codice occorre mantenere copyright e condizioni applicabili.
- Riferimento utile per integrazione Three.js/Mapbox, animazioni e gestione degli
  oggetti 3D. Non è stato aggiunto come dipendenza né sostituito il renderer
  Mapbox attuale: la compatibilità con gli stili usati richiede una prova dedicata.
- Gli asset non condividono necessariamente la licenza MIT: il file elenca
  modelli NonCommercial, altri senza licenza specificata e veicoli con licenza
  Royalty Free. Quest'ultima non equivale a una libera redistribuzione dei file.
  Non abbiamo importato nessuno di questi modelli.

## Traccar Web: flotta e tracking GPS

- Repository: https://github.com/traccar/traccar-web
- Revisione consultata: `c6035b4dafa8fe8f24d65a50f53aaca9a3b5764c`.
- [Licenza Apache-2.0 della revisione](https://github.com/traccar/traccar-web/blob/c6035b4dafa8fe8f24d65a50f53aaca9a3b5764c/LICENSE.txt).
- Permette riuso e modifiche con conservazione della licenza e degli avvisi
  pertinenti, indicazione dei file modificati e gestione di eventuali NOTICE.
- Riferimento per elenco dispositivi, selezione del veicolo, storico e geofence.
  L'app usa un backend Traccar e MapLibre: copiarla interamente non produrrebbe
  automaticamente un'integrazione Aitrack o Mapbox.
- Nessun codice Traccar importato in questa modifica. Il confronto suggerisce
  di mantenere separati l'identità del dispositivo, la sua posizione e il modello
  grafico, come già previsto dai pacchetti del progetto.

## go2rtc: video nel browser

- Repository: https://github.com/AlexxIT/go2rtc
- Revisione consultata: `c245815e75e2a5fd60b4290f12bfc04e55a984d3`.
- [Licenza MIT](https://github.com/AlexxIT/go2rtc/blob/c245815e75e2a5fd60b4290f12bfc04e55a984d3/LICENSE).
  Un riuso del codice richiede conservazione dell'avviso di copyright e licenza.
- [Player esaminato](https://github.com/AlexxIT/go2rtc/blob/c245815e75e2a5fd60b4290f12bfc04e55a984d3/www/video-rtc.js):
  controllo delle connessioni già aperte, gestione del timer di riconnessione
  e disconnessione quando il player non è più visibile.
- Abbiamo preso ispirazione da questi principi per un'implementazione autonoma
  in `packages/rtsp/src/reconnect.ts`, usata dal player del playground:
  un tentativo alla volta, richieste di retry accorpate, attese di 4/8/16/30 secondi,
  reset alla ripresa della riproduzione e annullamento alla chiusura.
- Nessun frammento di sorgente, asset o binario go2rtc è stato copiato; nessuna
  nuova dipendenza è stata introdotta. L'algoritmo di backoff è nostro.
- go2rtc rimane un candidato per un futuro adapter WebRTC. Non è installato:
  oggi i video continuano a usare FFmpeg/HLS con il relativo ritardo.

## Ambito della modifica

I test della riconnessione usano timer simulati, senza credenziali o flussi reali.
L'integrazione RTSP resta disabilitata nella configurazione locale. La ricerca
non modifica la licenza del codice originale di questa app né quelle degli
asset già presenti, documentate in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
