# wbe-ui production image

The image builds the Vue application and serves `dist` with Nginx. The Nginx
container must share a Docker network with a backend service whose DNS/service
name is `backend` and whose HTTP port is `8080`.

## Build and start locally

From the `wbe-ui` directory:

```sh
docker build -f deploy/nginx/Dockerfile -t wbe-ui:local .
docker run --rm --name wbe-ui \
  --network YOUR_BACKEND_NETWORK \
  -p 8088:80 \
  wbe-ui:local
```

For Docker Compose, add the image/build as a frontend service next to the
existing `backend` service:

```yaml
services:
  backend:
    # Existing Spring Boot image/configuration.
    expose:
      - "8080"

  wbe-ui:
    build:
      context: .
      dockerfile: deploy/nginx/Dockerfile
    depends_on:
      - backend
    ports:
      - "8088:80"
```

Do not set a production API origin in Vite. Browser requests remain on `/api`
and Nginx resolves the private Docker service name.

Production builds enable the home overview API by default. For local
`npm run dev`, set `VITE_ENABLE_HOME_OVERVIEW_API=true` in the ignored
`.env.local`; an optional `WBE_DEV_PROXY_TARGET` environment variable may
point Vite at a development backend without changing application code.

## Verification

With Nginx available at `http://localhost:8088`:

```sh
# Page and production asset references
curl -fsS -D - -o /dev/null http://localhost:8088/

# Vue Router history fallback (must return the application index)
curl -fsS http://localhost:8088/map-visualization \
  | grep -F '<div id="app"></div>'
curl -fsS http://localhost:8088/icd11-sankey \
  | grep -F '<div id="app"></div>'

# API proxy (the status/body depends on the backend endpoint)
curl -i http://localhost:8088/api/map/filters
curl -i http://localhost:8088/api/icd11-sankey/categories
curl -i 'http://localhost:8088/api/icd11-sankey/graph-v2?category=ALL'

# PMTiles byte-range requests: each must return 206, Content-Range and 127 bytes.
curl -fsS -D - -o /dev/null \
  -H 'Range: bytes=0-126' \
  -w 'downloaded_bytes=%{size_download}\n' \
  http://localhost:8088/tiles/wbe-basemap.pmtiles
curl -fsS -D - -o /dev/null \
  -H 'Range: bytes=0-126' \
  -w 'downloaded_bytes=%{size_download}\n' \
  http://localhost:8088/tiles/wbe-regions.pmtiles

# An out-of-bounds range must return 416 instead of the complete archive.
curl -sS -D - -o /dev/null \
  -H 'Range: bytes=999999999-1000000000' \
  http://localhost:8088/tiles/wbe-regions.pmtiles

# Cache policy checks
curl -fsS -D - -o /dev/null http://localhost:8088/index.html
ASSET_PATH="$(curl -fsS http://localhost:8088/index.html \
  | sed -n 's/.*src="\\([^"]*\\/assets\\/[^"]*\\.js\\)".*/\\1/p' \
  | head -1)"
curl -fsS -D - -o /dev/null "http://localhost:8088${ASSET_PATH}"

# Split methodology API, cache and gzip check (expect ETag, public Cache-Control
# and Content-Encoding: gzip on the records response)
curl -fsS --compressed -D - -o /dev/null \
  -H 'Accept-Encoding: gzip' \
  http://localhost:8088/api/methodology/records

# Retired frontend copy must return 404 instead of the SPA fallback.
test "$(curl -sS -o /dev/null -w '%{http_code}' \
  http://localhost:8088/methodology/methodology-data.json)" = 404
```

The Range response is produced directly from the static file; `/tiles/` never
matches the Spring Boot proxy.
