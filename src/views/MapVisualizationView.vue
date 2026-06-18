<script setup lang="ts">
import 'maplibre-gl/dist/maplibre-gl.css'

import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import { buildSelectionKey, fetchMapDetail, fetchMapFilters, fetchMapStats } from '../services/map'
import type {
  MapDetailResponse,
  MapFilterResponse,
  MapFilterSelection,
  MapRegionStat,
  MapStatsResponse,
} from '../types/map'

import type {
  GeoJSONSource,
  LngLatBoundsLike,
  LngLatLike,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  MapMouseEvent,
  Popup,
} from 'maplibre-gl'

type MapMode = 'globe' | 'flat'
type BasemapMode = 'vector' | 'geojson'
type BoundaryName = 'countries' | 'admin1' | 'chinaProvinces' | 'chinaCities'
type ViewLayerKey = 'labels' | 'boundaries' | 'pndl' | 'ambience'
type GeoJsonFeature = {
  type: 'Feature'
  properties: Record<string, unknown>
  geometry: unknown
}
type FeatureCollection = {
  type: 'FeatureCollection'
  features: GeoJsonFeature[]
}
type MapLibreModule = typeof import('maplibre-gl') & {
  default?: typeof import('maplibre-gl')
}
type ClusterGeoJSONSource = GeoJSONSource & {
  getClusterExpansionZoom?: (clusterId: number) => Promise<number>
}
type MapSearchResult = {
  id: string
  label: string
  meta: string
  level: MapRegionStat['level']
  geoKey: string
  center?: [number, number]
  bbox?: [number, number, number, number]
}
type MapStatus = {
  latitude: number
  longitude: number
  country: string
  mode: 'center' | 'cursor'
}
type BasemapConfig =
  | { mode: 'geojson' }
  | {
      mode: 'vector'
      styleSourceUrl: string
      layers: unknown[]
      glyphs: string
      sprite: string
    }

const EMPTY_COLLECTION: FeatureCollection = { type: 'FeatureCollection', features: [] }
const BASEMAP_PM_TILES_URL =
  import.meta.env.VITE_BASEMAP_PM_TILES_URL || '/tiles/wbe-basemap.pmtiles'
const BASEMAP_GLYPHS_URL =
  import.meta.env.VITE_BASEMAP_GLYPHS_URL || '/tiles/fonts/{fontstack}/{range}.pbf'
const BASEMAP_SPRITE_URL = import.meta.env.VITE_BASEMAP_SPRITE_URL || '/tiles/sprites/light'
const BOUNDARY_URLS: Record<BoundaryName, string> = {
  countries: '/geo/world-countries.geojson',
  admin1: '/geo/world-admin1.geojson',
  chinaProvinces: '/geo/china-provinces.geojson',
  chinaCities: '/geo/china-cities.geojson',
}
const DEFAULT_SELECTION: MapFilterSelection = {
  category: '',
  subcategory: '全部小类',
  biomarkerKey: 'ALL',
  year: '全部年份',
}
const REGION_INTERACTIVE_LAYERS = [
  'country-land',
  'admin1-land',
  'china-province-land',
  'china-city-land',
] as const
const POINT_INTERACTIVE_LAYERS = ['pndl-clusters', 'pndl-bubbles'] as const
const ALL_INTERACTIVE_LAYERS = [...REGION_INTERACTIVE_LAYERS, ...POINT_INTERACTIVE_LAYERS] as const
const FLAT_CENTER: [number, number] = [18, 24]
const CHINA_CENTER: [number, number] = [104, 35]
const CHINA_VIEW_ZOOM = 3.65
const FLAT_INITIAL_ZOOM = 1.75
const FLAT_MIN_ZOOM = 1.25
const GLOBE_MIN_ZOOM = 2.42
const GLOBE_INITIAL_ZOOM = 2.44
const PMTILES_MAGIC = 'PMTiles'
const DENSE_POINT_RADIUS_DEGREES = 38
const COUNTRY_STATUS_UPDATE_DELAY = 280
const LABEL_LAYER_IDS = [
  'country-label',
  'admin1-label',
  'china-province-label',
  'china-city-label',
] as const
const BOUNDARY_LAYER_IDS = [
  'country-line',
  'admin1-line',
  'china-province-line',
  'china-city-line',
] as const
const PNDL_LAYER_IDS = ['pndl-clusters', 'pndl-cluster-count', 'pndl-bubbles'] as const

const mapContainer = ref<HTMLElement | null>(null)
const filters = ref<MapFilterResponse | null>(null)
const stats = ref<MapStatsResponse | null>(null)
const selectedDetail = ref<MapDetailResponse | null>(null)
const mapError = ref('')
const filterError = ref('')
const detailError = ref('')
const isLoadingFilters = ref(false)
const isLoadingStats = ref(false)
const isLoadingDetail = ref(false)
const mapMode = ref<MapMode>('flat')
const mapReady = ref(false)
const boundaryVersion = ref(0)
const globeAvailable = ref(false)
const isDetailOpen = ref(false)
const isFilterOpen = ref(true)
const isLayerPanelOpen = ref(false)
const searchQuery = ref('')
const isSearchFocused = ref(false)
const mapStatus = ref<MapStatus>({
  latitude: FLAT_CENTER[1],
  longitude: FLAT_CENTER[0],
  country: '未识别',
  mode: 'center',
})
const selection = reactive<MapFilterSelection>({ ...DEFAULT_SELECTION })
const viewLayers = reactive<Record<ViewLayerKey, boolean>>({
  labels: true,
  boundaries: true,
  pndl: true,
  ambience: true,
})

let maplibregl: MapLibreModule | null = null
let map: MapLibreMap | null = null
let basemapMode: BasemapMode = 'geojson'
let hoverPopup: Popup | null = null
let statsController: AbortController | null = null
let detailController: AbortController | null = null
let fetchTimer: number | undefined
let clickTimer: number | undefined
let searchBlurTimer: number | undefined
let resizeTimer: number | undefined
let regionTooltipTimer: number | undefined
let mapStatusFrame: number | undefined
let countryStatusTimer: number | undefined
let pendingCursorPoint: [number, number] | null = null
let pendingCursorPixel: [number, number] | null = null
let removePmtilesProtocol: (() => void) | null = null
let pointLayerEventsBound = false
let regionLayerEventsBound = false
let isBasemapFallbackInProgress = false
const boundaryCache = new Map<BoundaryName, FeatureCollection>()

const currentSubcategories = computed(() =>
  filters.value?.subcategoriesByCategory[selection.category] ?? [],
)
const currentBiomarkers = computed(
  () =>
    filters.value?.biomarkersByCategorySubcategory[
      buildSelectionKey(selection.category, selection.subcategory)
    ] ?? [],
)
const currentYears = computed(
  () =>
    filters.value?.yearsBySelection[
      buildSelectionKey(selection.category, selection.subcategory, selection.biomarkerKey)
    ] ?? [],
)
const selectedBiomarkerLabel = computed(
  () =>
    currentBiomarkers.value.find((item) => item.key === selection.biomarkerKey)?.label ??
    '全部 biomarker',
)
const detailRegion = computed(() => selectedDetail.value?.region ?? null)
const searchResults = computed(() => {
  boundaryVersion.value
  const query = normalizeSearch(searchQuery.value)
  if (!query) return []
  return buildSearchCandidates()
    .filter((item) => normalizeSearch(`${item.label} ${item.meta} ${item.geoKey}`).includes(query))
    .slice(0, 8)
})
const formattedMapStatus = computed(() => ({
  latitude: formatCoordinate(mapStatus.value.latitude, 'latitude'),
  longitude: formatCoordinate(mapStatus.value.longitude, 'longitude'),
  country: mapStatus.value.country,
  label: mapStatus.value.mode === 'cursor' ? '鼠标' : '中心',
}))

watch(
  () => selection.category,
  () => {
    const nextSubcategory = currentSubcategories.value[0] ?? '全部小类'
    if (selection.subcategory !== nextSubcategory) selection.subcategory = nextSubcategory
  },
)
watch(
  () => selection.subcategory,
  () => {
    const allBiomarkers = currentBiomarkers.value
    const nextBiomarker =
      allBiomarkers.find((item) => item.key === 'ALL')?.key ?? allBiomarkers[0]?.key ?? 'ALL'
    if (selection.biomarkerKey !== nextBiomarker) selection.biomarkerKey = nextBiomarker
  },
)
watch(
  () => selection.biomarkerKey,
  () => {
    const nextYear =
      currentYears.value.find((item) => item === '全部年份') ??
      currentYears.value[0] ??
      '全部年份'
    if (selection.year !== nextYear) selection.year = nextYear
  },
)
watch(
  () => ({ ...selection }),
  () => {
    closeDetail()
    selectedDetail.value = null
    if (selection.category) scheduleStatsFetch()
  },
  { deep: true },
)
watch(
  viewLayers,
  () => {
    applyViewLayerVisibility()
  },
  { deep: true },
)

onMounted(async () => {
  await loadFilters()
  await nextTick()
  await initMap()
  window.addEventListener('resize', handleMapResize)
  window.addEventListener('keydown', handleMapKeydown)
  if (selection.category) scheduleStatsFetch(0)
})

onBeforeUnmount(() => {
  if (fetchTimer) window.clearTimeout(fetchTimer)
  if (clickTimer) window.clearTimeout(clickTimer)
  if (searchBlurTimer) window.clearTimeout(searchBlurTimer)
  if (resizeTimer) window.clearTimeout(resizeTimer)
  if (regionTooltipTimer) window.clearTimeout(regionTooltipTimer)
  if (countryStatusTimer != null) {
    window.clearTimeout(countryStatusTimer)
    countryStatusTimer = undefined
  }
  if (mapStatusFrame != null) {
    window.cancelAnimationFrame(mapStatusFrame)
    mapStatusFrame = undefined
  }
  window.removeEventListener('resize', handleMapResize)
  window.removeEventListener('keydown', handleMapKeydown)
  statsController?.abort()
  detailController?.abort()
  hoverPopup?.remove()
  map?.remove()
  map = null
  removePmtilesProtocol?.()
  removePmtilesProtocol = null
})

async function loadFilters() {
  isLoadingFilters.value = true
  filterError.value = ''
  const controller = new AbortController()
  try {
    const result = await fetchMapFilters(controller.signal)
    filters.value = result
    Object.assign(selection, result.defaultSelection ?? DEFAULT_SELECTION)
  } catch (error) {
    filterError.value = error instanceof Error ? error.message : '筛选项加载失败'
  } finally {
    isLoadingFilters.value = false
  }
}

