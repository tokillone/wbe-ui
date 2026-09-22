export type RuntimeRegionIndexLevel = 'country' | 'admin1' | 'city'

export interface MapAssetManifest {
  schemaVersion: 1
  mapVersion: string
  baseUrl: string
}

export interface MapAssetUrls {
  manifestBacked: boolean
  mapVersion: string
  baseUrl: string
  pmtiles: string
  glyphs: string
  runtimeRegionIndexes: Record<RuntimeRegionIndexLevel, string>
  boundaries: Record<'countries' | 'admin1' | 'chinaProvinces' | 'chinaCities', string>
  boundaryLines: Record<'countries' | 'admin1' | 'chinaProvinces' | 'chinaCities', string>
  specialAdmin: string
  specialAdminLines: string
}

export const MAP_ASSET_MANIFEST_URL = '/map-assets/current/manifest.json'
export const ADMIN1_RUNTIME_INDEX_MIN_ZOOM = 3.5
export const CITY_RUNTIME_INDEX_MIN_ZOOM = 6.1

let mapAssetUrlsPromise: Promise<MapAssetUrls> | null = null

export function legacyMapAssetUrls(): MapAssetUrls {
  return buildMapAssetUrls('', false, 'legacy')
}

export function resolveMapAssetUrls(
  fetcher: typeof fetch = fetch,
  manifestUrl = MAP_ASSET_MANIFEST_URL,
): Promise<MapAssetUrls> {
  if (fetcher === fetch && manifestUrl === MAP_ASSET_MANIFEST_URL && mapAssetUrlsPromise) {
    return mapAssetUrlsPromise
  }
  const request = loadMapAssetUrls(fetcher, manifestUrl)
  if (fetcher === fetch && manifestUrl === MAP_ASSET_MANIFEST_URL) {
    mapAssetUrlsPromise = request
    void request.finally(() => {
      if (mapAssetUrlsPromise === request) mapAssetUrlsPromise = null
    })
  }
  return request
}

export function resetMapAssetManifestCache() {
  mapAssetUrlsPromise = null
}

export function runtimeRegionIndexLevelsForZoom(zoom: number): RuntimeRegionIndexLevel[] {
  const levels: RuntimeRegionIndexLevel[] = ['country']
  if (zoom >= ADMIN1_RUNTIME_INDEX_MIN_ZOOM) levels.push('admin1')
  if (zoom >= CITY_RUNTIME_INDEX_MIN_ZOOM) levels.push('city')
  return levels
}

export function mapAssetFailureRequiresGeoJson(sourceId: string, message: string) {
  return sourceId === 'protomaps' || /pmtiles|glyph|sprite|font/i.test(message)
}

async function loadMapAssetUrls(fetcher: typeof fetch, manifestUrl: string) {
  try {
    const response = await fetcher(manifestUrl, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return legacyMapAssetUrls()
    const manifest = (await response.json()) as Partial<MapAssetManifest>
    if (!isValidManifest(manifest)) return legacyMapAssetUrls()
    return buildMapAssetUrls(manifest.baseUrl, true, manifest.mapVersion)
  } catch {
    return legacyMapAssetUrls()
  }
}

function isValidManifest(manifest: Partial<MapAssetManifest>): manifest is MapAssetManifest {
  if (manifest.schemaVersion !== 1 || typeof manifest.mapVersion !== 'string') return false
  if (!/^[A-Za-z0-9._-]+$/.test(manifest.mapVersion)) return false
  if (typeof manifest.baseUrl !== 'string') return false
  const baseUrl = manifest.baseUrl.replace(/\/+$/, '')
  return (
    baseUrl === `/map-assets/${manifest.mapVersion}` &&
    !baseUrl.includes('..') &&
    !baseUrl.includes('://') &&
    baseUrl !== '/map-assets/current'
  )
}

function buildMapAssetUrls(baseUrl: string, manifestBacked: boolean, mapVersion: string) {
  const base = baseUrl.replace(/\/+$/, '')
  const path = (value: string) => `${base}${value}`
  return {
    manifestBacked,
    mapVersion,
    baseUrl: base,
    pmtiles: path('/tiles/wbe-preview-composite.pmtiles'),
    glyphs: path('/tiles/fonts/{fontstack}/{range}.pbf'),
    runtimeRegionIndexes: {
      country: path('/geo/render/region-index-country.runtime.json'),
      admin1: path('/geo/render/region-index-admin1.runtime.json'),
      city: path('/geo/render/region-index-city.runtime.json'),
    },
    boundaries: {
      countries: path('/geo/render/world-countries.geojson'),
      admin1: path('/geo/render/world-admin1.geojson'),
      chinaProvinces: path('/geo/render/china-provinces.geojson'),
      chinaCities: path('/geo/render/china-cities.geojson'),
    },
    boundaryLines: {
      countries: path('/geo/render/world-countries-lines.geojson'),
      admin1: path('/geo/render/world-admin1-lines.geojson'),
      chinaProvinces: path('/geo/render/china-provinces-lines.geojson'),
      chinaCities: path('/geo/render/china-cities-lines.geojson'),
    },
    specialAdmin: path('/geo/render/china-special-admin-envelopes.geojson'),
    specialAdminLines: path('/geo/render/china-special-admin-envelopes-lines.geojson'),
  } satisfies MapAssetUrls
}
