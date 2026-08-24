# Single PMTiles preview basemap

The map page uses one visual archive by default:

```text
/tiles/wbe-preview-composite.pmtiles
```

It contains the editable Protomaps earth, water and road layers; continuous
country, province/state and city-equivalent boundary layers; and matching
Chinese/English administrative-label layers used by the 4177 reference preview. Ordinary
OSM city/town/locality names are intentionally not styled. The
archive is fixed to Z0-Z8 and overzooms the Z6 base geography through Z8.

MapLibre requests this archive plus local glyph PBFs. Search, click hit testing,
selection outlines and business aggregation continue to use the local GeoJSON
in memory, but those GeoJSON files do not draw ordinary boundaries or place
names while the composite is active. If the archive or glyphs cannot be loaded,
the page reports the resource failure and uses the GeoJSON emergency basemap.

Expected self-hosted assets:

```text
public/tiles/wbe-preview-composite.pmtiles
public/tiles/fonts/{fontstack}/{range}.pbf
```

The frontend can be pointed at another same-origin path with:

```text
VITE_BASEMAP_PM_TILES_URL=/tiles/wbe-preview-composite.pmtiles
VITE_BASEMAP_GLYPHS_URL=/tiles/fonts/{fontstack}/{range}.pbf
```

Rebuild and verify it with:

```text
npm run tiles:preview:names:prepare # only when intentionally refreshing CLDR 48
npm run tiles:preview:build
npm run tiles:preview:audit
npm run tiles:preview:verify
```

The name-preparation command is the only preview-name step that accesses the
network. It downloads the pinned Unicode CLDR release-48 English and Chinese
subdivision tables and writes a deterministic local snapshot with both source
hashes. Normal preview-tile builds are offline. Sourced government or competent
authority corrections belong in
`scripts/data/preview-map/official-admin-name-zh.json`; each override must carry
an HTTPS source URL, authority, and retrieval date.

The build reads the pinned CGAZ and local reference inputs and creates
`preview_presentation_admin1_*` and `preview_presentation_admin2_*` source
layers. ADM1 uses per-country common administrative systems and ADM2 edges are
limited to one presentation ADM1 parent; coincident ADM1 edges are removed.
Boundary and label visibility follows the per-country unit-count/density
profiles recorded in the report, while China retains its independent province
and city progression. Business interaction polygons stay in
`preview_region_polygons` and keep the existing statistical keys. The build
keeps verified Chinese names separate from `display_name_local`; an unresolved
Chinese name remains empty and the Chinese style falls back to the source's
official local name. Presentation label features include
`display_name_local`, `name_zh_source`, and `name_zh_verified`. Visual borders
are single-stroke layers—there are no bridge/halo copies—and the build rejects
both exact and near-coincident segments within and across visible hierarchy
layers. The near-line audit runs in Z8 Web Mercator pixels with a fixed 1.25 px
distance, 8 degree angle, and 70% overlap policy; the report records removals by
layer and country. Inland shorelines fade behind administrative borders at high
zoom, while marine coastlines retain their normal emphasis. Static and business
labels share one area/level typography scale; business labels reuse the bubble
point-count buckets for a capped 12% emphasis without changing size at hierarchy
handoffs. It then merges the layers with
`tile-join --overzoom --buffer=64
--no-tile-size-limit`. It records every input SHA-256, source-layer and zoom
range in `public/tiles/generated/preview-composite-report.json`.

The continent audit report is written to
`public/tiles/generated/preview-continent-audit-report.json`. It covers eight
stable countries per continent at all three administrative levels and excludes
active-conflict/disputed areas from visual repair decisions.

Large tile assets are intentionally ignored by git. Put them here in local
development, or serve them from a same-origin static path/object storage location
and point the Vite variables above to that path.

## Legacy region archive

`wbe-regions.pmtiles` is the administrative and business interaction archive.
It contains four source layers:

- `wbe_regions`: polygon fills and hit testing;
- `wbe_region_boundaries`: per-region country/admin-1 selection outlines;
- `wbe_boundary_edges`: each shared land border exactly once;
- `wbe_region_labels`: viewport-loaded label points.

Each region feature includes
`region_id`, `level`, `geo_key`, `parent_geo_key`, `display_name`, and
`bbox_w/bbox_s/bbox_e/bbox_n`. The frontend uses `region_id = level + "|" +
geo_key` to filter normal, hover, and selected region highlights.

The city-equivalent layer is built from the geoBoundaries CGAZ ADM2 global
composite (CC BY 4.0), pinned to the source revision recorded in
`scripts/prepare-global-admin2.mjs`. Mainland China uses the existing local
prefecture/city GeoJSON; Taiwan, Hong Kong, and Macao use the local
city-equivalent records. Countries without source ADM2 records promote the
lowest available local administrative geometry so every canonical country key
has a city-level fallback.

The first build downloads about 260 MB of pinned CGAZ source archives into the
ignored `.cache/geoboundaries` directory. Generate all normalized sources and
validation reports with:

```text
npm run tiles:regions:prepare
```

The browser fallback boundaries are generated under `public/geo/render`, using
the same Mapshaper-cleaned geometry that feeds the region archive. Rebuild or
verify them independently with:

```text
npm run geo:boundaries:build
npm run geo:boundaries:check
```

Build the local PMTiles archive with Docker:

```text
npm run tiles:regions:build
```

Boundary policy:

- administrative lines contain shared land edges only; coastlines are expressed
  by the land/water fill transition and are not stroked;
- shared edges are emitted once, instead of outlining both neighboring polygons;
- global city edges are generated independently inside each country, preventing
  slightly mismatched ADM2 source outlines from duplicating international borders;
- city-equivalent polygons retain only their principal land body, removing noisy
  detached island fragments;
- polygon fills, topology edges, labels, and interactive outlines are tiled as
  separate layers so tile clipping cannot invent diagonal or horizontal lines.

`public/tiles/generated/world-cities-report.json` verifies canonical country
coverage and records the source revision and archive hashes.
`public/tiles/generated/wbe_regions_report.json` verifies unique IDs, required
properties, feature counts by level, and geometry-part removal. The GeoJSON
fallback quality report additionally checks closed rings, zero-length segments,
self-intersections, antimeridian jumps, duplicate line segments, and China
city-to-province ownership.

Data attribution: [geoBoundaries](https://www.geoboundaries.org/) by William &
Mary geoLab, licensed under CC BY 4.0.
