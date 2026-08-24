# Preview composite source assets

These files are the visual sources used by the standalone preview at:

`/Users/licong/.codex/visualizations/2026/08/13/019ffb80-39a6-7210-a978-f4118da38ca3`

`npm run tiles:preview:build` packages them with
`public/tiles/wbe-basemap-editable-z6.pmtiles` and the normalized all-country
administrative sources into the single runtime archive
`public/tiles/wbe-preview-composite.pmtiles`. Presentation ADM1 defaults to
CGAZ ADM1; China and the France/Italy/UK/US/Spain policies are selected by the
country exception table. Presentation ADM2 is re-parented spatially and keeps
only edges internal to one presentation ADM1. Every unit receives a non-empty
Chinese-preferred, source-name-fallback label. The build report records exact
input hashes, source choices, density profiles, label coverage, removed
coincident edges, and the output hash.

The global administrative level 2 sources are derived from geoBoundaries and
are licensed CC BY 4.0. The base archive is derived from OpenStreetMap and
Protomaps data.

`npm run tiles:preview:audit` checks eight stable, non-conflict countries on
each of six continents at country, province/state and city-equivalent levels.
It also verifies complete country-name coverage, 100% presentation-label
coverage, zero exact duplicate segments, and zero ADM1/ADM2 coincident edges.