async function initMap() {
  if (!mapContainer.value) return
  try {
    const module = await import('maplibre-gl')
    maplibregl = ((module as MapLibreModule).default ?? module) as MapLibreModule
    globeAvailable.value = canUseGlobe(maplibregl)
    mapMode.value = 'flat'
    const basemapConfig = await resolveBasemapConfig(maplibregl)
    basemapMode = basemapConfig.mode
    map = new maplibregl.Map({
      container: mapContainer.value,
      style: buildMapStyle(mapMode.value, basemapConfig) as never,
      center: FLAT_CENTER as LngLatLike,
      zoom: FLAT_INITIAL_ZOOM,
      minZoom: FLAT_MIN_ZOOM,
      maxZoom: 10.5,
      attributionControl: false,
    })
    map.doubleClickZoom.disable()
    map.on('error', (event) => handleMapRuntimeError(event))
    hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14 })
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
      'top-right',
    )
    map.on('load', () => {
      mapReady.value = true
      addMapSourcesAndLayers()
      bindLayerEvents()
      if (basemapMode === 'geojson') {
        ensureBoundary('countries')
        ensureBoundary('chinaProvinces')
      }
      updateMapData()
      enforceGlobeSafeZoom(false)
      updateMapStatus()
    })
    map.on('zoomend', () => {
      updateMapStatus()
      if (basemapMode !== 'geojson') return
      const zoom = map?.getZoom() ?? 0
      if (zoom >= 3.2) ensureBoundary('admin1')
      if (zoom >= 5.4) ensureBoundary('chinaCities')
    })
    map.on('move', scheduleLiveMapStatusUpdate)
    map.on('moveend', updateMapStatus)
    map.on('mousemove', handleMapMouseMove)
    map.on('mouseleave', handleMapMouseLeave)
    map.on('click', hideTooltipOnEmptyClick)
    updateMapCoordinates()
  } catch (error) {
    mapError.value = error instanceof Error ? error.message : '地图初始化失败'
    mapMode.value = 'flat'
  }
}

function canUseGlobe(_module: MapLibreModule) {
  const canvas = document.createElement('canvas')
  return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
}

async function resolveBasemapConfig(module: MapLibreModule): Promise<BasemapConfig> {
  const pmtilesUrl = BASEMAP_PM_TILES_URL.trim()
  if (!pmtilesUrl || !(await canLoadVectorBasemapAssets(pmtilesUrl))) {
    return { mode: 'geojson' }
  }

  try {
    const [{ Protocol }, basemaps] = await Promise.all([
      import('pmtiles'),
      import('@protomaps/basemaps'),
    ])
    const protocol = new Protocol()
    ;(module as unknown as { addProtocol?: (scheme: string, loader: unknown) => void }).addProtocol?.(
      'pmtiles',
      protocol.tile,
    )
    removePmtilesProtocol = () => {
      ;(module as unknown as { removeProtocol?: (scheme: string) => void }).removeProtocol?.(
        'pmtiles',
      )
    }

    return {
      mode: 'vector',
      styleSourceUrl: `pmtiles://${new URL(pmtilesUrl, window.location.origin).toString()}`,
      layers: basemaps.layers('protomaps', basemaps.namedFlavor('light'), { lang: 'en' }),
      glyphs: BASEMAP_GLYPHS_URL,
      sprite: BASEMAP_SPRITE_URL,
    }
  } catch {
    removePmtilesProtocol?.()
    removePmtilesProtocol = null
    return { mode: 'geojson' }
  }
}

async function canLoadVectorBasemapAssets(pmtilesUrl: string) {
  if (!(await canLoadPmtilesArchive(pmtilesUrl))) return false
  const glyphUrl = glyphProbeUrl(BASEMAP_GLYPHS_URL)
  const spriteUrl = spriteProbeUrl(BASEMAP_SPRITE_URL)
  if (!glyphUrl || !spriteUrl) return false
  const [glyphsAvailable, spriteAvailable] = await Promise.all([
    canLoadStaticAsset(glyphUrl),
    canLoadStaticAsset(spriteUrl),
  ])
  return glyphsAvailable && spriteAvailable
}

async function canLoadPmtilesArchive(url: string) {
  let headRejected = false
  try {
    const head = await fetch(url, { method: 'HEAD', cache: 'no-store' })
    if (head.ok) {
      const contentLength = Number(head.headers.get('content-length') ?? '0')
      if (contentLength > 0 && contentLength < PMTILES_MAGIC.length) return false
    } else if (head.status !== 405) {
      headRejected = true
    }
  } catch {
    headRejected = true
  }
  if (headRejected) return false

  try {
    const prefix = await fetchResponsePrefix(url, PMTILES_MAGIC.length)
    return prefix === PMTILES_MAGIC
  } catch {
    return false
  }
}

async function fetchResponsePrefix(url: string, length: number) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Range: `bytes=0-${length - 1}` },
  })
  if (!response.ok && response.status !== 206) return ''
  if (response.status === 200 && response.body) {
    const reader = response.body.getReader()
    const { value } = await reader.read()
    void reader.cancel()
    return value ? new TextDecoder().decode(value.slice(0, length)) : ''
  }
  const buffer = await response.arrayBuffer()
  return new TextDecoder().decode(new Uint8Array(buffer).slice(0, length))
}

function glyphProbeUrl(template: string) {
  const trimmed = template.trim()
  if (!trimmed) return ''
  return trimmed
    .replace('{fontstack}', encodeURIComponent('Noto Sans Regular'))
    .replace('{range}', '0-255')
}

