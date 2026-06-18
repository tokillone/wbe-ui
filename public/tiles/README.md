# Self-hosted vector basemap assets

The map page first checks for this PMTiles archive:

```text
/tiles/wbe-basemap.pmtiles
```

When the file exists, MapLibre renders the basemap from PMTiles and only requests
tiles for the current viewport and zoom. When it does not exist, the page falls
back to the existing lightweight GeoJSON basemap.

Expected self-hosted assets:

```text
public/tiles/wbe-basemap.pmtiles
public/tiles/fonts/{fontstack}/{range}.pbf
public/tiles/sprites/light.json
public/tiles/sprites/light.png
```

The frontend can be pointed at another same-origin path with:

```text
VITE_BASEMAP_PM_TILES_URL=/tiles/wbe-basemap.pmtiles
VITE_BASEMAP_GLYPHS_URL=/tiles/fonts/{fontstack}/{range}.pbf
VITE_BASEMAP_SPRITE_URL=/tiles/sprites/light
```

Use one consistent source for countries, admin boundaries, places, and coastlines
when building the archive. That avoids the visible double-line mismatch caused by
mixing unrelated GeoJSON boundary datasets.
