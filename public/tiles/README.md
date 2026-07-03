# Self-hosted vector basemap assets

The map page first checks for this PMTiles archive:

```text
/tiles/wbe-basemap.pmtiles
/tiles/wbe-regions.pmtiles
```

When the archive, glyphs, and sprite are all available, MapLibre renders the
basemap from PMTiles and only requests tiles for the current viewport and zoom.
When any required asset is missing or invalid, the page falls back to the
existing lightweight GeoJSON basemap.

Expected self-hosted assets:

```text
public/tiles/wbe-basemap.pmtiles
public/tiles/wbe-regions.pmtiles
public/tiles/fonts/{fontstack}/{range}.pbf
public/tiles/sprites/light.json
public/tiles/sprites/light.png
```

The frontend can be pointed at another same-origin path with:

```text
VITE_BASEMAP_PM_TILES_URL=/tiles/wbe-basemap.pmtiles
VITE_REGION_PM_TILES_URL=/tiles/wbe-regions.pmtiles
VITE_BASEMAP_GLYPHS_URL=/tiles/fonts/{fontstack}/{range}.pbf
VITE_BASEMAP_SPRITE_URL=/tiles/sprites/light
```

Use one consistent source for countries, admin boundaries, places, and coastlines
when building the archive. That avoids the visible double-line mismatch caused by
mixing unrelated GeoJSON boundary datasets.

Large tile assets are intentionally ignored by git. Put them here in local
development, or serve them from a same-origin static path/object storage location
and point the Vite variables above to that path.

`wbe-regions.pmtiles` is the business interaction layer for filtered PNDL
regions. Its source-layer must be `wbe_regions`, and each feature must include
`region_id`, `level`, `geo_key`, `parent_geo_key`, `display_name`, and
`bbox_w/bbox_s/bbox_e/bbox_n`. The frontend uses `region_id = level + "|" +
geo_key` to filter normal, hover, and selected region highlights.

Generate the cleaned, normalized source GeoJSON and validation report with:

```text
npm run tiles:regions:prepare
```

Build the local PMTiles archive with Docker:

```text
npm run tiles:regions:build
```

The generated report includes polygon cleaning counts by level. The current
application keeps cleaned GeoJSON only as a fallback when `wbe-regions.pmtiles`
is unavailable.