function spriteProbeUrl(template: string) {
  const trimmed = template.trim()
  if (!trimmed) return ''
  return trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`
}

async function canLoadStaticAsset(url: string) {
  try {
    const head = await fetch(url, { method: 'HEAD', cache: 'no-store' })
    if (head.ok) return true
    if (head.status !== 405) return false
  } catch {
    return false
  }

  try {
    const response = await fetch(url, { cache: 'no-store' })
    await response.body?.cancel()
    return response.ok
  } catch {
    return false
  }
}

function handleMapRuntimeError(event: unknown) {
  if (basemapMode !== 'vector' || isBasemapFallbackInProgress) return
  const payload = event as {
    error?: { message?: string }
    sourceId?: string
    tile?: unknown
  }
  const sourceId = String(payload.sourceId ?? '')
  const message = String(payload.error?.message ?? '')
  if (sourceId && sourceId !== 'protomaps') return
  if (message && /map-points|pndl/i.test(message)) return
  if (!message && !sourceId && !payload.tile) return
  fallbackToGeoJsonBasemap()
}

function fallbackToGeoJsonBasemap() {
  if (!map || basemapMode === 'geojson' || isBasemapFallbackInProgress) return
  isBasemapFallbackInProgress = true
  basemapMode = 'geojson'
  map.stop()
  map.setStyle(buildMapStyle(mapMode.value, { mode: 'geojson' }) as never)
  const restore = () => {
    if (!isBasemapFallbackInProgress) return
    restoreGeoJsonBasemapLayers()
  }
  map.once('idle', restore)
  window.setTimeout(restore, 700)
}

function restoreGeoJsonBasemapLayers() {
  if (!map) return
  if (!map.isStyleLoaded()) {
    map.once('idle', restoreGeoJsonBasemapLayers)
    return
  }
  isBasemapFallbackInProgress = false
  mapReady.value = true
  addMapSourcesAndLayers()
  bindLayerEvents()
  void ensureBoundary('countries')
  void ensureBoundary('chinaProvinces')
  ensureFallbackBoundaries()
  updateMapData()
  enforceGlobeSafeZoom(false)
}

function buildMapStyle(mode: MapMode, basemapConfig: BasemapConfig) {
  if (basemapConfig.mode === 'vector') {
    return {
      version: 8,
      projection: { type: mode === 'globe' ? 'globe' : 'mercator' },
      glyphs: basemapConfig.glyphs,
      sprite: basemapConfig.sprite,
      sources: {
        protomaps: {
          type: 'vector',
          attribution:
            '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://osm.org/copyright">OpenStreetMap</a>',
          url: basemapConfig.styleSourceUrl,
        },
      },
      layers: vectorBasemapLayers(basemapConfig.layers, mode),
      ...(mode === 'globe' ? globeAtmosphereStyle() : {}),
    }
  }

  return {
    version: 8,
    projection: { type: mode === 'globe' ? 'globe' : 'mercator' },
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: {
          'background-color': mode === 'globe' ? '#83a4b8' : '#e7edf1',
        },
      },
    ],
    ...(mode === 'globe' ? globeAtmosphereStyle() : {}),
  }
}

function globeAtmosphereStyle() {
  return {
    sky: {
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.88, 5, 0.82, 7, 0],
    },
    light: {
      anchor: 'map',
      position: [1.45, 90, 74],
      color: '#ffffff',
      intensity: 0.38,
    },
  }
}

function vectorBasemapLayers(layers: unknown[], mode: MapMode) {
  return layers.map((layer) => {
    if (!isStyleLayer(layer) || layer.id !== 'background') return layer
    return {
      ...layer,
      paint: {
        ...(layer.paint ?? {}),
        'background-color': mode === 'globe' ? '#83a4b8' : '#e7edf1',
      },
    }
  })
}

function isStyleLayer(layer: unknown): layer is { id: string; paint?: Record<string, unknown> } {
  return typeof layer === 'object' && layer !== null && 'id' in layer
}

function addMapSourcesAndLayers() {
  if (!map) return
  if (basemapMode === 'geojson') {
    addGeoSource('country-boundaries')
    addGeoSource('admin1-boundaries')
    addGeoSource('china-province-boundaries')
    addGeoSource('china-city-boundaries')
    addGeoSource('country-label-points')
    addGeoSource('admin1-label-points')
    addGeoSource('china-province-label-points')
    addGeoSource('china-city-label-points')
  }
  addPointSource()

  if (basemapMode === 'geojson') {
    addBaseFillLayer('country-land', 'country-boundaries')
    addBaseFillLayer('admin1-land', 'admin1-boundaries', 3.2, 0)
    addBaseFillLayer('china-province-land', 'china-province-boundaries', 3.2, 0)
    addBaseFillLayer('china-city-land', 'china-city-boundaries', 5.6, 0)
    addLineLayer('country-line', 'country-boundaries', '#9aa7ae', 0.72)
    addLineLayer('admin1-line', 'admin1-boundaries', '#a4adb4', 0.42, 3.2)
    addLineLayer('china-province-line', 'china-province-boundaries', '#8c99a2', 0.68, 3.2)
    addLineLayer('china-city-line', 'china-city-boundaries', '#b1bac0', 0.42, 5.6)

    addLabelLayer('country-label', 'country-label-points', 1.7, 4.1, 12)
    addLabelLayer('admin1-label', 'admin1-label-points', 3.8, 6.3, 10, false)
    addLabelLayer('china-province-label', 'china-province-label-points', 3.8, 6.3, 10)
    addLabelLayer('china-city-label', 'china-city-label-points', 6.2, undefined, 10)
  }

  addMapLayer({
    id: 'pndl-clusters',
    type: 'circle',
    source: 'map-points',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': [
        'step',
        ['get', 'point_count'],
        '#6c5ce7',
        5,
        '#4f46c8',
        12,
        '#332a91',
      ],
      'circle-radius': ['step', ['get', 'point_count'], 15, 5, 21, 12, 29],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
      'circle-opacity': 0.9,
    },
  })
  addMapLayer({
    id: 'pndl-cluster-count',
    type: 'symbol',
    source: 'map-points',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 12,
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': 'rgba(19, 46, 63, 0.22)',
      'text-halo-width': 0.6,
    },
  })
  addMapLayer({
    id: 'pndl-bubbles',
    type: 'circle',
    source: 'map-points',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'pndlRank'], 0, 5, 1, 20],
      'circle-color': ['case', ['==', ['get', 'level'], 'city'], '#7868f1', '#ffffff'],
      'circle-opacity': ['case', ['==', ['get', 'level'], 'city'], 0.9, 0.78],
      'circle-stroke-color': ['case', ['==', ['get', 'level'], 'city'], '#4f46c8', '#7868f1'],
      'circle-stroke-width': ['case', ['==', ['get', 'level'], 'city'], 1.4, 2.4],
    },
  })
  applyViewLayerVisibility()
}

function addGeoSource(id: string) {
  if (!map?.getSource(id)) {
    map?.addSource(id, { type: 'geojson', data: EMPTY_COLLECTION as never })
  }
}

function addMapLayer(layer: unknown) {
  const id = (layer as { id?: string }).id
  if (!map || !id || map.getLayer(id)) return
  map.addLayer(layer as never)
}

function addPointSource() {
  if (!map?.getSource('map-points')) {
    map?.addSource('map-points', {
      type: 'geojson',
      data: EMPTY_COLLECTION as never,
      cluster: true,
      clusterMaxZoom: 8,
      clusterRadius: 62,
    })
  }
}

function addBaseFillLayer(id: string, source: string, minzoom = 0, opacity = 0.92) {
  addMapLayer({
    id,
    type: 'fill',
    source,
    minzoom,
    paint: {
      'fill-color': '#f6f7f4',
      'fill-opacity': opacity,
    },
  })
}

function addLineLayer(id: string, source: string, color: string, width: number, minzoom = 0) {
  addMapLayer({
    id,
    type: 'line',
    source,
    minzoom,
    paint: {
      'line-color': color,
      'line-width': ['interpolate', ['linear'], ['zoom'], minzoom, width, 8, width * 1.9],
      'line-opacity': 0.86,
    },
  })
}

function addLabelLayer(
  id: string,
  source: string,
  minzoom: number,
  maxzoom: number | undefined,
  textSize: number,
  includeChina = true,
) {
  addMapLayer({
    id,
    type: 'symbol',
    source,
    minzoom,
    ...(maxzoom ? { maxzoom } : {}),
    ...(includeChina ? {} : { filter: ['!=', ['get', 'country_key'], 'china'] }),
    layout: {
      'text-field': ['get', 'display_name'],
      'text-size': ['interpolate', ['linear'], ['zoom'], minzoom, textSize, 8, textSize + 2],
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-padding': 8,
    },
    paint: {
      'text-color': '#59636f',
      'text-halo-color': 'rgba(255,255,255,0.86)',
      'text-halo-width': 1.6,
      'text-opacity': ['interpolate', ['linear'], ['zoom'], minzoom, 0.08, minzoom + 0.8, 0.88],
    },
  })
}

function bindLayerEvents() {
  if (!pointLayerEventsBound) {
    POINT_INTERACTIVE_LAYERS.forEach((layerId) => {
      map?.on('mousemove', layerId, showTooltip)
      map?.on('mouseleave', layerId, hideTooltip)
      map?.on('click', layerId, handlePointClick)
      map?.on('dblclick', layerId, handleFeatureDoubleClick)
    })
    pointLayerEventsBound = true
  }
  if (basemapMode !== 'geojson') return
  if (!regionLayerEventsBound) {
    REGION_INTERACTIVE_LAYERS.forEach((layerId) => {
      map?.on('mousemove', layerId, showTooltip)
      map?.on('mouseleave', layerId, hideTooltip)
      map?.on('click', layerId, handleRegionClick)
      map?.on('dblclick', layerId, handleFeatureDoubleClick)
    })
    regionLayerEventsBound = true
  }
}

async function ensureBoundary(name: BoundaryName) {
  if (basemapMode !== 'geojson' || !mapReady.value || boundaryCache.has(name)) return
  try {
    const response = await fetch(BOUNDARY_URLS[name])
    if (!response.ok) throw new Error(`${name} boundary failed`)
    boundaryCache.set(name, (await response.json()) as FeatureCollection)
    boundaryVersion.value += 1
    updateBoundarySource(name)
    updatePointSource()
    if (name === 'countries') updateMapStatus()
  } catch {
    mapError.value = '部分地图边界加载失败'
  }
}

function updateMapData() {
  if (!mapReady.value) return
  if (basemapMode === 'geojson') {
    ;(['countries', 'admin1', 'chinaProvinces', 'chinaCities'] as BoundaryName[]).forEach(
      updateBoundarySource,
    )
  }
  updatePointSource()
}

function updateBoundarySource(name: BoundaryName) {
  const collection = boundaryCache.get(name)
  if (!collection) return
  const sourceId = boundarySourceId(name)
  const source = map?.getSource(sourceId) as GeoJSONSource | undefined
  source?.setData(enrichBoundaryCollection(collection, boundaryLevel(name)) as never)
  updateLabelSource(name, collection)
}

function updateLabelSource(name: BoundaryName, collection: FeatureCollection) {
  const source = map?.getSource(labelSourceId(name)) as GeoJSONSource | undefined
  source?.setData(buildLabelPointCollection(collection, boundaryLevel(name)) as never)
}

function updatePointSource() {
  const source = map?.getSource('map-points') as GeoJSONSource | undefined
  source?.setData(buildPointCollection() as never)
}

function enrichBoundaryCollection(collection: FeatureCollection, level: MapRegionStat['level']) {
  const statIndex = buildStatIndex()
  return {
    type: 'FeatureCollection',
    features: collection.features.map((feature) => {
      const geoKey = featureGeoKey(feature, level)
      const stat = statIndex.get(`${level}|${geoKey}`)
      return {
        ...feature,
        properties: {
          ...feature.properties,
          boundaryLevel: level,
          geoKey,
          ...(stat ? statProperties(stat) : {}),
        },
      }
    }),
  }
}

function buildLabelPointCollection(collection: FeatureCollection, level: MapRegionStat['level']) {
  const seen = new Set<string>()
  const features = collection.features.flatMap((feature) => {
    const geoKey = featureGeoKey(feature, level)
    if (!geoKey || seen.has(geoKey)) return []
    const coordinates = labelPointForGeometry(feature.geometry)
    if (!coordinates) return []
    seen.add(geoKey)
    return [
      {
        type: 'Feature',
        properties: {
          ...feature.properties,
          boundaryLevel: level,
          geoKey,
        },
        geometry: {
          type: 'Point',
          coordinates,
        },
      },
    ]
  })
  return { type: 'FeatureCollection', features }
}

function buildPointCollection() {
  return {
    type: 'FeatureCollection',
    features: displayPointRows().flatMap((row) => {
      const coordinates = representativeCoordinates(row)
      if (!coordinates) return []
      return [
        {
          type: 'Feature',
          properties: statProperties(row),
          geometry: {
            type: 'Point',
            coordinates,
          },
        },
      ]
    }),
  }
}

function displayPointRows() {
  const rows = stats.value?.points ?? []
  const grouped = new Map<string, MapRegionStat[]>()
  rows.forEach((row) => {
    const key = countryGroupKey(row)
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  })
  return [...grouped.values()].flatMap((group) => {
    const cityRows = group.filter((row) => row.level === 'city')
    if (cityRows.length) return cityRows
    const adminRows = group.filter((row) => row.level === 'admin1')
    if (adminRows.length) return adminRows
    return group.filter((row) => row.level === 'country')
  })
}

function representativeCoordinates(row: MapRegionStat): [number, number] | null {
  if (row.level !== 'city') {
    const boundaryCenter = representativeBoundaryCenter(row)
    if (boundaryCenter) return boundaryCenter
  }
  if (row.latitude == null || row.longitude == null) return null
  return [Number(row.longitude), Number(row.latitude)]
}

function representativeBoundaryCenter(row: MapRegionStat): [number, number] | null {
  if (basemapMode !== 'geojson') return null
  const feature = findBoundaryFeature(row)
  const bbox = feature ? featureBbox(feature.geometry) : null
  if (!bbox) return null
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
}

function findBoundaryFeature(row: MapRegionStat) {
  const names: BoundaryName[] =
    row.level === 'country'
      ? ['countries']
      : row.geoKey.startsWith('china|')
        ? ['chinaProvinces', 'admin1']
        : ['admin1']
  for (const name of names) {
    const collection = boundaryCache.get(name)
    if (!collection) continue
    const level = boundaryLevel(name)
    const feature = collection.features.find((item) => featureGeoKey(item, level) === row.geoKey)
    if (feature) return feature
  }
  return null
}

function statProperties(stat: MapRegionStat) {
  return {
    level: stat.level,
    geoKey: stat.geoKey,
    countryKey: countryGroupKey(stat),
    displayName: stat.displayName,
    biomarkerLabel: stat.biomarkerLabel,
    locationPrecision: locationPrecisionLabel(stat.level),
    pndlGeomean: numberOrNull(stat.pndlGeomeanMgD1000inh),
    pndlMean: numberOrNull(stat.pndlMeanMgD1000inh),
    pndlMin: numberOrNull(stat.pndlMinMgD1000inh),
    pndlMax: numberOrNull(stat.pndlMaxMgD1000inh),
    pndlRank: valueRank(stat.pndlGeomeanMgD1000inh),
    recordCount: stat.recordCount ?? 0,
    doiCount: stat.doiCount ?? 0,
    yearCount: stat.yearCount ?? 0,
    pointCount: stat.pointCount ?? 0,
    pndlSources: stat.pndlSources ?? '',
  }
}

function countryGroupKey(row: MapRegionStat) {
  if (row.level === 'country') return row.geoKey
  if (row.parentGeoKey) return row.parentGeoKey
  return row.geoKey.split('|')[0] ?? row.geoKey
}

function locationPrecisionLabel(level: MapRegionStat['level'] | string) {
  if (level === 'city') return '城市级位置'
  if (level === 'admin1') return '省州级位置'
  return '国家级位置'
}

function buildStatIndex() {
  return new Map((stats.value?.regions ?? []).map((row) => [`${row.level}|${row.geoKey}`, row]))
}

function buildSearchCandidates() {
  const candidates = new Map<string, MapSearchResult>()
  ;[...(stats.value?.points ?? []), ...(stats.value?.regions ?? [])].forEach((row) => {
    const center =
      row.longitude != null && row.latitude != null
        ? ([Number(row.longitude), Number(row.latitude)] as [number, number])
        : undefined
    addSearchCandidate(candidates, {
      id: `stat|${row.level}|${row.geoKey}`,
      label: row.displayName,
      meta: [locationPrecisionLabel(row.level), row.country, row.province, row.city]
        .filter(Boolean)
        .join(' · '),
      level: row.level,
      geoKey: row.geoKey,
      center,
    })
  })
  boundarySearchCandidates(candidates)
  return [...candidates.values()]
}

function boundarySearchCandidates(candidates: Map<string, MapSearchResult>) {
  ;(['countries', 'admin1', 'chinaProvinces', 'chinaCities'] as BoundaryName[]).forEach((name) => {
    const collection = boundaryCache.get(name)
    if (!collection) return
    const level = boundaryLevel(name)
    collection.features.forEach((feature) => {
      const props = feature.properties
      const label = String(props.display_name ?? props.name ?? '').trim()
      if (!label) return
      const geoKey = featureGeoKey(feature, level)
      addSearchCandidate(candidates, {
        id: `boundary|${level}|${geoKey}`,
        label,
        meta: [locationPrecisionLabel(level), props.country_display].filter(Boolean).join(' · '),
        level,
        geoKey,
        bbox: featureBbox(feature.geometry) ?? undefined,
      })
    })
  })
}

function addSearchCandidate(candidates: Map<string, MapSearchResult>, candidate: MapSearchResult) {
  const key = `${candidate.level}|${candidate.geoKey}`
  const existing = candidates.get(key)
  if (!existing || (!existing.center && candidate.center)) {
    candidates.set(key, candidate)
  }
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function openSearch() {
  if (searchBlurTimer) window.clearTimeout(searchBlurTimer)
  isSearchFocused.value = true
  if (basemapMode === 'geojson') {
    void ensureBoundary('admin1')
    void ensureBoundary('chinaCities')
  }
}

function closeSearchSoon() {
  if (searchBlurTimer) window.clearTimeout(searchBlurTimer)
  searchBlurTimer = window.setTimeout(() => {
    closeSearch()
  }, 130)
}

function closeSearch() {
  if (searchBlurTimer) window.clearTimeout(searchBlurTimer)
  isSearchFocused.value = false
}

function clearSearch() {
  searchQuery.value = ''
  openSearch()
}

function applyFirstSearchResult() {
  const [first] = searchResults.value
  if (first) focusSearchResult(first)
}

function focusSearchResult(result: MapSearchResult) {
  if (!map) return
  searchQuery.value = result.label
  isSearchFocused.value = false
  map.stop()
  if (result.center) {
    map.easeTo({
      center: result.center,
      zoom: Math.max(map.getZoom(), searchZoomForLevel(result.level)),
      duration: 720,
      essential: true,
    })
    return
  }
  if (result.bbox) {
    map.fitBounds(
      [
        [result.bbox[0], result.bbox[1]],
        [result.bbox[2], result.bbox[3]],
      ] as LngLatBoundsLike,
      {
        padding: {
          top: 90,
          right: window.innerWidth >= 900 ? 500 : 44,
          bottom: window.innerWidth >= 760 ? 80 : 170,
          left: window.innerWidth >= 900 ? 320 : 44,
        },
        duration: 720,
        maxZoom: searchZoomForLevel(result.level),
      },
    )
  }
}

function searchZoomForLevel(level: MapRegionStat['level']) {
  if (level === 'city') return 7.4
  if (level === 'admin1') return 5.3
  return 3.2
}

function valueRank(value?: number | null) {
  const min = stats.value?.legend.min
  const max = stats.value?.legend.max
  if (!value || !min || !max || max <= min) return 0.5
  const logMin = Math.log10(min + 1)
  const logMax = Math.log10(max + 1)
  return Math.max(0, Math.min(1, (Math.log10(value + 1) - logMin) / (logMax - logMin)))
}

function featureGeoKey(feature: GeoJsonFeature, level: MapRegionStat['level']) {
  const props = feature.properties
  if (level === 'country') return String(props.country_key ?? '')
  return `${String(props.country_key ?? '')}|${String(props.region_key ?? '')}`
}

function boundaryLevel(name: BoundaryName): MapRegionStat['level'] {
  if (name === 'countries') return 'country'
  if (name === 'chinaCities') return 'city'
  return 'admin1'
}

function boundarySourceId(name: BoundaryName) {
  if (name === 'countries') return 'country-boundaries'
  if (name === 'admin1') return 'admin1-boundaries'
  if (name === 'chinaProvinces') return 'china-province-boundaries'
  return 'china-city-boundaries'
}

function labelSourceId(name: BoundaryName) {
  if (name === 'countries') return 'country-label-points'
  if (name === 'admin1') return 'admin1-label-points'
  if (name === 'chinaProvinces') return 'china-province-label-points'
  return 'china-city-label-points'
}

function scheduleStatsFetch(delay = 300) {
  if (fetchTimer) window.clearTimeout(fetchTimer)
  fetchTimer = window.setTimeout(fetchStats, delay)
}

async function fetchStats() {
  if (!selection.category) return
  statsController?.abort()
  statsController = new AbortController()
  isLoadingStats.value = true
  filterError.value = ''
  try {
    stats.value = await fetchMapStats({ ...selection }, ['country', 'admin1', 'city'], statsController.signal)
    ensureFallbackBoundaries()
    updateMapData()
    focusGlobeOnDensePoints()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    filterError.value = error instanceof Error ? error.message : '地图统计加载失败'
  } finally {
    isLoadingStats.value = false
  }
}

function focusGlobeOnDensePoints() {
  if (!map || mapMode.value !== 'globe') return
  const center = currentDensePointCenter()
  if (!center) return
  const safeZoom = getGlobeSafeZoom()
  map.stop()
  map.easeTo({
    center,
    zoom: Math.max(map.getZoom(), safeZoom),
    bearing: 0,
    pitch: 0,
    duration: 900,
    essential: true,
  })
}

function currentDensePointCenter() {
  const points = displayPointRows().flatMap((row) => {
    const coordinates = representativeCoordinates(row)
    if (!coordinates) return []
    return [
      {
        coordinates,
        weight: Math.max(row.recordCount ?? 0, row.pointCount ?? 0, 1),
      },
    ]
  })
  return densePointCenter(points)
}

function densePointCenter(points: Array<{ coordinates: [number, number]; weight: number }>) {
  if (!points.length) return null
  const anchor = points
    .map((candidate) => ({
      candidate,
      score: points.reduce((score, point) => {
        const lngDelta = wrappedLngDelta(candidate.coordinates[0], point.coordinates[0])
        const latDelta = Math.abs(candidate.coordinates[1] - point.coordinates[1])
        const distance = Math.hypot(lngDelta, latDelta)
        return score + (distance <= DENSE_POINT_RADIUS_DEGREES ? point.weight : 0)
      }, 0),
    }))
    .sort((a, b) => b.score - a.score)[0]?.candidate
  if (!anchor) return points[0]?.coordinates ?? null
  const neighborhood = points.filter((point) => {
    const lngDelta = wrappedLngDelta(anchor.coordinates[0], point.coordinates[0])
    const latDelta = Math.abs(anchor.coordinates[1] - point.coordinates[1])
    return Math.hypot(lngDelta, latDelta) <= DENSE_POINT_RADIUS_DEGREES
  })
  return weightedGeoCenter(neighborhood.length ? neighborhood : [anchor])
}

function weightedGeoCenter(points: Array<{ coordinates: [number, number]; weight: number }>) {
  let sinSum = 0
  let cosSum = 0
  let latSum = 0
  let weightSum = 0
  points.forEach((point) => {
    const weight = Math.max(point.weight, 1)
    const lngRadians = (point.coordinates[0] * Math.PI) / 180
    sinSum += Math.sin(lngRadians) * weight
    cosSum += Math.cos(lngRadians) * weight
    latSum += point.coordinates[1] * weight
    weightSum += weight
  })
  if (!weightSum) return null
  const lng = (Math.atan2(sinSum / weightSum, cosSum / weightSum) * 180) / Math.PI
  return [normalizeLng(lng), latSum / weightSum] as [number, number]
}

function wrappedLngDelta(a: number, b: number) {
  const delta = Math.abs(a - b) % 360
  return delta > 180 ? 360 - delta : delta
}

function normalizeLng(lng: number) {
  return ((((lng + 180) % 360) + 360) % 360) - 180
}

function ensureFallbackBoundaries() {
  if (basemapMode !== 'geojson') return
  const rows = displayPointRows()
  if (rows.some((row) => row.level === 'country')) void ensureBoundary('countries')
  if (rows.some((row) => row.level === 'admin1')) void ensureBoundary('admin1')
  if (rows.some((row) => row.level === 'admin1' && row.geoKey.startsWith('china|'))) {
    void ensureBoundary('chinaProvinces')
  }
}

function handlePointClick(event: MapLayerMouseEvent) {
  closeSearch()
  const feature = event.features?.[0]
  if (!feature?.properties) return
  if (isClusterFeature(feature.properties)) {
    void focusCluster(feature)
    return
  }
  focusFeature(feature, event)
  scheduleDetailOpen(feature)
}

function handleRegionClick(event: MapLayerMouseEvent) {
  closeSearch()
  const feature = event.features?.[0]
  if (!feature?.properties || !map || !hoverPopup) return
  if (regionTooltipTimer) window.clearTimeout(regionTooltipTimer)
  hoverPopup.setLngLat(event.lngLat).setHTML(buildTooltipHtml(feature.properties)).addTo(map)
  regionTooltipTimer = window.setTimeout(() => {
    hoverPopup?.remove()
    regionTooltipTimer = undefined
  }, 1800)
}

function scheduleDetailOpen(feature: GeoJsonFeature) {
  if (clickTimer) window.clearTimeout(clickTimer)
  clickTimer = window.setTimeout(() => {
    void openFeatureDetail(feature)
  }, 260)
}

async function openFeatureDetail(feature: GeoJsonFeature) {
  const props = feature.properties as Record<string, string>
  const level = props.level ?? props.boundaryLevel
  const geoKey = props.geoKey
  if (!level || !geoKey || props.pndlGeomean == null) return
  hideTooltip()
  detailController?.abort()
  detailController = new AbortController()
  selectedDetail.value = null
  isLoadingDetail.value = true
  isDetailOpen.value = true
  detailError.value = ''
  try {
    selectedDetail.value = await fetchMapDetail(level, geoKey, { ...selection }, detailController.signal)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    detailError.value = error instanceof Error ? error.message : '详情加载失败'
  } finally {
    isLoadingDetail.value = false
  }
}

function handleFeatureDoubleClick(event: MapLayerMouseEvent) {
  event.preventDefault()
  if (clickTimer) window.clearTimeout(clickTimer)
  const feature = event.features?.[0]
  if (!feature?.properties) return
  if (isClusterFeature(feature.properties)) {
    void focusCluster(feature)
    return
  }
  focusFeature(feature, event)
}

async function focusCluster(feature: GeoJsonFeature) {
  if (!map) return
  const clusterId = Number(feature.properties.cluster_id)
  const center = pointCoordinates(feature)
  if (!center || Number.isNaN(clusterId)) return
  map.stop()
  const source = map.getSource('map-points') as ClusterGeoJSONSource | undefined
  const expansionZoom = (await source?.getClusterExpansionZoom?.(clusterId)) ?? map.getZoom() + 1.5
  map.easeTo({
    center,
    zoom: Math.min(expansionZoom + 0.25, 10),
    duration: 650,
    essential: true,
  })
}

function focusFeature(feature: GeoJsonFeature, event: MapLayerMouseEvent) {
  if (!map) return
  map.stop()
  const center = pointCoordinates(feature)
  if (center) {
    const level = String(feature.properties.level ?? 'city')
    const targetZoom = level === 'city' ? 7.2 : level === 'admin1' ? 5.1 : 3.15
    const currentZoom = map.getZoom()
    const nextZoom = currentZoom < targetZoom ? targetZoom : currentZoom
    map.easeTo({
      center,
      zoom: nextZoom,
      duration: nextZoom > currentZoom + 0.05 ? 720 : 520,
      essential: true,
    })
    return
  }
  const bbox = featureBbox(feature.geometry)
  if (bbox) {
    map.fitBounds(
      [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[3]],
      ] as LngLatBoundsLike,
      {
        padding: {
          top: 120,
          right: window.innerWidth >= 900 ? 360 : 44,
          bottom: window.innerWidth >= 760 ? 90 : 180,
          left: 44,
        },
        duration: 720,
        maxZoom: 7.5,
      },
    )
    return
  }
  map.easeTo({
    center: event.lngLat,
    zoom: Math.max(map.getZoom(), 4),
    duration: 650,
    essential: true,
  })
}

function hideTooltipOnEmptyClick(event: MapMouseEvent) {
  closeSearch()
  isLayerPanelOpen.value = false
  const layers = ALL_INTERACTIVE_LAYERS.filter((layerId) => map?.getLayer(layerId))
  const features = layers.length ? map?.queryRenderedFeatures(event.point, { layers }) : []
  if (!features?.length) hideTooltip()
}

function showTooltip(event: MapLayerMouseEvent) {
  if (!map || !hoverPopup) return
  map.getCanvas().style.cursor = 'pointer'
  const props = event.features?.[0]?.properties as Record<string, unknown> | undefined
  if (!props) return
  hoverPopup.setLngLat(event.lngLat).setHTML(buildTooltipHtml(props)).addTo(map)
}

function hideTooltip() {
  if (map) map.getCanvas().style.cursor = ''
  if (regionTooltipTimer) {
    window.clearTimeout(regionTooltipTimer)
    regionTooltipTimer = undefined
  }
  hoverPopup?.remove()
}

function buildTooltipHtml(props: Record<string, unknown>) {
  if (isClusterFeature(props)) {
    return `<strong>PNDL 位置聚合</strong><br>合并位置：${formatNumber(Number(props.point_count ?? 0))}<br>双击放大查看`
  }
  const title = escapeHtml(String(props.displayName ?? '未命名区域'))
  if (props.pndlGeomean == null) {
    return `<strong>${title}</strong><br>当前筛选无 PNDL 数据`
  }
  return `<strong>${title}</strong><br>${escapeHtml(String(props.locationPrecision ?? '位置'))}<br>biomarker：${escapeHtml(String(props.biomarkerLabel ?? selectedBiomarkerLabel.value))}<br>PNDL几何均值：${formatCompact(Number(props.pndlGeomean))}<br>记录数：${formatNumber(Number(props.recordCount ?? 0))}<br>文献数：${formatNumber(Number(props.doiCount ?? 0))}`
}

function closeDetail() {
  detailController?.abort()
  detailController = null
  isLoadingDetail.value = false
  isDetailOpen.value = false
}

function handleMapKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !isDetailOpen.value) return
  closeDetail()
}

function toggleFilters() {
  isFilterOpen.value = !isFilterOpen.value
}

function toggleLayerPanel() {
  isLayerPanelOpen.value = !isLayerPanelOpen.value
  closeSearch()
}

function resetMapView() {
  if (!map) return
  closeSearch()
  isLayerPanelOpen.value = false
  map.stop()
  const targetZoom =
    mapMode.value === 'globe'
      ? Math.max(GLOBE_INITIAL_ZOOM, getGlobeSafeZoom())
      : CHINA_VIEW_ZOOM
  map.easeTo({
    center: CHINA_CENTER as LngLatLike,
    zoom: targetZoom,
    bearing: 0,
    pitch: 0,
    duration: 760,
    essential: true,
  })
}

function updateMapStatus() {
  if (mapStatusFrame != null) {
    window.cancelAnimationFrame(mapStatusFrame)
    mapStatusFrame = undefined
  }
  if (countryStatusTimer != null) {
    window.clearTimeout(countryStatusTimer)
    countryStatusTimer = undefined
  }
  updateMapCountry(false)
}

function scheduleLiveMapStatusUpdate() {
  if (mapStatusFrame != null) return
  mapStatusFrame = window.requestAnimationFrame(() => {
    mapStatusFrame = undefined
    updateMapCoordinates(cursorCoordinatePoint())
    scheduleCountryStatusUpdate()
  })
}

function handleMapMouseMove(event: MapMouseEvent) {
  pendingCursorPoint = [event.lngLat.lng, event.lngLat.lat]
  pendingCursorPixel = [event.point.x, event.point.y]
  scheduleLiveMapStatusUpdate()
}

function handleMapContainerMouseMove(event: MouseEvent) {
  if (!map || !mapContainer.value) return
  const rect = mapContainer.value.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return
  pendingCursorPixel = [x, y]
  const lngLat = map.unproject(pendingCursorPixel)
  pendingCursorPoint = [lngLat.lng, lngLat.lat]
  scheduleLiveMapStatusUpdate()
}

function handleMapMouseLeave() {
  pendingCursorPoint = null
  pendingCursorPixel = null
  updateMapStatus()
}

function scheduleCountryStatusUpdate() {
  if (countryStatusTimer != null) return
  countryStatusTimer = window.setTimeout(() => {
    countryStatusTimer = undefined
    updateMapCountry(true)
  }, COUNTRY_STATUS_UPDATE_DELAY)
}

function updateMapCoordinates(point?: [number, number] | null) {
  if (!map) return
  const center = map.getCenter()
  const [longitude, latitude] = point ?? [center.lng, center.lat]
  mapStatus.value = {
    latitude,
    longitude,
    country: mapStatus.value.country,
    mode: point ? 'cursor' : 'center',
  }
}

function updateMapCountry(preserveOnMiss: boolean) {
  if (!map) return
  const center = map.getCenter()
  const point = cursorCoordinatePoint() ?? ([center.lng, center.lat] as [number, number])
  const country = countryAtPoint(point)
  mapStatus.value = {
    latitude: point[1],
    longitude: point[0],
    country: country ?? (preserveOnMiss ? mapStatus.value.country : '未识别'),
    mode: pendingCursorPoint ? 'cursor' : 'center',
  }
}

function cursorCoordinatePoint() {
  if (!map) return pendingCursorPoint
  if (pendingCursorPixel) {
    const lngLat = map.unproject(pendingCursorPixel)
    return [lngLat.lng, lngLat.lat] as [number, number]
  }
  return pendingCursorPoint
}

function countryAtPoint(point: [number, number]) {
  const countries = boundaryCache.get('countries')
  if (!countries) return null
  const feature = countries.features.find((item) => {
    const bbox = geometryBbox(item.geometry)
    return bbox && pointWithinBbox(point, bbox) && pointInGeometry(point, item.geometry)
  })
  if (!feature) return null
  const name = String(feature.properties.display_name ?? feature.properties.name ?? '').trim()
  return name || null
}

function pointWithinBbox(
  [lng, lat]: [number, number],
  [minLng, minLat, maxLng, maxLat]: [number, number, number, number],
) {
  return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat
}

function pointInGeometry(point: [number, number], geometry: unknown) {
  const typedGeometry = geometry as { type?: string; coordinates?: unknown }
  if (typedGeometry.type === 'Polygon' && Array.isArray(typedGeometry.coordinates)) {
    return pointInPolygon(point, typedGeometry.coordinates)
  }
  if (typedGeometry.type === 'MultiPolygon' && Array.isArray(typedGeometry.coordinates)) {
    return typedGeometry.coordinates.some(
      (polygon) => Array.isArray(polygon) && pointInPolygon(point, polygon),
    )
  }
  return false
}

function setMapMode(mode: MapMode) {
  if (!map) return
  if (mode === 'globe' && !globeAvailable.value) return
  map.stop()
  isLayerPanelOpen.value = false
  mapMode.value = mode
  const projection = { type: mode === 'globe' ? 'globe' : 'mercator' }
  ;(map as unknown as { setProjection?: (projection: { type: string }) => void })?.setProjection?.(
    projection,
  )
  const safeMinZoom = mode === 'globe' ? getGlobeSafeZoom() : FLAT_MIN_ZOOM
  map.setMinZoom(safeMinZoom)
  if (map.getLayer('background')) {
    map.setPaintProperty('background', 'background-color', mode === 'globe' ? '#83a4b8' : '#e7edf1')
  }
  syncAtmosphereStyle()
  const nextZoom =
    mode === 'globe'
      ? Math.max(map.getZoom(), safeMinZoom, GLOBE_INITIAL_ZOOM)
      : Math.max(map.getZoom(), safeMinZoom)
  map.easeTo({
    center: map.getCenter(),
    zoom: nextZoom,
    bearing: 0,
    pitch: 0,
    duration: 680,
    essential: true,
  })
}

function getGlobeSafeZoom() {
  const height = mapContainer.value?.clientHeight ?? window.innerHeight
  if (height < 520) return 2.56
  if (height < 680) return 2.48
  return GLOBE_MIN_ZOOM
}

function enforceGlobeSafeZoom(animate = true) {
  if (!map || mapMode.value !== 'globe') return
  const safeZoom = getGlobeSafeZoom()
  map.setMinZoom(safeZoom)
  if (map.getZoom() + 0.01 >= safeZoom) return
  const camera = {
    center: map.getCenter(),
    zoom: safeZoom,
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  }
  if (animate) {
    map.easeTo({ ...camera, duration: 280, essential: true })
  } else {
    map.jumpTo(camera)
  }
}

function handleMapResize() {
  if (resizeTimer) window.clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(() => {
    map?.resize()
    enforceGlobeSafeZoom()
  }, 120)
}

function applyViewLayerVisibility() {
  if (!map) return
  setLayerVisibility([...PNDL_LAYER_IDS], viewLayers.pndl)
  setLayerVisibility(layerIdsForViewGroup('labels'), viewLayers.labels)
  setLayerVisibility(layerIdsForViewGroup('boundaries'), viewLayers.boundaries)
  syncAtmosphereStyle()
}

function layerIdsForViewGroup(group: 'labels' | 'boundaries') {
  const fallbackIds = group === 'labels' ? [...LABEL_LAYER_IDS] : [...BOUNDARY_LAYER_IDS]
  if (basemapMode === 'geojson') return fallbackIds
  const layers = map?.getStyle().layers ?? []
  return layers.flatMap((layer) => {
    if (!isStyleLayer(layer)) return []
    const id = String(layer.id)
    if (PNDL_LAYER_IDS.includes(id as (typeof PNDL_LAYER_IDS)[number])) return []
    const type = String((layer as { type?: string }).type ?? '')
    if (group === 'labels') return type === 'symbol' ? [id] : []
    return type === 'line' && /admin|boundary|border|country|province|state/i.test(id) ? [id] : []
  })
}

function setLayerVisibility(layerIds: string[], visible: boolean) {
  layerIds.forEach((layerId) => {
    if (!map?.getLayer(layerId)) return
    map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none')
  })
}

function syncAtmosphereStyle() {
  if (!map) return
  const mapWithSky = map as unknown as { setSky?: (sky?: Record<string, unknown>) => void }
  if (mapMode.value === 'globe' && viewLayers.ambience) {
    mapWithSky.setSky?.(globeAtmosphereStyle().sky)
  } else {
    mapWithSky.setSky?.(undefined)
  }
}

function refreshStats() {
  scheduleStatsFetch(0)
}

function isClusterFeature(props: Record<string, unknown>) {
  return Boolean(props.cluster || props.point_count)
}

function pointCoordinates(feature: GeoJsonFeature): [number, number] | null {
  const geometry = feature.geometry as { type?: string; coordinates?: unknown }
  if (geometry?.type !== 'Point' || !Array.isArray(geometry.coordinates)) return null
  const [lng, lat] = geometry.coordinates
  if (typeof lng !== 'number' || typeof lat !== 'number') return null
  return [lng, lat]
}

function featureBbox(geometry: unknown): [number, number, number, number] | null {
  const points = primaryGeometryPoints(geometry)
  if (!points.length) return null
  return points.reduce<[number, number, number, number]>(
    (bbox, [lng, lat]) => [
      Math.min(bbox[0], lng),
      Math.min(bbox[1], lat),
      Math.max(bbox[2], lng),
      Math.max(bbox[3], lat),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  )
}

function geometryBbox(geometry: unknown): [number, number, number, number] | null {
  const points: [number, number][] = []
  const typedGeometry = geometry as { coordinates?: unknown }
  collectCoordinates(typedGeometry?.coordinates, points)
  if (!points.length) return null
  return bboxFromPoints(points)
}

function labelPointForGeometry(geometry: unknown): [number, number] | null {
  const rings = primaryPolygonRings(geometry)
  if (!rings) {
    const bbox = featureBbox(geometry)
    return bbox ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] : null
  }
  const exterior = coordinateRing(rings[0])
  if (exterior.length < 3) return null
  const bbox = bboxFromPoints(exterior)
  const candidates = [
    polygonCentroid(exterior),
    [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] as [number, number],
    bestInteriorGridPoint(rings, bbox),
  ].filter(Boolean) as [number, number][]
  return candidates.find((point) => pointInPolygon(point, rings)) ?? candidates[0] ?? null
}

function primaryPolygonRings(geometry: unknown): unknown[] | null {
  const typedGeometry = geometry as { type?: string; coordinates?: unknown }
  if (typedGeometry.type === 'Polygon' && Array.isArray(typedGeometry.coordinates)) {
    return typedGeometry.coordinates
  }
  if (typedGeometry.type === 'MultiPolygon' && Array.isArray(typedGeometry.coordinates)) {
    return (
      typedGeometry.coordinates
        .filter((polygon) => Array.isArray(polygon))
        .sort((a, b) => polygonArea(b) - polygonArea(a))[0] ?? null
    )
  }
  return null
}

function coordinateRing(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (
      Array.isArray(item) &&
      item.length >= 2 &&
      typeof item[0] === 'number' &&
      typeof item[1] === 'number'
    ) {
      return [[item[0], item[1]] as [number, number]]
    }
    return []
  })
}

function bboxFromPoints(points: [number, number][]): [number, number, number, number] {
  return points.reduce<[number, number, number, number]>(
    (bbox, [lng, lat]) => [
      Math.min(bbox[0], lng),
      Math.min(bbox[1], lat),
      Math.max(bbox[2], lng),
      Math.max(bbox[3], lat),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  )
}

function polygonCentroid(points: [number, number][]): [number, number] | null {
  let area = 0
  let lngSum = 0
  let latSum = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    if (!current || !next) continue
    const cross = current[0] * next[1] - next[0] * current[1]
    area += cross
    lngSum += (current[0] + next[0]) * cross
    latSum += (current[1] + next[1]) * cross
  }
  if (Math.abs(area) < 0.000001) {
    const bbox = bboxFromPoints(points)
    return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
  }
  return [lngSum / (3 * area), latSum / (3 * area)]
}

function bestInteriorGridPoint(rings: unknown[], bbox: [number, number, number, number]) {
  const center: [number, number] = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
  let bestPoint: [number, number] | null = null
  let bestDistance = Infinity
  const steps = 6
  for (let x = 1; x < steps; x += 1) {
    for (let y = 1; y < steps; y += 1) {
      const point: [number, number] = [
        bbox[0] + ((bbox[2] - bbox[0]) * x) / steps,
        bbox[1] + ((bbox[3] - bbox[1]) * y) / steps,
      ]
      if (!pointInPolygon(point, rings)) continue
      const distance = Math.hypot(point[0] - center[0], point[1] - center[1])
      if (distance < bestDistance) {
        bestDistance = distance
        bestPoint = point
      }
    }
  }
  return bestPoint
}

function pointInPolygon(point: [number, number], rings: unknown[]) {
  const exterior = coordinateRing(rings[0])
  if (!pointInRing(point, exterior)) return false
  return rings.slice(1).every((ring) => !pointInRing(point, coordinateRing(ring)))
}

function pointInRing([lng, lat]: [number, number], ring: [number, number][]) {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index]
    const previousPoint = ring[previous]
    if (!currentPoint || !previousPoint) continue
    const intersects =
      currentPoint[1] > lat !== previousPoint[1] > lat &&
      lng <
        ((previousPoint[0] - currentPoint[0]) * (lat - currentPoint[1])) /
          (previousPoint[1] - currentPoint[1]) +
          currentPoint[0]
    if (intersects) inside = !inside
  }
  return inside
}

function primaryGeometryPoints(geometry: unknown) {
  const typedGeometry = geometry as { type?: string; coordinates?: unknown }
  if (typedGeometry.type === 'MultiPolygon' && Array.isArray(typedGeometry.coordinates)) {
    const polygons = typedGeometry.coordinates
      .map((polygon) => {
        const points: [number, number][] = []
        collectCoordinates(polygon, points)
        return { points, area: polygonArea(polygon) }
      })
      .filter((polygon) => polygon.points.length)
    return polygons.sort((a, b) => b.area - a.area)[0]?.points ?? []
  }
  const points: [number, number][] = []
  collectCoordinates(typedGeometry.coordinates, points)
  return points
}

function polygonArea(polygon: unknown) {
  const ring = Array.isArray(polygon) && Array.isArray(polygon[0]) ? polygon[0] : null
  const points: [number, number][] = []
  collectCoordinates(ring, points)
  if (points.length < 3) return 0
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    if (!current || !next) continue
    area += current[0] * next[1] - next[0] * current[1]
  }
  return Math.abs(area)
}

function collectCoordinates(value: unknown, points: [number, number][]) {
  if (!Array.isArray(value)) return
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    points.push([value[0], value[1]])
    return
  }
  value.forEach((item) => collectCoordinates(item, points))
}

function numberOrNull(value?: number | null) {
  return value == null ? null : Number(value)
}

function formatNumber(value?: number | null) {
  if (value == null || Number.isNaN(Number(value))) return '0'
  return new Intl.NumberFormat('zh-CN').format(Number(value))
}

function formatCompact(value?: number | null) {
  if (value == null || Number.isNaN(Number(value))) return '无数据'
  const number = Number(value)
  if (number >= 1000) return number.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
  if (number >= 10) return number.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
  return number.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function formatCoordinate(value: number, axis: 'latitude' | 'longitude') {
  const direction =
    axis === 'latitude' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W'
  return `${Math.abs(value).toFixed(coordinatePrecision())}°${direction}`
}

function coordinatePrecision() {
  const zoom = map?.getZoom() ?? 0
  if (zoom >= 7) return 3
  if (zoom >= 4) return 2
  return 1
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
</script>

<template>
  <main class="map-page">
    <header class="site-header">
      <RouterLink class="brand" to="/" aria-label="污水信息因子数据库首页">
        <span class="brand-logo" aria-hidden="true">
          <span class="brand-drop"></span>
          <span class="brand-bars"><i></i><i></i><i></i></span>
          <span class="brand-line"><i></i><i></i></span>
        </span>
        <span>
          <strong>污水信息因子数据库</strong>
          <small>Wastewater Biomarker Evidence</small>
        </span>
      </RouterLink>

      <div class="header-center">
        <h1 class="page-title">地图可视化</h1>

        <div class="location-search" :class="{ active: isSearchFocused && searchQuery }">
          <span class="search-mark" aria-hidden="true"></span>
          <input
            v-model="searchQuery"
            type="search"
            placeholder="搜索国家、省州、城市"
            aria-label="搜索地图地点"
            @focus="openSearch"
            @input="openSearch"
            @blur="closeSearchSoon"
            @keydown.enter.prevent="applyFirstSearchResult"
          />
          <button v-if="searchQuery" type="button" aria-label="清空搜索" @mousedown.prevent @click="clearSearch">
            ×
          </button>

          <div v-if="isSearchFocused && searchQuery" class="search-results">
            <button
              v-for="result in searchResults"
              :key="result.id"
              type="button"
              @mousedown.prevent="focusSearchResult(result)"
            >
              <strong>{{ result.label }}</strong>
              <span>{{ result.meta }}</span>
            </button>
            <p v-if="!searchResults.length">未找到匹配地点</p>
          </div>
        </div>
      </div>

      <div class="header-tools">
        <RouterLink class="login-button" to="/">返回首页</RouterLink>
      </div>
    </header>

    <section
      class="map-stage"
      :class="{
        'detail-open': isDetailOpen,
        'filters-closed': !isFilterOpen,
        globe: mapMode === 'globe',
        ambience: viewLayers.ambience,
      }"
    >
      <div
        ref="mapContainer"
        class="map-canvas"
        aria-label="PNDL地图"
        @mousemove="handleMapContainerMouseMove"
        @mouseleave="handleMapMouseLeave"
      ></div>

      <div class="map-tool-stack" :class="{ globe: mapMode === 'globe' }">
        <button
          class="map-tool-button"
          type="button"
          aria-label="回到中国视图"
          title="回到中国视图"
          @click="resetMapView"
        >
          <span class="reset-icon" aria-hidden="true"></span>
          <span class="tool-label">回中</span>
        </button>

        <button
          class="map-tool-button"
          type="button"
          :disabled="!globeAvailable"
          :aria-label="mapMode === 'globe' ? '切换到平面地图' : '切换到球形地图'"
          :title="mapMode === 'globe' ? '切换到平面地图' : '切换到球形地图'"
          @click="setMapMode(mapMode === 'globe' ? 'flat' : 'globe')"
        >
          <svg
            v-if="mapMode === 'globe'"
            class="tool-icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <rect x="4" y="5" width="16" height="14" rx="3"></rect>
            <path d="M8 5v14M16 5v14M4 10h16M4 15h16"></path>
          </svg>
          <svg v-else class="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="8"></circle>
            <path d="M4 12h16M12 4a12 12 0 0 1 0 16M12 4a12 12 0 0 0 0 16"></path>
          </svg>
          <span class="tool-label">{{ mapMode === 'globe' ? '2D' : '3D' }}</span>
        </button>

        <div class="layer-control" :class="{ open: isLayerPanelOpen }">
          <button
            class="map-tool-button"
            type="button"
            :aria-expanded="isLayerPanelOpen"
            aria-label="地图图层显示"
            title="地图图层显示"
            @click="toggleLayerPanel"
          >
            <svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3 21 8 12 13 3 8 12 3Z"></path>
              <path d="M5.5 11.5 12 15l6.5-3.5"></path>
              <path d="M5.5 15.5 12 19l6.5-3.5"></path>
            </svg>
            <span class="tool-label">图层</span>
          </button>

          <div v-if="isLayerPanelOpen" class="layer-panel" @click.stop>
            <strong>显示图层</strong>
            <label>
              <input v-model="viewLayers.labels" type="checkbox" />
              <span>地区名称</span>
            </label>
            <label>
              <input v-model="viewLayers.boundaries" type="checkbox" />
              <span>边界线</span>
            </label>
            <label>
              <input v-model="viewLayers.pndl" type="checkbox" />
              <span>PNDL 气泡</span>
            </label>
            <label>
              <input v-model="viewLayers.ambience" type="checkbox" />
              <span>轻量动效</span>
            </label>
          </div>
        </div>
      </div>

      <div class="filter-shell" :class="{ collapsed: !isFilterOpen }">
        <form class="floating-filters" :aria-hidden="!isFilterOpen" @submit.prevent="refreshStats">
          <label>
            <span>类别</span>
            <select v-model="selection.category" :disabled="isLoadingFilters || !filters">
              <option v-for="category in filters?.categories ?? []" :key="category" :value="category">
                {{ category }}
              </option>
            </select>
          </label>

          <label>
            <span>子类</span>
            <select v-model="selection.subcategory" :disabled="!currentSubcategories.length">
              <option v-for="subcategory in currentSubcategories" :key="subcategory" :value="subcategory">
                {{ subcategory }}
              </option>
            </select>
          </label>

          <label>
            <span>biomarker</span>
            <select v-model="selection.biomarkerKey" :disabled="!currentBiomarkers.length">
              <option v-for="biomarker in currentBiomarkers" :key="biomarker.key" :value="biomarker.key">
                {{ biomarker.label }}
              </option>
            </select>
          </label>

          <label>
            <span>年份</span>
            <select v-model="selection.year" :disabled="!currentYears.length">
              <option v-for="year in currentYears" :key="year" :value="year">
                {{ year }}
              </option>
            </select>
          </label>

          <button type="submit" :disabled="isLoadingStats">
            {{ isLoadingStats ? '刷新中' : '刷新' }}
          </button>
        </form>
        <button
          class="filter-toggle"
          type="button"
          :aria-label="isFilterOpen ? '收起筛选条件' : '展开筛选条件'"
          @click="toggleFilters"
        >
          <span aria-hidden="true"></span>
        </button>
      </div>

      <p v-if="mapError || filterError" class="map-message error">{{ mapError || filterError }}</p>
      <p v-else-if="isLoadingFilters || isLoadingStats" class="map-message">
        {{ isLoadingFilters ? '正在加载筛选项' : '正在更新地图数据' }}
      </p>

      <div class="map-status-chip" aria-live="polite">
        <strong>{{ formattedMapStatus.label }}</strong>
        <span>纬度 {{ formattedMapStatus.latitude }}</span>
        <span>经度 {{ formattedMapStatus.longitude }}</span>
        <strong>国家：{{ formattedMapStatus.country }}</strong>
      </div>

      <aside
        class="detail-drawer"
        :class="{ open: isDetailOpen }"
        :aria-hidden="!isDetailOpen"
        aria-live="polite"
      >
        <header>
          <span>详情</span>
          <button type="button" aria-label="关闭详情" @click.stop="closeDetail">×</button>
        </header>

        <template v-if="detailRegion">
          <h2>{{ detailRegion.displayName }}</h2>
          <dl class="detail-metrics">
            <div>
              <dt>位置精度</dt>
              <dd>{{ locationPrecisionLabel(detailRegion.level) }}</dd>
            </div>
            <div>
              <dt>PNDL几何均值</dt>
              <dd>{{ formatCompact(detailRegion.pndlGeomeanMgD1000inh) }}</dd>
            </div>
            <div>
              <dt>PNDL均值</dt>
              <dd>{{ formatCompact(detailRegion.pndlMeanMgD1000inh) }}</dd>
            </div>
            <div>
              <dt>范围</dt>
              <dd>
                {{ formatCompact(detailRegion.pndlMinMgD1000inh) }} -
                {{ formatCompact(detailRegion.pndlMaxMgD1000inh) }}
              </dd>
            </div>
            <div>
              <dt>记录/文献</dt>
              <dd>{{ formatNumber(detailRegion.recordCount) }} / {{ formatNumber(detailRegion.doiCount) }}</dd>
            </div>
            <div>
              <dt>来源</dt>
              <dd>{{ detailRegion.pndlSources || '无数据' }}</dd>
            </div>
          </dl>

          <section class="source-list">
            <h3>来源记录</h3>
            <article v-for="source in selectedDetail?.sources ?? []" :key="source.measurementId">
              <strong>{{ source.biomarkerName || source.drugName }}</strong>
              <span>{{ source.country }} {{ source.province }} {{ source.city }}</span>
              <em>{{ formatCompact(source.pndlMgD1000inh) }} mg/day/1000 inh · {{ source.pndlSource }}</em>
              <small>{{ source.doi || source.sourceWorkbook || '来源待补充' }}</small>
            </article>
            <p v-if="!(selectedDetail?.sources?.length)">暂无来源记录</p>
          </section>
        </template>

        <p v-else-if="isLoadingDetail" class="drawer-message">正在加载详情</p>
        <p v-else class="drawer-message">
          {{ selection.category }} / {{ selection.subcategory }} / {{ selectedBiomarkerLabel }} /
          {{ selection.year }}
        </p>
        <p v-if="detailError" class="drawer-message error">{{ detailError }}</p>
      </aside>
    </section>
  </main>
</template>

<style scoped>
.map-page {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  color: #173247;
  background: #f6f8f9;
}

.site-header {
  min-height: 70px;
  display: grid;
  grid-template-columns: minmax(220px, auto) minmax(420px, 760px) auto;
  align-items: center;
  gap: 24px;
  padding: 9px clamp(18px, 4vw, 52px);
  border-bottom: 1px solid rgba(96, 124, 143, 0.2);
  background:
    linear-gradient(90deg, rgba(235, 248, 246, 0.96), rgba(255, 255, 255, 0.98) 42%, rgba(244, 249, 251, 0.96)),
    #ffffff;
  box-shadow: 0 8px 26px rgba(21, 52, 72, 0.07);
  backdrop-filter: blur(18px);
  z-index: 5;
  animation: mapHeaderIn 0.28s ease both;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: #132e3f;
  text-decoration: none;
}

.brand-logo {
  position: relative;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  display: block;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.76);
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(15, 101, 145, 0.94), rgba(14, 143, 119, 0.92)), #0f6591;
  box-shadow: 0 14px 30px rgba(15, 101, 145, 0.2);
}

.brand-drop {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 19px;
  height: 19px;
  border: 2px solid rgba(255, 255, 255, 0.92);
  border-radius: 60% 60% 62% 10%;
  background: rgba(255, 255, 255, 0.13);
  transform: rotate(-45deg);
}

.brand-bars {
  position: absolute;
  right: 8px;
  bottom: 9px;
  height: 18px;
  display: inline-flex;
  align-items: end;
  gap: 3px;
}

.brand-bars i {
  width: 4px;
  border-radius: 999px 999px 2px 2px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1);
}

.brand-bars i:nth-child(1) {
  height: 8px;
}

.brand-bars i:nth-child(2) {
  height: 14px;
}

.brand-bars i:nth-child(3) {
  height: 11px;
}

.brand-line {
  position: absolute;
  right: 7px;
  bottom: 26px;
  width: 20px;
  height: 10px;
  border-top: 2px solid rgba(198, 237, 232, 0.95);
  border-right: 2px solid rgba(198, 237, 232, 0.95);
  transform: skewX(-18deg) rotate(-9deg);
}

.brand-line i {
  position: absolute;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #ffffff;
}

.brand-line i:first-child {
  top: -4px;
  left: -2px;
}

.brand-line i:last-child {
  right: -4px;
  bottom: -3px;
}

.brand strong {
  display: block;
  font-size: 16px;
  line-height: 1.2;
}

.brand small {
  display: block;
  margin-top: 3px;
  color: #697d8a;
  font-size: 11px;
  letter-spacing: 0;
  text-transform: uppercase;
}

.header-center {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(260px, 1fr);
  align-items: center;
  justify-self: center;
  gap: 16px;
  width: min(760px, 100%);
}

.page-title {
  min-width: 0;
  margin: 0;
  padding-left: 14px;
  border-left: 4px solid #229384;
  color: #173247;
  font-size: 22px;
  font-weight: 900;
  line-height: 1.2;
  letter-spacing: 0;
  white-space: nowrap;
}

.location-search {
  position: relative;
  min-width: 0;
}

.location-search input {
  width: 100%;
  height: 42px;
  padding: 0 42px 0 40px;
  border: 1px solid rgba(91, 117, 132, 0.2);
  border-radius: 8px;
  color: #173247;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.76);
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  outline: 0;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.location-search input:focus {
  border-color: rgba(34, 147, 132, 0.42);
  box-shadow:
    0 0 0 3px rgba(34, 147, 132, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.76);
}

.search-mark {
  position: absolute;
  top: 12px;
  left: 14px;
  width: 13px;
  height: 13px;
  border: 2px solid #607384;
  border-radius: 50%;
  pointer-events: none;
}

.search-mark::after {
  position: absolute;
  right: -6px;
  bottom: -5px;
  width: 7px;
  height: 2px;
  content: '';
  border-radius: 999px;
  background: #607384;
  transform: rotate(45deg);
}

.location-search > button {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(91, 117, 132, 0.14);
  border-radius: 8px;
  color: #607384;
  background: #ffffff;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.search-results {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 8;
  display: grid;
  gap: 5px;
  max-height: 280px;
  overflow: auto;
  padding: 7px;
  border: 1px solid rgba(91, 117, 132, 0.18);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 20px 48px rgba(19, 46, 63, 0.18);
}

.search-results button {
  display: grid;
  gap: 2px;
  padding: 9px 10px;
  border: 0;
  border-radius: 8px;
  color: #173247;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.search-results button:hover {
  background: rgba(34, 147, 132, 0.08);
}

.search-results strong {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-results span,
.search-results p {
  margin: 0;
  color: #6a7d88;
  font-size: 11px;
  font-weight: 800;
}

.header-tools {
  display: flex;
  justify-content: flex-end;
}

.login-button {
  max-width: 220px;
  height: 42px;
  display: inline-grid;
  place-items: center;
  overflow: hidden;
  padding: 0 16px;
  border-radius: 8px;
  color: #ffffff;
  background: #173247;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 900;
}

.map-stage {
  position: relative;
  min-height: calc(100vh - 70px);
  overflow: hidden;
  background: #e7edf1;
  transition: background 0.28s ease;
}

.map-stage::before {
  position: absolute;
  inset: 0;
  z-index: 1;
  content: '';
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.28s ease;
}

.map-stage.ambience::before {
  opacity: 1;
}

.map-stage.ambience:not(.globe)::before {
  background:
    linear-gradient(115deg, transparent 0 36%, rgba(255, 255, 255, 0.18) 44%, transparent 52%),
    radial-gradient(circle at 18% 32%, rgba(255, 255, 255, 0.2), transparent 24%),
    repeating-linear-gradient(
      145deg,
      rgba(45, 102, 128, 0.06) 0 1px,
      transparent 1px 44px
    );
  background-size:
    620px 620px,
    760px 760px,
    420px 420px;
  mix-blend-mode: soft-light;
  animation: oceanDrift 28s linear infinite;
}

.map-stage.globe {
  background:
    radial-gradient(circle at 50% 50%, rgba(18, 44, 62, 0.4), transparent 37%),
    radial-gradient(circle at 50% 52%, rgba(255, 255, 255, 0.22), transparent 42%),
    linear-gradient(180deg, #55768a, #7896a7);
}

.map-stage.globe.ambience::before {
  background:
    radial-gradient(circle at 14% 18%, rgba(255, 255, 255, 0.72) 0 1px, transparent 1.6px),
    radial-gradient(circle at 78% 22%, rgba(255, 255, 255, 0.55) 0 1px, transparent 1.5px),
    radial-gradient(circle at 36% 72%, rgba(255, 255, 255, 0.5) 0 1px, transparent 1.4px),
    radial-gradient(circle at 62% 58%, rgba(255, 255, 255, 0.42) 0 1px, transparent 1.5px),
    radial-gradient(circle at 50% 46%, rgba(151, 190, 209, 0.14), transparent 40%);
  background-size:
    330px 330px,
    420px 420px,
    520px 520px,
    610px 610px,
    100% 100%;
  mix-blend-mode: screen;
  opacity: 0.38;
  animation: starDrift 60s linear infinite;
}

.map-canvas {
  position: absolute;
  inset: 0;
  z-index: 0;
  animation: mapCanvasIn 0.32s ease 0.04s both;
}

.map-tool-stack {
  position: absolute;
  top: 110px;
  right: 28px;
  z-index: 5;
  display: grid;
  gap: 8px;
  transition: right 0.24s ease;
  animation: mapOverlayIn 0.26s ease 0.14s both;
}

.detail-open .map-tool-stack {
  right: min(438px, calc(50vw + 10px));
}

.map-tool-button {
  width: 42px;
  height: 42px;
  display: grid;
  grid-template-rows: 19px auto;
  place-items: center;
  gap: 1px;
  padding: 0;
  border: 1px solid rgba(91, 117, 132, 0.12);
  border-radius: 8px;
  color: #173247;
  background: #ffffff;
  box-shadow: 0 8px 20px rgba(19, 46, 63, 0.13);
  cursor: pointer;
  transition:
    color 0.18s ease,
    background 0.18s ease,
    box-shadow 0.18s ease,
    opacity 0.18s ease;
}

.map-tool-button:hover {
  color: #0f766e;
  background: #f7fafb;
  box-shadow: 0 10px 24px rgba(19, 46, 63, 0.16);
}

.map-tool-button:disabled {
  color: #91a0aa;
  background: rgba(255, 255, 255, 0.76);
  cursor: not-allowed;
}

.reset-icon {
  position: relative;
  width: 18px;
  height: 18px;
  display: block;
}

.tool-icon {
  width: 18px;
  height: 18px;
  display: block;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.tool-label {
  color: currentColor;
  font-size: 9px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: 0;
}

.reset-icon::before,
.reset-icon::after {
  position: absolute;
  content: '';
}

.reset-icon::before {
  inset: 3px;
  border: 2px solid currentColor;
  border-radius: 50%;
}

.reset-icon::after {
  top: 7px;
  left: 7px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  box-shadow:
    0 -7px 0 -1px currentColor,
    0 7px 0 -1px currentColor,
    -7px 0 0 -1px currentColor,
    7px 0 0 -1px currentColor;
}

.layer-control {
  position: relative;
}

.layer-control.open .map-tool-button {
  color: #0f766e;
  box-shadow:
    0 0 0 2px rgba(34, 147, 132, 0.16),
    0 10px 24px rgba(19, 46, 63, 0.16);
}

.layer-panel {
  position: absolute;
  top: 0;
  right: calc(100% + 8px);
  width: 168px;
  display: grid;
  gap: 9px;
  padding: 11px;
  border: 1px solid rgba(100, 121, 133, 0.2);
  border-radius: 8px;
  color: #173247;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 18px 45px rgba(19, 46, 63, 0.18);
  backdrop-filter: blur(16px);
}

.layer-panel strong {
  font-size: 12px;
  font-weight: 900;
}

.layer-panel label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #173247;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.layer-panel input {
  width: 15px;
  height: 15px;
  accent-color: #229384;
}

.filter-shell {
  position: absolute;
  top: 18px;
  left: 18px;
  z-index: 3;
  width: 316px;
  transform: translateX(0);
  transition:
    transform 0.3s cubic-bezier(0.2, 0.78, 0.18, 1),
    opacity 0.22s ease;
  animation: mapOverlayIn 0.26s ease 0.1s both;
}

.filter-shell.collapsed {
  transform: translateX(calc(-100% - 7px));
}

.floating-filters {
  position: relative;
  display: grid;
  grid-template-columns: 1fr;
  gap: 11px;
  padding: 14px;
  border: 1px solid rgba(100, 121, 133, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 18px 45px rgba(19, 46, 63, 0.18);
  transition:
    opacity 0.22s ease,
    max-height 0.3s cubic-bezier(0.2, 0.78, 0.18, 1),
    transform 0.3s cubic-bezier(0.2, 0.78, 0.18, 1);
  backdrop-filter: blur(16px);
}

.filter-shell.collapsed .floating-filters {
  pointer-events: none;
  opacity: 0;
  transform: translateX(-10px) scale(0.985);
}

.filter-toggle {
  position: absolute;
  top: 16px;
  right: -19px;
  width: 26px;
  height: 54px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(89, 108, 120, 0.18);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 10px 28px rgba(19, 46, 63, 0.16);
  cursor: pointer;
  transition:
    background 0.18s ease,
    transform 0.18s ease;
  backdrop-filter: blur(14px);
}

.filter-toggle:hover {
  background: #f6fbfb;
  transform: translateX(1px);
}

.filter-toggle span {
  width: 10px;
  height: 10px;
  border-top: 2px solid #173247;
  border-left: 2px solid #173247;
  transform: translateX(2px) rotate(-45deg);
  transition: transform 0.22s ease;
}

.filter-shell.collapsed .filter-toggle span {
  transform: translateX(-2px) rotate(135deg);
}

.floating-filters label {
  min-width: 0;
  display: grid;
  gap: 5px;
}

.floating-filters span,
.detail-drawer header span,
.detail-metrics dt {
  color: #607384;
  font-size: 12px;
  font-weight: 900;
}

.floating-filters select {
  width: 100%;
  min-width: 0;
  height: 40px;
  border: 1px solid rgba(91, 117, 132, 0.22);
  border-radius: 8px;
  color: #173247;
  background: #ffffff;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.floating-filters button {
  align-self: end;
  height: 40px;
  border: 0;
  border-radius: 8px;
  color: #ffffff;
  background: #173247;
  font-weight: 900;
  cursor: pointer;
}

.floating-filters button:disabled {
  opacity: 0.68;
  cursor: not-allowed;
}

.map-message {
  position: absolute;
  top: 98px;
  left: 50%;
  z-index: 3;
  margin: 0;
  padding: 10px 13px;
  border-radius: 8px;
  color: #173247;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 14px 35px rgba(19, 46, 63, 0.14);
  transform: translateX(-50%);
}

.map-message.error,
.drawer-message.error {
  color: #9c2f1f;
}

.map-status-chip {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 6;
  max-width: min(420px, calc(100% - 36px));
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px 10px;
  padding: 8px 10px;
  border: 1px solid rgba(91, 117, 132, 0.16);
  border-radius: 8px;
  color: #173247;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 10px 28px rgba(19, 46, 63, 0.12);
  backdrop-filter: blur(14px);
  transition:
    right 0.24s ease,
    bottom 0.24s ease,
    opacity 0.18s ease;
}

.map-status-chip span,
.map-status-chip strong {
  font-size: 11px;
  line-height: 1.1;
  white-space: nowrap;
}

.map-status-chip span {
  color: #607384;
  font-weight: 800;
}

.map-status-chip strong {
  font-weight: 900;
}

.detail-open .map-status-chip {
  right: min(438px, calc(50vw + 10px));
}

.detail-drawer {
  position: absolute;
  top: 20px;
  right: 18px;
  bottom: auto;
  z-index: 8;
  box-sizing: border-box;
  width: min(420px, calc(50vw - 28px));
  max-height: calc(100% - 40px);
  display: grid;
  align-content: start;
  gap: 14px;
  padding: 18px;
  border: 1px solid rgba(100, 121, 133, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 24px 60px rgba(19, 46, 63, 0.2);
  overflow: auto;
  opacity: 0;
  pointer-events: none;
  transform: translateX(calc(100% + 30px)) scale(0.985);
  transform-origin: top right;
  transition:
    transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 0.22s ease;
  backdrop-filter: blur(18px);
}

.detail-drawer.open {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0) scale(1);
}

.detail-drawer header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.detail-drawer button {
  position: relative;
  z-index: 2;
  width: 34px;
  height: 34px;
  border: 1px solid rgba(91, 117, 132, 0.22);
  border-radius: 8px;
  color: #173247;
  background: #ffffff;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.detail-drawer h2,
.source-list h3 {
  margin: 0;
}

.detail-drawer h2 {
  font-size: 23px;
}

.detail-metrics {
  display: grid;
  gap: 8px;
  margin: 0;
}

.detail-metrics div {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid rgba(91, 117, 132, 0.14);
}

.detail-metrics dt,
.detail-metrics dd {
  margin: 0;
}

.detail-metrics dd {
  overflow-wrap: anywhere;
  font-weight: 900;
}

.source-list {
  display: grid;
  gap: 10px;
  max-height: 420px;
  overflow: auto;
  padding-right: 2px;
}

.source-list h3 {
  font-size: 16px;
}

.source-list article {
  display: grid;
  gap: 4px;
  padding: 12px;
  border: 1px solid rgba(91, 117, 132, 0.16);
  border-radius: 8px;
  background: #ffffff;
}

.source-list span,
.source-list em,
.source-list small,
.drawer-message {
  color: #607384;
  font-style: normal;
  overflow-wrap: anywhere;
}

.drawer-message {
  margin: 0;
  line-height: 1.6;
}

:deep(.maplibregl-ctrl-top-right) {
  top: 18px;
  right: 18px;
  transition: right 0.24s ease;
}

.detail-open :deep(.maplibregl-ctrl-top-right) {
  right: min(428px, 50vw);
}

:deep(.maplibregl-ctrl-group) {
  border-radius: 8px;
  overflow: hidden;
  background: #ffffff;
  box-shadow: 0 12px 30px rgba(19, 46, 63, 0.16);
}

:deep(.maplibregl-ctrl-group button) {
  width: 36px;
  height: 36px;
}

:deep(.maplibregl-ctrl-group button:hover) {
  background: #f7fafb;
}

:deep(.maplibregl-popup-content) {
  border-radius: 8px;
  color: #173247;
  box-shadow: 0 18px 45px rgba(19, 46, 63, 0.18);
}

@keyframes mapHeaderIn {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes mapCanvasIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@keyframes mapOverlayIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@keyframes oceanDrift {
  from {
    background-position:
      0 0,
      0 0,
      0 0;
  }

  to {
    background-position:
      620px 0,
      -260px 180px,
      420px 420px;
  }
}

@keyframes starDrift {
  from {
    background-position:
      0 0,
      0 0,
      0 0,
      0 0,
      50% 46%;
  }

  to {
    background-position:
      330px 120px,
      -420px 160px,
      260px -220px,
      -300px -180px,
      50% 46%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .site-header,
  .map-canvas,
  .filter-shell,
  .map-tool-stack {
    animation: none;
  }

  .map-stage::before {
    animation: none !important;
  }
}

@media (max-width: 1180px) {
  .site-header {
    grid-template-columns: auto 1fr;
  }

  .header-center {
    justify-self: end;
  }

  .page-title {
    font-size: 20px;
  }

  .header-tools {
    display: none;
  }
}

@media (max-width: 860px) {
  .site-header {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .header-center {
    width: 100%;
    grid-template-columns: 1fr;
    justify-self: stretch;
  }

  .page-title {
    justify-self: stretch;
  }

  .brand small {
    display: none;
  }

  .map-stage {
    min-height: calc(100vh - 106px);
  }

  .filter-shell {
    top: 12px;
    left: 12px;
    width: min(316px, calc(100% - 54px));
  }

  .floating-filters {
    grid-template-columns: 1fr;
  }

  .floating-filters button {
    grid-column: 1 / -1;
  }

  .map-tool-stack {
    top: 104px;
    right: 22px;
  }

  .filters-closed .map-tool-stack {
    top: 104px;
  }

  .map-message {
    top: 18px;
    max-width: calc(100% - 112px);
  }

  .detail-drawer {
    top: auto;
    left: 12px;
    right: 12px;
    bottom: 12px;
    width: auto;
    max-height: 46vh;
    transform: translateY(calc(100% + 32px)) scale(0.985);
    transform-origin: bottom center;
  }

  .detail-drawer.open {
    transform: translateY(0) scale(1);
  }

  .map-status-chip {
    right: 12px;
    bottom: 12px;
    max-width: min(360px, calc(100% - 24px));
    justify-content: flex-end;
  }

  .detail-open .map-status-chip {
    right: 12px;
    bottom: calc(46vh + 24px);
  }

  :deep(.maplibregl-ctrl-top-right) {
    top: 12px;
    right: 12px;
  }

  .filters-closed :deep(.maplibregl-ctrl-top-right) {
    top: 12px;
  }
}

@media (max-width: 560px) {
  .brand {
    gap: 9px;
  }

  .brand strong {
    font-size: 14px;
  }

  .brand-logo {
    width: 36px;
    height: 36px;
  }

  .page-title {
    font-size: 17px;
  }

}
</style>
