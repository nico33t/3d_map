# Third-party assets and code

License sources checked on 2026-09-25. Third-party licenses apply to their
respective works, not automatically to the rest of this repository.

## Audi A1 Quattro (A1II)

- Creator: Mona x Supercars, account **Car2022**. Original embedded attribution:
  **GT Cars: Hyperspeed (https://sketchfab.com/Car2022)**.
- Source: https://sketchfab.com/3d-models/audi-a1-quattro-a1ii-c0ca74fba3b24326b898bfc556909b57
- License: **Creative Commons Attribution 4.0 International (CC BY 4.0)**.
- License and legal code: https://creativecommons.org/licenses/by/4.0/ and
  https://creativecommons.org/licenses/by/4.0/legalcode
- Files: `packages/vehicles-3d/originals/audi-a1-quattro.original.glb` and
  `packages/vehicles-3d/assets/audi/audi-a1-quattro.glb`.
- Changes to the runtime copy: scale normalized to 4 m length, ground-centered
  pivot, invisible SketchUp helper lines and fully transparent helpers removed.
  Visible surfaces and textures retained. Original metadata and original file
  are preserved. See the adjacent `LICENSE.txt` and the visible playground credit.

The source page declares CC Attribution and links to CC BY 4.0; the original GLB
metadata independently names CC-BY-4.0. Redistribution and adaptation under that
license require attribution, a license link and identification of changes.
This is not a CC0 asset. No endorsement by the creator or vehicle manufacturer
is implied. CC BY 4.0 does not license trademark or patent rights and carries no
warranty that the uploader controls all third-party rights. Preserve these
notices when redistributing the model. Review other rights for your intended use.

## Kenney Car Kit

- Creator: **Kenney**.
- Source: https://kenney.nl/assets/car-kit
- License: **CC0 1.0 Universal**, https://creativecommons.org/publicdomain/zero/1.0/
- Files: `packages/vehicles-3d/assets/kenney/` and `originals/kenney/`.
- Original notice: `packages/vehicles-3d/assets/kenney/LICENSE.txt`.
- Changes: common ground-centered, meter-scaled pivots for the five runtime
  models; original part transforms and texture retained. Sources are preserved.

## shadcn/ui

Components under `examples/playground/src/components/ui/` are based on shadcn/ui.
Source: https://github.com/shadcn-ui/ui
License: MIT. See `licenses/shadcn-ui-MIT.txt`.

## Dependencies and map services

Installed npm dependencies retain their own licenses; `package-lock.json` pins
versions and records their package licenses. This repository does not relicense
Mapbox, map imagery, Google services, FFmpeg or other third-party software.
Mapbox requires the user's own token and compliance with its service terms;
map attribution remains visible. FFmpeg is not bundled and must be installed
separately. Its applicable license depends on the installed build and codecs.

No Alfa Romeo Stelvio model is included. Links in the research notes are not a
claim that those models are CC0 or licensed for redistribution in this project.
