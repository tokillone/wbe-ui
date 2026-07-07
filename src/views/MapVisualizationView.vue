<script setup lang="ts">
import 'maplibre-gl/dist/maplibre-gl.css'

import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'

import {
  buildSelectionKey,
  fetchMapClusterDetail,
  fetchMapDetail,
  fetchMapFilters,
  fetchMapStats,
} from '../services/map'
import type {
  MapBiomarkerOption,
  MapClusterLocationRequest,
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
type DetailMode = 'none' | 'compact' | 'full'
type BasemapMode = 'vector' | 'geojson'
type RegionSourceMode = 'vector' | 'geojson'
type BoundaryName = 'countries' | 'admin1' | 'chinaProvinces' | 'chinaCities'
type ViewLayerKey = 'labels' | 'boundaries' | 'pndl' | 'ambience'
type Locale = 'zh' | 'en'
type GeoJsonFeature = {
  type: 'Feature'
  id?: string | number
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
  getClusterLeaves?: (clusterId: number, limit: number, offset: number) => Promise<GeoJsonFeature[]>
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
  | { mode: 'geojson'; regionSourceUrl?: string }
  | {
      mode: 'vector'
      styleSourceUrl: string
      regionSourceUrl?: string
      layers: unknown[]
      glyphs: string
      sprite: string
    }

const EMPTY_COLLECTION: FeatureCollection = { type: 'FeatureCollection', features: [] }
const BASEMAP_PM_TILES_URL =
  import.meta.env.VITE_BASEMAP_PM_TILES_URL || '/tiles/wbe-basemap.pmtiles'
const REGION_PM_TILES_URL =
  import.meta.env.VITE_REGION_PM_TILES_URL || '/tiles/wbe-regions.pmtiles'
const BASEMAP_GLYPHS_URL =
  import.meta.env.VITE_BASEMAP_GLYPHS_URL || '/tiles/fonts/{fontstack}/{range}.pbf'
const BASEMAP_SPRITE_URL = import.meta.env.VITE_BASEMAP_SPRITE_URL || '/tiles/sprites/light'
const REGION_VECTOR_SOURCE_ID = 'wbe-regions'
const REGION_VECTOR_SOURCE_LAYER = 'wbe_regions'
const BOUNDARY_URLS: Record<BoundaryName, string> = {
  countries: '/geo/world-countries.geojson',
  admin1: '/geo/world-admin1.geojson',
  chinaProvinces: '/geo/china-provinces.geojson',
  chinaCities: '/geo/china-cities.geojson',
}
const DEFAULT_SELECTION: MapFilterSelection = {
  targetClass: 'ALL',
  category: '全部目标物质类别',
  subcategory: '全部小类',
  biomarkerKey: 'ALL',
  year: '全部年份',
}
const ALL_CATEGORY_LABEL = DEFAULT_SELECTION.category
const ALL_SUBCATEGORY_LABEL = DEFAULT_SELECTION.subcategory
const ALL_BIOMARKER_KEY = DEFAULT_SELECTION.biomarkerKey
const ALL_BIOMARKER_LABEL = '全部 biomarker'
const ALL_YEAR_LABEL = DEFAULT_SELECTION.year
const REGION_INTERACTIVE_LAYERS = [
  'country-hit',
  'admin1-hit',
  'china-province-hit',
  'china-city-hit',
  'region-selected-fill',
  'region-data-fill',
] as const
const REGION_HOVER_PRIORITY_LAYERS = [
  'region-selected-fill',
  'region-data-fill',
  'region-selected-line',
  'region-data-line',
] as const
const POINT_INTERACTIVE_LAYERS = ['pndl-clusters', 'pndl-bubbles'] as const
const ALL_INTERACTIVE_LAYERS = [...REGION_INTERACTIVE_LAYERS, ...POINT_INTERACTIVE_LAYERS] as const
const FLAT_CENTER: [number, number] = [18, 24]
const FLAT_INITIAL_ZOOM = 1.75
const FLAT_MIN_ZOOM = 1.25
const VECTOR_MAX_ZOOM = 9.2
const FALLBACK_MAX_ZOOM = 7.6
const GLOBE_MIN_ZOOM = 2.64
const GLOBE_INITIAL_ZOOM = 2.66
const FLAT_BACKGROUND_COLOR = '#dcecf5'
const GLOBE_BACKGROUND_COLOR = '#385564'
const VECTOR_REGION_FADE_START_ZOOM = 4.65
const VECTOR_REGION_FADE_END_ZOOM = 5.25
const PMTILES_MAGIC = 'PMTiles'
const DENSE_POINT_RADIUS_DEGREES = 38
const COUNTRY_STATUS_UPDATE_DELAY = 280
const LABEL_LAYER_IDS = [
  'continent-label',
  'country-label',
  'admin1-label',
  'china-province-label',
  'china-city-label',
] as const
const BOUNDARY_LAYER_IDS = [
  'country-line',
  'admin1-line',
  'china-province-line',
] as const
const REGION_HIGHLIGHT_LAYER_IDS = [
  'region-data-fill',
  'region-data-line',
  'region-selected-fill',
  'region-selected-halo',
  'region-selected-line',
  'region-hover-fill',
  'region-hover-line',
] as const
const REGION_FILL_LAYER_IDS = [
  'region-data-fill',
  'region-selected-fill',
  'region-hover-fill',
] as const
const REGION_LINE_LAYER_IDS = [
  'region-data-line',
  'region-selected-halo',
  'region-selected-line',
  'region-hover-line',
] as const
const PNDL_LAYER_IDS = [
  'pndl-clusters',
  'pndl-cluster-count',
  'pndl-selected-ring',
  'pndl-bubbles',
  'pndl-point-labels',
] as const
const MAP_LOCALE_STORAGE_KEY = 'wbe.map.locale'
const BOUNDARY_NOISE_AREA_THRESHOLDS: Record<BoundaryName, number> = {
  countries: 0.08,
  admin1: 0.018,
  chinaProvinces: 0.01,
  chinaCities: 0.08,
}
const MAP_HIGHLIGHT_STYLE = {
  dataFill: '#7b6ff0',
  dataLine: '#8d8aa8',
  hoverFill: '#6478ff',
  hoverLine: '#3f50d3',
  selectedFill: '#4f46e5',
  selectedLine: '#312e81',
  selectedHalo: '#c7d2fe',
  bubble: '#7868f1',
  bubbleHover: '#6478ff',
  bubbleSelected: '#4f46e5',
  bubbleSelectedOuter: '#1e1b4b',
} as const
const CONTINENT_LABELS = [
  { key: 'asia', zh: '亚洲', en: 'Asia', coordinates: [90, 45] },
  { key: 'europe', zh: '欧洲', en: 'Europe', coordinates: [15, 54] },
  { key: 'africa', zh: '非洲', en: 'Africa', coordinates: [20, 2] },
  { key: 'north-america', zh: '北美洲', en: 'North America', coordinates: [-102, 50] },
  { key: 'south-america', zh: '南美洲', en: 'South America', coordinates: [-60, -16] },
  { key: 'oceania', zh: '大洋洲', en: 'Oceania', coordinates: [135, -25] },
  { key: 'antarctica', zh: '南极洲', en: 'Antarctica', coordinates: [20, -82] },
] as const
const UI_TEXT = {
  zh: {
    brandHome: '污水信息因子数据库首页',
    brandTitle: '污水信息因子数据库',
    brandSubtitle: '污水生物标记物证据库',
    pageTitle: '地图可视化',
    searchPlaceholder: '搜索国家、省州、城市',
    searchLabel: '搜索地图地点',
    clearSearch: '清空搜索',
    noSearchResults: '未找到匹配地点',
    backHome: '返回首页',
    resetView: '复位',
    resetTitle: '复位到当前数据总览',
    switchToFlat: '切换到平面地图',
    switchToGlobe: '切换到球形地图',
    mapLayers: '地图图层显示',
    language: '语言',
    languageMenu: '切换界面语言',
    chinese: '中文',
    english: 'English',
    layerPanelTitle: '显示图层',
    labelsLayer: '地区名称',
    boundariesLayer: '边界线',
    pndlLayer: 'PNDL 气泡',
    ambienceLayer: '背景动效',
    coverageNote: '覆盖说明：世界底图含国家和部分省州，中国含城市边界；PNDL 只显示后端数据库中可映射的位置。',
    filterTitle: '筛选条件',
    filterSummaryEmpty: '等待后端筛选项',
    targetClass: '目标类别',
    allTargetClasses: '全部目标类别',
    allCategories: '全部目标物质类别',
    category: '目标物质类别',
    subcategory: '目标物质子类',
    biomarker: 'biomarker',
    year: '年份',
    refresh: '刷新',
    refreshing: '刷新中',
    collapseFilters: '收起筛选条件',
    expandFilters: '展开筛选条件',
    loadingFilters: '正在加载筛选项',
    loadingStats: '正在更新地图数据',
    mapInitFailed: '地图初始化失败',
    filterLoadFailed: '筛选项加载失败',
    statsLoadFailed: '地图统计加载失败',
    detailLoadFailed: '详情加载失败',
    boundaryLoadFailed: '部分地图边界加载失败，已保留可用图层',
    boundaryLoading: '正在加载地图细节',
    noFilterData: '地图筛选项为空，请确认聚合表已刷新并包含可映射 PNDL 数据。',
    noStatsData: '当前筛选暂无可映射 PNDL 数据，请调整条件或检查地点匹配结果。',
    emptyBackendDetail: '后端未返回该位置的详情记录',
    cursor: '鼠标',
    center: '中心',
    latitude: '纬度',
    longitude: '经度',
    country: '国家',
    unknownCountry: '未识别',
    detail: '详情',
    closeDetail: '关闭详情',
    fullDetail: '完整详情',
    closeFullDetail: '关闭完整详情',
    fullDetailTitle: '完整详情',
    summaryOverview: '概览统计',
    pndlRanking: 'PNDL 排行',
    categoryBreakdown: '目标类别构成',
    topBiomarkers: 'Top biomarker',
    locationsInCluster: '聚合位置',
    backendBasemapFallback: '高质量底图未加载，已使用简化底图',
    locationPrecision: '位置精度',
    pndlGeomean: 'PNDL几何均值',
    pndlMean: 'PNDL均值',
    range: '范围',
    recordsAndDoi: '记录/文献',
    source: '来源',
    noData: '无数据',
    sourceRecords: '来源记录',
    noSourceRecords: '暂无来源记录',
    sourcePending: '来源待补充',
    loadingDetail: '正在加载详情',
    allBiomarkers: '全部生物标记物',
    allSubcategories: '全部小类',
    allYears: '全部年份',
    unspecifiedYear: '未标注年份',
    cityPrecision: '城市级位置',
    adminPrecision: '省州级位置',
    countryPrecision: '国家级位置',
    unnamedRegion: '未命名区域',
    clusterTitle: 'PNDL 位置聚合',
    clusterCount: '合并位置',
    clusterHint: '双击放大查看',
    noPndlForSelection: '当前筛选无 PNDL 数据',
    records: '记录数',
    literature: '文献数',
  },
  en: {
    brandHome: 'Wastewater Biomarker Evidence home',
    brandTitle: 'Wastewater Biomarker Evidence',
    brandSubtitle: 'Wastewater Biomarker Evidence',
    pageTitle: 'Map Visualization',
    searchPlaceholder: 'Search countries, states, cities',
    searchLabel: 'Search map locations',
    clearSearch: 'Clear search',
    noSearchResults: 'No matching locations',
    backHome: 'Home',
    resetView: 'Reset',
    resetTitle: 'Reset to current data overview',
    switchToFlat: 'Switch to flat map',
    switchToGlobe: 'Switch to globe map',
    mapLayers: 'Map layer display',
    language: 'Language',
    languageMenu: 'Change interface language',
    chinese: '中文',
    english: 'English',
    layerPanelTitle: 'Visible layers',
    labelsLayer: 'Place labels',
    boundariesLayer: 'Boundaries',
    pndlLayer: 'PNDL bubbles',
    ambienceLayer: 'Background motion',
    coverageNote: 'Coverage: the world basemap includes countries and selected admin-1 areas; China includes city boundaries. PNDL points only show mappable backend records.',
    filterTitle: 'Filters',
    filterSummaryEmpty: 'Waiting for backend filters',
    targetClass: '目标类别',
    allTargetClasses: 'All target groups',
    allCategories: 'All substance categories',
    category: '目标物质类别',
    subcategory: '目标物质子类',
    biomarker: 'biomarker',
    year: 'Year',
    refresh: 'Refresh',
    refreshing: 'Refreshing',
    collapseFilters: 'Collapse filters',
    expandFilters: 'Expand filters',
    loadingFilters: 'Loading filters',
    loadingStats: 'Updating map data',
    mapInitFailed: 'Map initialization failed',
    filterLoadFailed: 'Failed to load filters',
    statsLoadFailed: 'Failed to load map statistics',
    detailLoadFailed: 'Failed to load detail',
    boundaryLoadFailed: 'Some boundaries failed to load; available layers remain visible',
    boundaryLoading: 'Loading map detail',
    noFilterData: 'Map filters are empty. Please refresh map_pndl_stats and confirm it contains mappable PNDL data.',
    noStatsData: 'No mappable PNDL data for the current filters. Adjust filters or check location matching.',
    emptyBackendDetail: 'The backend returned no detail for this location',
    cursor: 'Cursor',
    center: 'Center',
    latitude: 'Lat',
    longitude: 'Lng',
    country: 'Country',
    unknownCountry: 'Unknown',
    detail: 'Detail',
    closeDetail: 'Close detail',
    fullDetail: 'Full detail',
    closeFullDetail: 'Close full detail',
    fullDetailTitle: 'Full detail',
    summaryOverview: 'Overview',
    pndlRanking: 'PNDL ranking',
    categoryBreakdown: 'Category breakdown',
    topBiomarkers: 'Top biomarker',
    locationsInCluster: 'Cluster locations',
    backendBasemapFallback: 'High-quality basemap is unavailable; simplified basemap is active',
    locationPrecision: 'Location precision',
    pndlGeomean: 'PNDL geometric mean',
    pndlMean: 'PNDL mean',
    range: 'Range',
    recordsAndDoi: 'Records / DOI',
    source: 'Source',
    noData: 'No data',
    sourceRecords: 'Source records',
    noSourceRecords: 'No source records',
    sourcePending: 'Source pending',
    loadingDetail: 'Loading detail',
    allBiomarkers: 'All biomarkers',
    allSubcategories: 'All subcategories',
    allYears: 'All years',
    unspecifiedYear: 'Unspecified year',
    cityPrecision: 'City-level location',
    adminPrecision: 'Admin-1 location',
    countryPrecision: 'Country-level location',
    unnamedRegion: 'Unnamed region',
    clusterTitle: 'PNDL location cluster',
    clusterCount: 'Merged locations',
    clusterHint: 'Double-click to zoom in',
    noPndlForSelection: 'No PNDL data for the current filters',
    records: 'Records',
    literature: 'Literature',
  },
} as const

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
const detailMode = ref<DetailMode>('none')
const isFilterOpen = ref(true)
const isLayerPanelOpen = ref(false)
const isLanguageMenuOpen = ref(false)
const isMapStyleSwitching = ref(false)
const searchQuery = ref('')
const isSearchFocused = ref(false)
const locale = ref<Locale>(readInitialLocale())
const loadingBoundaryNames = ref<BoundaryName[]>([])
const selectedRegionFeature = ref<GeoJsonFeature | null>(null)
const selectedPointKey = ref('')
const mapStatus = ref<MapStatus>({
  latitude: FLAT_CENTER[1],
  longitude: FLAT_CENTER[0],
  country: UI_TEXT.zh.unknownCountry,
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
let regionSourceMode: RegionSourceMode = 'geojson'
let activeBasemapConfig: BasemapConfig = { mode: 'geojson' }
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
let pmtilesProtocolReady = false
let hoveredPointId: string | number | null = null
let selectedPointId: string | number | null = null
let hoveredRegionFeature: GeoJsonFeature | null = null
let pointLayerEventsBound = false
let regionLayerEventsBound = false
let isBasemapFallbackInProgress = false
let projectionSwitchInProgress = false
const boundaryCache = new Map<BoundaryName, FeatureCollection>()
const cleanedBoundaryCache = new Map<BoundaryName, FeatureCollection>()

const ui = computed(() => UI_TEXT[locale.value])
const isCompactDetailOpen = computed(() => detailMode.value === 'compact')
const isFullDetailOpen = computed(() => detailMode.value === 'full')
const isDetailOpen = computed(() => detailMode.value !== 'none')
const currentTargetClasses = computed(() => filters.value?.targetClasses ?? [])
const currentCategories = computed(() => {
  if (!filters.value) return []
  if (selection.targetClass && selection.targetClass !== 'ALL') {
    return withAllCategory(filters.value.categoriesByTargetClass?.[selection.targetClass])
  }
  return withAllCategory(filters.value.categories)
})
const currentSubcategories = computed(() =>
  selection.category === ALL_CATEGORY_LABEL
    ? withFallbackOption(filters.value?.subcategoriesByCategory[selection.category], ALL_SUBCATEGORY_LABEL)
    : (filters.value?.subcategoriesByCategory[selection.category] ?? []),
)
const currentBiomarkers = computed(
  () => {
    const items =
      filters.value?.biomarkersByCategorySubcategory[
        buildSelectionKey(selection.category, selection.subcategory)
      ] ?? []
    return selection.category === ALL_CATEGORY_LABEL && selection.subcategory === ALL_SUBCATEGORY_LABEL
      ? withAllBiomarker(items)
      : items
  },
)
const currentYears = computed(
  () => {
    const years =
      filters.value?.yearsBySelection[
        buildSelectionKey(selection.category, selection.subcategory, selection.biomarkerKey)
      ] ?? []
    return selection.category === ALL_CATEGORY_LABEL && selection.subcategory === ALL_SUBCATEGORY_LABEL
      ? withFallbackOption(years, ALL_YEAR_LABEL)
      : years
  },
)
const selectedBiomarkerLabel = computed(
  () =>
    displayOptionLabel(
      currentBiomarkers.value.find((item) => item.key === selection.biomarkerKey)?.label,
    ) ?? ui.value.allBiomarkers,
)
const filterSummary = computed(() => {
  const parts = [
    displayOptionLabel(selection.targetClass),
    displayOptionLabel(selection.category),
    displayOptionLabel(selection.subcategory),
    selectedBiomarkerLabel.value,
    displayOptionLabel(selection.year),
  ].filter(Boolean)
  return parts.length ? parts.join(' / ') : ui.value.filterSummaryEmpty
})
const detailRegion = computed(() => selectedDetail.value?.region ?? null)
const detailTitle = computed(
  () => selectedDetail.value?.title || detailRegion.value?.displayName || ui.value.detail,
)
const detailSubtitle = computed(() => selectedDetail.value?.subtitle || filterSummary.value)
const detailSources = computed(
  () => selectedDetail.value?.sourceRecords ?? selectedDetail.value?.sources ?? [],
)
const hasEmptyFilterData = computed(
  () =>
    Boolean(filters.value) &&
    !isLoadingFilters.value &&
    !filterError.value &&
    (filters.value?.categories.length ?? 0) === 0,
)
const hasNoStatsData = computed(
  () =>
    Boolean(stats.value) &&
    !isLoadingStats.value &&
    !filterError.value &&
    Boolean(selection.category) &&
    (stats.value?.regions.length ?? 0) === 0 &&
    (stats.value?.points.length ?? 0) === 0,
)
const activeMapMessage = computed(() => {
  if (mapError.value || filterError.value) {
    return { type: 'error', text: mapError.value || filterError.value }
  }
  if (isLoadingFilters.value || isLoadingStats.value) {
    return {
      type: 'loading',
      text: isLoadingFilters.value ? ui.value.loadingFilters : ui.value.loadingStats,
    }
  }
  if (hasEmptyFilterData.value) {
    return { type: 'notice', text: filters.value?.diagnostics?.message || ui.value.noFilterData }
  }
  if (hasNoStatsData.value) {
    return { type: 'notice', text: stats.value?.diagnostics?.message || ui.value.noStatsData }
  }
  return null
})
const boundaryLoadingMessage = computed(() =>
  loadingBoundaryNames.value.length ? ui.value.boundaryLoading : '',
)
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
  country:
    mapStatus.value.country === UI_TEXT.zh.unknownCountry ||
    mapStatus.value.country === UI_TEXT.en.unknownCountry
      ? ui.value.unknownCountry
      : mapStatus.value.country,
  label: mapStatus.value.mode === 'cursor' ? ui.value.cursor : ui.value.center,
}))

watch(locale, (value) => {
  window.localStorage.setItem(MAP_LOCALE_STORAGE_KEY, value)
  updateContinentLabels()
  if (
    mapStatus.value.country === UI_TEXT.zh.unknownCountry ||
    mapStatus.value.country === UI_TEXT.en.unknownCountry
  ) {
    mapStatus.value = { ...mapStatus.value, country: ui.value.unknownCountry }
  }
})

watch(
  () => selection.targetClass,
  () => {
    const categories = currentCategories.value
    const nextCategory =
      categories.includes(selection.category) ? selection.category : (categories[0] ?? '')
    if (selection.category !== nextCategory) selection.category = nextCategory
  },
)
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
    clearSelectedPoint()
    setSelectedRegion(null)
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
  unbindLayerEvents()
  map?.remove()
  map = null
  removePmtilesProtocol?.()
  removePmtilesProtocol = null
  pmtilesProtocolReady = false
})

async function loadFilters() {
  isLoadingFilters.value = true
  filterError.value = ''
  const controller = new AbortController()
  try {
    const result = await fetchMapFilters(controller.signal)
    filters.value = result
    Object.assign(selection, {
      ...DEFAULT_SELECTION,
      ...(result.defaultSelection ?? {}),
      targetClass: result.defaultSelection?.targetClass ?? 'ALL',
      category: ALL_CATEGORY_LABEL,
      subcategory: ALL_SUBCATEGORY_LABEL,
      biomarkerKey: ALL_BIOMARKER_KEY,
    })
  } catch (error) {
    filterError.value = error instanceof Error ? error.message : ui.value.filterLoadFailed
  } finally {
    isLoadingFilters.value = false
  }
}

function withFallbackOption(items: string[] | undefined, option: string) {
  const values = (items ?? []).filter(Boolean)
  return values.includes(option) ? values : [option, ...values]
}

function withAllCategory(categories?: string[]) {
  return withFallbackOption(categories, ALL_CATEGORY_LABEL)
}

function withAllBiomarker(items: MapBiomarkerOption[]) {
  return items.some((item) => item.key === ALL_BIOMARKER_KEY)
    ? items
    : [
        {
          key: ALL_BIOMARKER_KEY,
          label: ALL_BIOMARKER_LABEL,
          cas: null,
        },
        ...items,
      ]
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
    regionSourceMode = basemapConfig.regionSourceUrl ? 'vector' : 'geojson'
    activeBasemapConfig = basemapConfig
    map = new maplibregl.Map({
      container: mapContainer.value,
      style: buildMapStyle(mapMode.value, basemapConfig) as never,
      center: FLAT_CENTER as LngLatLike,
      zoom: FLAT_INITIAL_ZOOM,
      minZoom: FLAT_MIN_ZOOM,
      maxZoom: currentMapMaxZoom(),
      attributionControl: false,
    })
    configureMapGestureSmoothness()
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
      void ensureBoundary('countries')
      updateMapData()
      enforceGlobeSafeZoom(false)
      updateMapStatus()
    })
    map.on('zoomend', () => {
      updateMapStatus()
      ensureStagedBoundariesForCurrentZoom()
    })
    map.on('move', scheduleLiveMapStatusUpdate)
    map.on('moveend', updateMapStatus)
    map.on('mousemove', handleMapMouseMove)
    map.on('mouseleave', handleMapMouseLeave)
    map.on('click', hideTooltipOnEmptyClick)
    updateMapCoordinates()
  } catch (error) {
    mapError.value = error instanceof Error ? error.message : ui.value.mapInitFailed
    mapMode.value = 'flat'
  }
}

function canUseGlobe(_module: MapLibreModule) {
  const canvas = document.createElement('canvas')
  return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
}

function currentMapMaxZoom() {
  return basemapMode === 'vector' ? VECTOR_MAX_ZOOM : FALLBACK_MAX_ZOOM
}

function configureMapGestureSmoothness() {
  const gestureMap = map as unknown as {
    scrollZoom?: {
      setZoomRate?: (value: number) => void
      setWheelZoomRate?: (value: number) => void
    }
    touchZoomRotate?: {
      setZoomRate?: (value: number) => void
      setZoomThreshold?: (value: number) => void
    }
  }
  gestureMap.scrollZoom?.setZoomRate?.(1 / 180)
  gestureMap.scrollZoom?.setWheelZoomRate?.(1 / 650)
  gestureMap.touchZoomRotate?.setZoomRate?.(0.72)
  gestureMap.touchZoomRotate?.setZoomThreshold?.(0.18)
}

async function resolveBasemapConfig(module: MapLibreModule): Promise<BasemapConfig> {
  const regionSourceUrl = await resolveRegionSourceUrl(module)
  const pmtilesUrl = BASEMAP_PM_TILES_URL.trim()
  if (!pmtilesUrl || !(await canLoadVectorBasemapAssets(pmtilesUrl))) {
    return { mode: 'geojson', regionSourceUrl }
  }

  try {
    await registerPmtilesProtocol(module)
    const basemaps = await import('@protomaps/basemaps')

    return {
      mode: 'vector',
      styleSourceUrl: `pmtiles://${new URL(pmtilesUrl, window.location.origin).toString()}`,
      regionSourceUrl,
      layers: basemaps.layers('protomaps', basemaps.namedFlavor('light'), { lang: 'en' }),
      glyphs: BASEMAP_GLYPHS_URL,
      sprite: BASEMAP_SPRITE_URL,
    }
  } catch {
    return { mode: 'geojson', regionSourceUrl }
  }
}

async function resolveRegionSourceUrl(module: MapLibreModule) {
  const regionTilesUrl = REGION_PM_TILES_URL.trim()
  if (!regionTilesUrl || !(await canLoadPmtilesArchive(regionTilesUrl))) return undefined
  try {
    await registerPmtilesProtocol(module)
    return `pmtiles://${new URL(regionTilesUrl, window.location.origin).toString()}`
  } catch {
    return undefined
  }
}

async function registerPmtilesProtocol(module: MapLibreModule) {
  if (pmtilesProtocolReady) return
  const { Protocol } = await import('pmtiles')
  const protocol = new Protocol()
  ;(module as unknown as { addProtocol?: (scheme: string, loader: unknown) => void }).addProtocol?.(
    'pmtiles',
    protocol.tile,
  )
  pmtilesProtocolReady = true
  removePmtilesProtocol = () => {
    ;(module as unknown as { removeProtocol?: (scheme: string) => void }).removeProtocol?.(
      'pmtiles',
    )
    pmtilesProtocolReady = false
  }
}

async function canLoadVectorBasemapAssets(pmtilesUrl: string) {
  if (!(await canLoadPmtilesArchive(pmtilesUrl))) return false
  const glyphUrls = glyphProbeUrls(BASEMAP_GLYPHS_URL)
  const spriteUrl = spriteProbeUrl(BASEMAP_SPRITE_URL)
  if (!glyphUrls.length || !spriteUrl) return false
  const [glyphsAvailable, spriteAvailable] = await Promise.all([
    canLoadAnyStaticAsset(glyphUrls),
    canLoadStaticAsset(spriteUrl),
  ])
  return glyphsAvailable && spriteAvailable
}

async function canLoadPmtilesArchive(url: string) {
  try {
    const head = await fetch(url, { method: 'HEAD', cache: 'no-store' })
    if (head.ok) {
      const contentLength = Number(head.headers.get('content-length') ?? '0')
      if (contentLength > 0 && contentLength < PMTILES_MAGIC.length) return false
    }
  } catch {
    // Some static hosts/proxies reject HEAD for large PMTiles files. The range
    // GET below is the source of truth, so do not fail early here.
  }

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

function glyphProbeUrls(template: string) {
  const trimmed = template.trim()
  if (!trimmed) return []
  const raw = trimmed.replace('{fontstack}', 'Noto Sans Regular').replace('{range}', '0-255')
  const encoded = trimmed
    .replace('{fontstack}', encodeURIComponent('Noto Sans Regular'))
    .replace('{range}', '0-255')
  return Array.from(new Set([raw, encoded]))
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
  } catch {
    // Fall through to GET for hosts that do not support HEAD reliably.
  }

  try {
    const response = await fetch(url, { cache: 'no-store' })
    await response.body?.cancel()
    return response.ok
  } catch {
    return false
  }
}

async function canLoadAnyStaticAsset(urls: string[]) {
  for (const url of urls) {
    if (await canLoadStaticAsset(url)) return true
  }
  return false
}

function handleMapRuntimeError(event: unknown) {
  const payload = event as {
    error?: { message?: string }
    sourceId?: string
    tile?: unknown
  }
  const sourceId = String(payload.sourceId ?? '')
  const message = String(payload.error?.message ?? '')
  if (sourceId === REGION_VECTOR_SOURCE_ID || /wbe[-_]regions/i.test(message)) {
    fallbackRegionSourceToGeoJson()
    return
  }
  if (basemapMode !== 'vector' || isBasemapFallbackInProgress) return
  if (/glyph|sprite|font/i.test(message)) return
  if (sourceId && sourceId !== 'protomaps') return
  if (message && /map-points|pndl/i.test(message)) return
  if (!message && !sourceId && !payload.tile) return
  fallbackToGeoJsonBasemap()
}

function fallbackRegionSourceToGeoJson() {
  if (!map || regionSourceMode !== 'vector' || isBasemapFallbackInProgress) return
  isBasemapFallbackInProgress = true
  regionSourceMode = 'geojson'
  activeBasemapConfig =
    activeBasemapConfig.mode === 'vector'
      ? { ...activeBasemapConfig, regionSourceUrl: undefined }
      : { mode: 'geojson' }
  mapReady.value = false
  map.stop()
  clearHoveredPoint()
  setHoveredRegion(null)
  unbindLayerEvents()
  map.setStyle(buildMapStyle(mapMode.value, activeBasemapConfig) as never)
  const restore = () => {
    if (!isBasemapFallbackInProgress) return
    restoreGeoJsonBasemapLayers()
  }
  map.once('idle', restore)
  window.setTimeout(restore, 700)
}

function fallbackToGeoJsonBasemap() {
  if (!map || basemapMode === 'geojson' || isBasemapFallbackInProgress) return
  isBasemapFallbackInProgress = true
  const regionSourceUrl = activeBasemapConfig.regionSourceUrl
  basemapMode = 'geojson'
  regionSourceMode = regionSourceUrl ? 'vector' : 'geojson'
  activeBasemapConfig = { mode: 'geojson', regionSourceUrl }
  mapReady.value = false
  map.stop()
  clearHoveredPoint()
  setHoveredRegion(null)
  unbindLayerEvents()
  map.setStyle(buildMapStyle(mapMode.value, activeBasemapConfig) as never)
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
  map.setMaxZoom(currentMapMaxZoom())
  if (map.getZoom() > currentMapMaxZoom()) {
    map.easeTo({ zoom: currentMapMaxZoom(), duration: 260, essential: true })
  }
  mapReady.value = true
  addMapSourcesAndLayers()
  bindLayerEvents()
  void ensureBoundary('countries')
  ensureFallbackBoundaries()
  updateMapData()
  enforceGlobeSafeZoom(false)
}

function buildMapStyle(mode: MapMode, basemapConfig: BasemapConfig) {
  if (basemapConfig.mode === 'vector') {
    const sources: Record<string, unknown> = {
      protomaps: {
        type: 'vector',
        attribution:
          '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://osm.org/copyright">OpenStreetMap</a>',
        url: basemapConfig.styleSourceUrl,
      },
    }
    if (basemapConfig.regionSourceUrl) {
      sources[REGION_VECTOR_SOURCE_ID] = {
        type: 'vector',
        attribution: 'WBE regions',
        url: basemapConfig.regionSourceUrl,
      }
    }
    return {
      version: 8,
      projection: { type: mode === 'globe' ? 'globe' : 'mercator' },
      glyphs: basemapConfig.glyphs,
      sprite: basemapConfig.sprite,
      sources,
      layers: vectorBasemapLayers(basemapConfig.layers, mode),
    }
  }

  const sources: Record<string, unknown> = {}
  if (basemapConfig.regionSourceUrl) {
    sources[REGION_VECTOR_SOURCE_ID] = {
      type: 'vector',
      attribution: 'WBE regions',
      url: basemapConfig.regionSourceUrl,
    }
  }
  return {
    version: 8,
    projection: { type: mode === 'globe' ? 'globe' : 'mercator' },
    sources,
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: {
          'background-color': mode === 'globe' ? GLOBE_BACKGROUND_COLOR : FLAT_BACKGROUND_COLOR,
        },
      },
    ],
  }
}

function vectorBasemapLayers(layers: unknown[], mode: MapMode) {
  return layers.map((layer) => {
    if (!isStyleLayer(layer)) return layer
    if (layer.id === 'background') {
      return {
        ...layer,
        paint: {
          ...(layer.paint ?? {}),
          'background-color': mode === 'globe' ? GLOBE_BACKGROUND_COLOR : FLAT_BACKGROUND_COLOR,
        },
      }
    }
    if (layer.type === 'symbol' && layer.layout?.['text-field']) {
      return {
        ...layer,
        paint: {
          ...(layer.paint ?? {}),
          'text-color': vectorTextColor(layer.id),
          'text-halo-color': 'rgba(255,255,255,0.94)',
          'text-halo-width': vectorTextHaloWidth(layer.id),
          'text-opacity': 0.98,
        },
      }
    }
    if (layer.type === 'fill' || layer.type === 'line') {
      return styleVectorBasemapLayer(layer)
    }
    return layer
  })
}

function styleVectorBasemapLayer(layer: {
  id: string
  type?: string
  layout?: Record<string, unknown>
  paint?: Record<string, unknown>
}) {
  const paint = { ...(layer.paint ?? {}) }
  if (layer.id === 'boundaries_country') {
    paint['line-color'] = '#9fb0ba'
    paint['line-width'] = ['interpolate', ['linear'], ['zoom'], 0, 0.32, 5, 0.42, 8, 0.5]
    paint['line-opacity'] = ['interpolate', ['linear'], ['zoom'], 0, 0.18, 4, 0.26, 8, 0.3]
    paint['line-blur'] = 0.16
  } else if (layer.id === 'boundaries') {
    paint['line-color'] = '#b8c6cd'
    paint['line-width'] = 0.2
    paint['line-opacity'] = 0
    paint['line-blur'] = 0.2
  } else if (layer.id === 'water') {
    paint['fill-color'] = '#cfe3eb'
  } else if (/^water_/.test(layer.id)) {
    paint['line-color'] = '#8db5c7'
    paint['line-opacity'] = 0.86
  } else if (/roads_.*casing/.test(layer.id)) {
    paint['line-color'] = '#d2dbe0'
    paint['line-opacity'] = 0.84
  } else if (/roads_(highway|major|bridges_major|bridges_highway)/.test(layer.id)) {
    paint['line-color'] = '#ffffff'
    paint['line-opacity'] = 0.96
  } else if (/roads_(minor|other|link|bridges_minor|bridges_other|bridges_link)/.test(layer.id)) {
    paint['line-color'] = '#f3f7f9'
    paint['line-opacity'] = 0.9
  } else if (layer.id === 'buildings') {
    paint['fill-color'] = '#d7dde1'
    paint['fill-opacity'] = 0.42
  }
  return { ...layer, paint }
}

function vectorTextColor(layerId: string) {
  if (/place|locality|city|town|village/i.test(layerId)) return '#303946'
  if (/road|street|highway|shield/i.test(layerId)) return '#535d68'
  if (/water|ocean|marine/i.test(layerId)) return '#536f7d'
  return '#46525f'
}

function vectorTextHaloWidth(layerId: string) {
  if (/place|locality|city|town|village/i.test(layerId)) return 1.8
  if (/road|street|highway|shield/i.test(layerId)) return 1.45
  return 1.55
}

function isStyleLayer(layer: unknown): layer is {
  id: string
  type?: string
  layout?: Record<string, unknown>
  paint?: Record<string, unknown>
} {
  return typeof layer === 'object' && layer !== null && 'id' in layer
}

function mapLabelLayerBeforeId() {
  const layers = map?.getStyle().layers ?? []
  return layers.find((layer) => layer.type === 'symbol')?.id
}

function addRegionLayer(layer: unknown) {
  addMapLayer(layer, basemapMode === 'vector' ? regionLayerBeforeId(layer) : undefined)
}

function regionLayerBeforeId(layer: unknown) {
  const id = String((layer as { id?: string }).id ?? '')
  const layers = map?.getStyle().layers ?? []
  if (/-fill$/.test(id)) {
    return (
      layers.find((item) => /^roads_|^pois|^places|^transit|^transport/i.test(item.id))?.id ??
      mapLabelLayerBeforeId()
    )
  }
  return mapLabelLayerBeforeId()
}

function addPndlLabelLayer() {
  addMapLayer({
    id: 'pndl-point-labels',
    type: 'symbol',
    source: 'map-point-labels',
    minzoom: 5.35,
    layout: {
      'text-field': ['get', 'displayName'],
      'text-font': ['Noto Sans Medium'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 5.35, 11, 8.6, 13.5],
      'text-offset': [0, 1.35],
      'text-anchor': 'top',
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-padding': 8,
      'text-optional': false,
    },
    paint: {
      'text-color': '#273444',
      'text-halo-color': 'rgba(255,255,255,0.96)',
      'text-halo-width': 1.8,
      'text-opacity': ['interpolate', ['linear'], ['zoom'], 5.35, 0, 5.75, 0.96],
    },
  })
}

function addMapSourcesAndLayers() {
  if (!map) return
  addGeoSource('country-boundaries')
  addGeoSource('admin1-boundaries')
  addGeoSource('china-province-boundaries')
  addGeoSource('china-city-boundaries')
  if (regionSourceMode === 'geojson') {
    addGeoSource('region-data')
    addGeoSource('region-hover')
    addGeoSource('region-selected')
  }

  if (basemapMode === 'geojson') {
    addGeoSource('continent-label-points')
    addGeoSource('country-label-points')
    addGeoSource('admin1-label-points')
    addGeoSource('china-province-label-points')
    addGeoSource('china-city-label-points')
  }
  addPointSource()
  addPointLabelSource()

  if (basemapMode === 'geojson') {
    addBaseFillLayer('country-land', 'country-boundaries')
    addBaseFillLayer('admin1-land', 'admin1-boundaries', 3.2, 0)
    addBaseFillLayer('china-province-land', 'china-province-boundaries', 3.2, 0)
    addBaseFillLayer('china-city-land', 'china-city-boundaries', 7.1, 0)
    addLineLayer('country-line', 'country-boundaries', '#8ea1ac', 0.58, 0, 0.62)
    addLineLayer(
      'admin1-line',
      'admin1-boundaries',
      '#9dacb5',
      0.28,
      3.4,
      0.34,
      ['!=', ['get', 'country_key'], 'china'],
    )
    addLineLayer('china-province-line', 'china-province-boundaries', '#8397a2', 0.4, 3.5, 0.46)

    addLabelLayer('continent-label', 'continent-label-points', 0, 2.28, 16)
    addLabelLayer('country-label', 'country-label-points', 2.18, 4.15, 12)
    addLabelLayer('admin1-label', 'admin1-label-points', 4.0, 6.45, 10, false)
    addLabelLayer('china-province-label', 'china-province-label-points', 4.0, 6.45, 10)
    addLabelLayer('china-city-label', 'china-city-label-points', 6.2, undefined, 10)
    updateContinentLabels()
  }
  addRegionHitLayers()
  addRegionDataLayers()
  addRegionHighlightLayers()

  addMapLayer({
    id: 'pndl-clusters',
    type: 'circle',
    source: 'map-points',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        MAP_HIGHLIGHT_STYLE.bubbleHover,
        [
          'step',
          ['get', 'point_count'],
          '#6c5ce7',
          5,
          '#4f46c8',
          12,
          '#332a91',
        ],
      ],
      'circle-radius': [
        '+',
        ['step', ['get', 'point_count'], 15, 5, 21, 12, 29],
        ['case', ['boolean', ['feature-state', 'hover'], false], 3, 0],
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3, 2],
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
    id: 'pndl-selected-ring',
    type: 'circle',
    source: 'map-points',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': [
        '+',
        ['interpolate', ['linear'], ['get', 'pndlRank'], 0, 7, 1, 22],
        ['case', ['boolean', ['feature-state', 'selected'], false], 2.5, 0],
      ],
      'circle-color': 'rgba(255,255,255,0)',
      'circle-stroke-color': MAP_HIGHLIGHT_STYLE.bubbleSelectedOuter,
      'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.2, 0],
      'circle-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.92, 0],
    },
  })
  addMapLayer({
    id: 'pndl-bubbles',
    type: 'circle',
    source: 'map-points',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': [
        '+',
        ['interpolate', ['linear'], ['get', 'pndlRank'], 0, 5, 1, 20],
        [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          3,
          ['boolean', ['feature-state', 'hover'], false],
          2,
          0,
        ],
      ],
      'circle-color': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        MAP_HIGHLIGHT_STYLE.bubbleHover,
        ['boolean', ['feature-state', 'selected'], false],
        MAP_HIGHLIGHT_STYLE.bubbleSelected,
        ['==', ['get', 'level'], 'city'],
        MAP_HIGHLIGHT_STYLE.bubble,
        '#ffffff',
      ],
      'circle-opacity': ['case', ['==', ['get', 'level'], 'city'], 0.9, 0.78],
      'circle-stroke-color': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        '#ffffff',
        ['boolean', ['feature-state', 'hover'], false],
        MAP_HIGHLIGHT_STYLE.hoverLine,
        ['==', ['get', 'level'], 'city'],
        '#4f46c8',
        MAP_HIGHLIGHT_STYLE.bubble,
      ],
      'circle-stroke-width': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        3,
        ['boolean', ['feature-state', 'hover'], false],
        2.4,
        ['==', ['get', 'level'], 'city'],
        1.4,
        2.4,
      ],
    },
  })
  addPndlLabelLayer()
  applyViewLayerVisibility()
}

function addGeoSource(id: string) {
  if (!map?.getSource(id)) {
    map?.addSource(id, { type: 'geojson', data: EMPTY_COLLECTION as never })
  }
}

function addMapLayer(layer: unknown, beforeId?: string) {
  const id = (layer as { id?: string }).id
  if (!map || !id || map.getLayer(id)) return
  map.addLayer(layer as never, beforeId && map.getLayer(beforeId) ? beforeId : undefined)
}

function addPointSource() {
  if (!map?.getSource('map-points')) {
    map?.addSource('map-points', {
      type: 'geojson',
      data: EMPTY_COLLECTION as never,
      promoteId: 'featureId',
      cluster: true,
      clusterMaxZoom: Math.min(8, currentMapMaxZoom() - 0.2),
      clusterRadius: 62,
    } as never)
  }
}

function addPointLabelSource() {
  if (!map?.getSource('map-point-labels')) {
    map?.addSource('map-point-labels', {
      type: 'geojson',
      data: EMPTY_COLLECTION as never,
    } as never)
  }
}

function addBaseFillLayer(id: string, source: string, minzoom = 0, opacity = 0.92) {
  addMapLayer({
    id,
    type: 'fill',
    source,
    minzoom,
    paint: {
      'fill-color': '#fbfbf8',
      'fill-opacity': opacity,
    },
  })
}

function addLineLayer(
  id: string,
  source: string,
  color: string,
  width: number,
  minzoom = 0,
  opacity = 0.62,
  filter?: unknown,
) {
  addMapLayer({
    id,
    type: 'line',
    source,
    minzoom,
    ...(filter ? { filter } : {}),
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': color,
      'line-width': ['interpolate', ['linear'], ['zoom'], minzoom, width, 8, width * 1.45],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], minzoom, 0.08, minzoom + 0.8, opacity],
      'line-blur': ['interpolate', ['linear'], ['zoom'], minzoom, 0.08, 8, 0.28],
    },
  })
}

function addRegionHitLayers() {
  addRegionHitLayer('country-hit', 'country-boundaries')
  addRegionHitLayer('admin1-hit', 'admin1-boundaries', 3.2)
  addRegionHitLayer('china-province-hit', 'china-province-boundaries', 3.2)
  addRegionHitLayer('china-city-hit', 'china-city-boundaries', 7.1)
}

function addRegionHitLayer(id: string, source: string, minzoom = 0) {
  addMapLayer({
    id,
    type: 'fill',
    source,
    minzoom,
    paint: {
      'fill-color': '#ffffff',
      'fill-opacity': 0.01,
    },
  })
}

function addRegionDataLayers() {
  addRegionOverlayLayers('region-data', MAP_HIGHLIGHT_STYLE.dataFill, MAP_HIGHLIGHT_STYLE.dataLine, {
    fillOpacity: regionDataFillOpacityExpression(),
    lineOpacity: 0,
    lineWidth: 0,
    filter: regionVectorFilter(dataRegionIdsExcludingSelected()),
  })
}

function addRegionHighlightLayers() {
  addRegionOverlayLayers('region-selected', MAP_HIGHLIGHT_STYLE.selectedFill, MAP_HIGHLIGHT_STYLE.selectedLine, {
    fillOpacity: regionSourceMode === 'vector' ? 0.42 : regionOverlayOpacityExpression(0.4),
    lineOpacity: regionSourceMode === 'vector' ? 0.82 : regionOverlayOpacityExpression(0.82),
    lineWidth: ['interpolate', ['linear'], ['zoom'], 0, 0.9, 8, 1.22],
    filter: regionVectorFilter(selectedRegionId() ? [selectedRegionId() as string] : []),
    halo: {
      color: MAP_HIGHLIGHT_STYLE.selectedHalo,
      opacity: regionSourceMode === 'vector' ? 0.22 : regionOverlayOpacityExpression(0.22),
      width: ['interpolate', ['linear'], ['zoom'], 0, 1.4, 8, 1.9],
    },
  })
  addRegionOverlayLayers('region-hover', MAP_HIGHLIGHT_STYLE.hoverFill, MAP_HIGHLIGHT_STYLE.hoverLine, {
    fillOpacity: regionOverlayOpacityExpression(0.36),
    lineOpacity: regionOverlayOpacityExpression(0.68),
    lineWidth: ['interpolate', ['linear'], ['zoom'], 0, 0.62, 8, 1.02],
    filter: regionVectorFilter(activeHoveredRegionId() ? [activeHoveredRegionId() as string] : []),
  })
}

function addRegionOverlayLayers(
  sourceId: 'region-data' | 'region-selected' | 'region-hover',
  fillColor: string,
  lineColor: string,
  options: {
    fillOpacity: unknown
    lineOpacity: unknown
    lineWidth: unknown
    filter: unknown
    halo?: {
      color: string
      opacity: unknown
      width: unknown
    }
  },
) {
  const fillLayer = {
    id: `${sourceId}-fill`,
    type: 'fill',
    source: regionSourceMode === 'vector' ? REGION_VECTOR_SOURCE_ID : sourceId,
    ...(regionSourceMode === 'vector'
      ? { 'source-layer': REGION_VECTOR_SOURCE_LAYER, filter: options.filter }
      : {}),
    paint: {
      'fill-color': fillColor,
      'fill-opacity': options.fillOpacity,
      'fill-antialias': true,
    },
  }
  const haloLayer = options.halo
    ? {
        id: `${sourceId}-halo`,
        type: 'line',
        source: regionSourceMode === 'vector' ? REGION_VECTOR_SOURCE_ID : sourceId,
        ...(regionSourceMode === 'vector'
          ? { 'source-layer': REGION_VECTOR_SOURCE_LAYER, filter: options.filter }
          : {}),
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': options.halo.color,
          'line-width': options.halo.width,
          'line-opacity': options.halo.opacity,
        },
      }
    : null
  const lineLayer = {
    id: `${sourceId}-line`,
    type: 'line',
    source: regionSourceMode === 'vector' ? REGION_VECTOR_SOURCE_ID : sourceId,
    ...(regionSourceMode === 'vector'
      ? { 'source-layer': REGION_VECTOR_SOURCE_LAYER, filter: options.filter }
      : {}),
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': lineColor,
      'line-width': options.lineWidth,
      'line-opacity': options.lineOpacity,
    },
  }
  addRegionLayer(fillLayer)
  if (haloLayer) addRegionLayer(haloLayer)
  addRegionLayer(lineLayer)
}

function regionDataFillOpacityExpression() {
  if (basemapMode === 'vector') {
    return [
      'case',
      regionLevelEqualsExpression('city'),
      0.3,
      regionLevelEqualsExpression('admin1'),
      0.24,
      0.18,
    ]
  }
  return [
    'case',
    ['==', ['get', 'boundaryLevel'], 'city'],
    0.28,
    ['==', ['get', 'boundaryLevel'], 'admin1'],
    0.22,
    0.16,
  ]
}

function regionOverlayOpacityExpression(opacity: number) {
  if (basemapMode === 'vector') {
    return [
      'case',
      ['==', ['get', 'selected'], true],
      opacity,
      regionLevelEqualsExpression('city'),
      Math.min(opacity, 0.32),
      Math.min(opacity, 0.42),
    ]
  }
  return opacity
}

function regionLevelEqualsExpression(level: string) {
  return [
    'any',
    ['==', ['get', 'boundaryLevel'], level],
    ['==', ['get', 'level'], level],
  ]
}

function regionVectorFadeExpression(opacity: number | unknown[]) {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    0,
    opacity,
    VECTOR_REGION_FADE_START_ZOOM,
    opacity,
    VECTOR_REGION_FADE_END_ZOOM,
    0,
  ]
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
    filter: labelLayerFilter(includeChina),
    layout: {
      'text-field': ['get', 'display_name'],
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], minzoom, textSize, 8, textSize + 2],
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-padding': id === 'continent-label' ? 22 : 10,
    },
    paint: {
      'text-color': id === 'continent-label' ? '#6d7f8a' : '#53616c',
      'text-halo-color': 'rgba(255,255,255,0.94)',
      'text-halo-width': id === 'continent-label' ? 2.2 : 1.8,
      'text-opacity': id === 'continent-label' ? 0.74 : 0.92,
    },
  })
}

function labelLayerFilter(includeChina: boolean) {
  const filters: unknown[] = [['!=', ['get', 'hasPndlRegion'], true]]
  if (!includeChina) filters.push(['!=', ['get', 'country_key'], 'china'])
  return filters.length === 1 ? filters[0] : ['all', ...filters]
}

function bindLayerEvents() {
  if (!pointLayerEventsBound) {
    POINT_INTERACTIVE_LAYERS.forEach((layerId) => {
      map?.on('mousemove', layerId, handlePointMouseMove)
      map?.on('mouseleave', layerId, handlePointMouseLeave)
      map?.on('click', layerId, handlePointClick)
      map?.on('dblclick', layerId, handleFeatureDoubleClick)
    })
    pointLayerEventsBound = true
  }
  if (!regionLayerEventsBound) {
    REGION_INTERACTIVE_LAYERS.forEach((layerId) => {
      map?.on('click', layerId, handleRegionClick)
      map?.on('dblclick', layerId, handleFeatureDoubleClick)
    })
    regionLayerEventsBound = true
  }
}

function unbindLayerEvents() {
  if (!map) return
  POINT_INTERACTIVE_LAYERS.forEach((layerId) => {
    offLayerEvent('mousemove', layerId, handlePointMouseMove)
    offLayerEvent('mouseleave', layerId, handlePointMouseLeave)
    offLayerEvent('click', layerId, handlePointClick)
    offLayerEvent('dblclick', layerId, handleFeatureDoubleClick)
  })
  REGION_INTERACTIVE_LAYERS.forEach((layerId) => {
    offLayerEvent('click', layerId, handleRegionClick)
    offLayerEvent('dblclick', layerId, handleFeatureDoubleClick)
  })
  pointLayerEventsBound = false
  regionLayerEventsBound = false
}

function offLayerEvent(
  type: 'mousemove' | 'mouseleave' | 'click' | 'dblclick',
  layerId: string,
  listener: (...args: any[]) => void,
) {
  if (!map?.getLayer(layerId)) return
  ;(
    map as unknown as {
      off: (eventType: string, layer: string, handler: (...args: any[]) => void) => void
    }
  ).off(type, layerId, listener)
}

async function ensureBoundary(name: BoundaryName) {
  if (!mapReady.value) return
  if (boundaryCache.has(name)) {
    updateBoundarySource(name)
    updateRegionDataSource()
    return
  }
  pushBoundaryLoading(name)
  try {
    const response = await fetch(BOUNDARY_URLS[name])
    if (!response.ok) throw new Error(`${name} boundary failed`)
    boundaryCache.set(name, (await response.json()) as FeatureCollection)
    cleanedBoundaryCache.delete(name)
    boundaryVersion.value += 1
    updateBoundarySource(name)
    updatePointSource()
    updateRegionDataSource()
    if (name === 'countries') updateMapStatus()
  } catch {
    mapError.value = ui.value.boundaryLoadFailed
  } finally {
    popBoundaryLoading(name)
  }
}

function ensureStagedBoundariesForCurrentZoom() {
  if (!mapReady.value) return
  const zoom = map?.getZoom() ?? 0
  void ensureBoundary('countries')
  if (zoom >= 3.2) {
    void ensureBoundary('admin1')
    void ensureBoundary('chinaProvinces')
  }
  if (zoom >= 7.1) void ensureBoundary('chinaCities')
}

function pushBoundaryLoading(name: BoundaryName) {
  if (loadingBoundaryNames.value.includes(name)) return
  loadingBoundaryNames.value = [...loadingBoundaryNames.value, name]
}

function popBoundaryLoading(name: BoundaryName) {
  loadingBoundaryNames.value = loadingBoundaryNames.value.filter((item) => item !== name)
}

function updateMapData() {
  if (!mapReady.value) return
  if (basemapMode === 'geojson') updateContinentLabels()
  ;(['countries', 'admin1', 'chinaProvinces', 'chinaCities'] as BoundaryName[]).forEach(
    updateBoundarySource,
  )
  updatePointSource()
  updateRegionDataSource()
  updateRegionHighlightSources()
}

function updateBoundarySource(name: BoundaryName) {
  const collection = getCleanBoundaryCollection(name)
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

function getCleanBoundaryCollection(name: BoundaryName) {
  const cached = cleanedBoundaryCache.get(name)
  if (cached) return cached
  const collection = boundaryCache.get(name)
  if (!collection) return null
  const cleaned = cleanBoundaryCollection(collection, name)
  cleanedBoundaryCache.set(name, cleaned)
  return cleaned
}

function updateContinentLabels() {
  const source = map?.getSource('continent-label-points') as GeoJSONSource | undefined
  source?.setData(buildContinentLabelCollection() as never)
}

function buildContinentLabelCollection() {
  return {
    type: 'FeatureCollection',
    features: CONTINENT_LABELS.map((continent) => ({
      type: 'Feature',
      properties: {
        display_name: locale.value === 'zh' ? continent.zh : continent.en,
        key: continent.key,
      },
      geometry: {
        type: 'Point',
        coordinates: continent.coordinates,
      },
    })),
  }
}

function updatePointSource() {
  clearHoveredPoint()
  const collection = buildPointCollection()
  const source = map?.getSource('map-points') as GeoJSONSource | undefined
  const labelSource = map?.getSource('map-point-labels') as GeoJSONSource | undefined
  source?.setData(collection as never)
  labelSource?.setData(collection as never)
}

function updateRegionDataSource() {
  if (regionSourceMode === 'vector') {
    updateRegionVectorFilters()
    return
  }
  setGeoJsonSourceData('region-data', null, buildRegionDataCollection())
}

function updateRegionHighlightSources() {
  if (regionSourceMode === 'vector') {
    updateRegionVectorFilters()
    return
  }
  setGeoJsonSourceData('region-hover', activeHoveredRegionFeature())
  setGeoJsonSourceData('region-selected', selectedRegionFeature.value)
}

function updateRegionVectorFilters() {
  setRegionLayerFilter(
    ['region-data-fill', 'region-data-line'],
    regionVectorFilter(dataRegionIdsExcludingSelected()),
  )
  setRegionLayerFilter(
    ['region-selected-fill', 'region-selected-halo', 'region-selected-line'],
    regionVectorFilter(selectedRegionId() ? [selectedRegionId() as string] : []),
  )
  setRegionLayerFilter(
    ['region-hover-fill', 'region-hover-line'],
    regionVectorFilter(activeHoveredRegionId() ? [activeHoveredRegionId() as string] : []),
  )
}

function setRegionLayerFilter(layerIds: string[], filter: unknown) {
  if (regionSourceMode !== 'vector') return
  layerIds.forEach((layerId) => {
    if (!map?.getLayer(layerId)) return
    map.setFilter(layerId, filter as never)
  })
}

function regionVectorFilter(regionIds: string[]) {
  return regionIds.length
    ? ['in', ['get', 'region_id'], ['literal', regionIds]]
    : ['==', ['get', 'region_id'], '__none__']
}

function dataRegionIds() {
  return [...dataRegionIdSet()]
}

function dataRegionIdsExcludingSelected() {
  const ids = dataRegionIdSet()
  const selectedId = selectedRegionId()
  if (selectedId) ids.delete(selectedId)
  return [...ids]
}

function dataRegionIdSet() {
  return new Set(displayPointRows().map(regionIdForStat).filter(Boolean))
}

function setGeoJsonSourceData(
  sourceId: string,
  feature: GeoJsonFeature | null,
  collection?: FeatureCollection,
) {
  const source = map?.getSource(sourceId) as GeoJSONSource | undefined
  source?.setData(
    (collection ?? (feature ? featureCollectionFromFeature(feature) : EMPTY_COLLECTION)) as never,
  )
}

function featureCollectionFromFeature(feature: GeoJsonFeature): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [cloneHighlightFeature(feature)],
  }
}

function cloneHighlightFeature(feature: GeoJsonFeature): GeoJsonFeature {
  return {
    type: 'Feature',
    id: feature.id,
    properties: { ...feature.properties },
    geometry: feature.geometry,
  }
}

function buildRegionDataCollection(): FeatureCollection {
  const seen = new Set<string>()
  const selectedId = selectedRegionId()
  const features = displayPointRows().flatMap((row) => {
    const feature = boundaryFeatureForStat(row)
    const key = regionFeatureKey(feature)
    if (!feature || !key || key === selectedId || seen.has(key)) return []
    seen.add(key)
    return [cloneHighlightFeature(feature)]
  })
  return { type: 'FeatureCollection', features }
}

function regionIdForStat(stat: MapRegionStat) {
  return `${stat.level}|${stat.geoKey}`
}

function regionIdFromProperties(props: Record<string, unknown>) {
  const explicitId = String(props.region_id ?? '')
  if (explicitId) return explicitId
  const level = String(props.boundaryLevel ?? props.level ?? props.sourceLevel ?? '')
  const geoKey = String(props.geoKey ?? props.geo_key ?? props.sourceGeoKey ?? '')
  return level && geoKey ? `${level}|${geoKey}` : ''
}

function selectedRegionId() {
  return selectedRegionFeature.value ? regionIdFromProperties(selectedRegionFeature.value.properties) : ''
}

function hoveredRegionId() {
  return hoveredRegionFeature ? regionIdFromProperties(hoveredRegionFeature.properties) : ''
}

function activeHoveredRegionId() {
  const hoverId = hoveredRegionId()
  return hoverId && hoverId !== selectedRegionId() ? hoverId : ''
}

function activeHoveredRegionFeature() {
  return activeHoveredRegionId() ? hoveredRegionFeature : null
}

function dataRegionStatById(regionId: string) {
  return displayPointRows().find((row) => regionIdForStat(row) === regionId)
}

function cleanBoundaryCollection(collection: FeatureCollection, name: BoundaryName): FeatureCollection {
  const threshold = BOUNDARY_NOISE_AREA_THRESHOLDS[name]
  if (!threshold) return collection
  return {
    type: 'FeatureCollection',
    features: collection.features.flatMap((feature) => {
      const geometry = filterSmallGeometryParts(feature.geometry, threshold)
      if (!geometry) return []
      return [{ ...feature, geometry }]
    }),
  }
}

function filterSmallGeometryParts(geometry: unknown, minArea: number) {
  const typedGeometry = geometry as { type?: string; coordinates?: unknown }
  if (typedGeometry.type === 'Polygon' && Array.isArray(typedGeometry.coordinates)) {
    return typedGeometry
  }
  if (typedGeometry.type !== 'MultiPolygon' || !Array.isArray(typedGeometry.coordinates)) {
    return geometry
  }

  const polygons = typedGeometry.coordinates.filter((polygon) => Array.isArray(polygon))
  if (!polygons.length) return null
  const kept = polygons.filter((polygon) => polygonArea(polygon) >= minArea)
  if (kept.length) {
    return { type: 'MultiPolygon', coordinates: kept }
  }
  const largest = polygons.sort((a, b) => polygonArea(b) - polygonArea(a))[0]
  return largest ? { type: 'MultiPolygon', coordinates: [largest] } : null
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
  const activeRegionIds = dataRegionIdSet()
  const features = collection.features.flatMap((feature) => {
    const geoKey = featureGeoKey(feature, level)
    if (!geoKey || seen.has(geoKey)) return []
    const regionId = `${level}|${geoKey}`
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
          region_id: regionId,
          hasPndlRegion: activeRegionIds.has(regionId),
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
      const featureId = pointFeatureId(row)
      return [
        {
          type: 'Feature',
          id: featureId,
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
    const collection = getCleanBoundaryCollection(name)
    if (!collection) continue
    const level = boundaryLevel(name)
    const feature = collection.features.find((item) => featureGeoKey(item, level) === row.geoKey)
    if (feature) return feature
  }
  return null
}

function statProperties(stat: MapRegionStat) {
  const featureId = pointFeatureId(stat)
  return {
    featureId,
    level: stat.level,
    geoKey: stat.geoKey,
    parentGeoKey: stat.parentGeoKey ?? '',
    country: stat.country ?? '',
    province: stat.province ?? '',
    city: stat.city ?? '',
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

function pointFeatureId(stat: MapRegionStat) {
  return [
    'pndl',
    stat.level,
    stat.geoKey,
    stat.biomarkerKey || selection.biomarkerKey,
    stat.yearLabel || selection.year,
  ].join('|')
}

function countryGroupKey(row: MapRegionStat) {
  if (row.level === 'country') return row.geoKey
  if (row.parentGeoKey) return row.parentGeoKey
  return row.geoKey.split('|')[0] ?? row.geoKey
}

function locationPrecisionLabel(level: MapRegionStat['level'] | string) {
  if (level === 'city') return ui.value.cityPrecision
  if (level === 'admin1') return ui.value.adminPrecision
  return ui.value.countryPrecision
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
    const collection = getCleanBoundaryCollection(name)
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
  void ensureBoundary('admin1')
  void ensureBoundary('chinaProvinces')
  void ensureBoundary('chinaCities')
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
  if (level === 'city') return Math.min(7.4, currentMapMaxZoom())
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
    filterError.value = error instanceof Error ? error.message : ui.value.statsLoadFailed
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
  ensureStagedBoundariesForCurrentZoom()
}

function handlePointClick(event: MapLayerMouseEvent) {
  closeSearch()
  const feature = event.features?.[0]
  if (!feature?.properties) return
  if (isClusterFeature(feature.properties)) {
    scheduleClusterDetailOpen(feature)
    return
  }
  setSelectedPoint(feature)
  selectMatchingBoundaryForPoint(feature)
  focusFeature(feature, event)
  scheduleDetailOpen(feature)
}

function handleRegionClick(event: MapLayerMouseEvent) {
  closeSearch()
  if (pointFeaturesAtPoint(event.point).length) return
  const feature = bestRegionFeatureAtPoint(event.point)
  if (!feature?.properties || !map || !hoverPopup) return
  setSelectedRegion(feature)
  focusFeature(feature, event)
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

function scheduleClusterDetailOpen(feature: GeoJsonFeature) {
  if (clickTimer) window.clearTimeout(clickTimer)
  clickTimer = window.setTimeout(() => {
    void openClusterDetail(feature)
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
  detailMode.value = 'none'
  detailError.value = ''
  try {
    selectedDetail.value = await fetchMapDetail(level, geoKey, { ...selection }, detailController.signal)
    detailMode.value = 'compact'
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    detailError.value = error instanceof Error ? error.message : ui.value.detailLoadFailed
    detailMode.value = 'compact'
  } finally {
    isLoadingDetail.value = false
  }
}

async function openClusterDetail(feature: GeoJsonFeature) {
  if (!map) return
  const clusterId = Number(feature.properties.cluster_id)
  if (Number.isNaN(clusterId)) return
  hideTooltip()
  const center = pointCoordinates(feature)
  if (center) {
    map.stop()
    map.easeTo({ center, duration: 420, essential: true })
  }
  detailController?.abort()
  detailController = new AbortController()
  selectedDetail.value = null
  isLoadingDetail.value = true
  detailMode.value = 'none'
  detailError.value = ''
  try {
    const locations = await clusterLocations(clusterId, Number(feature.properties.point_count ?? 0))
    selectedDetail.value = await fetchMapClusterDetail(
      { ...selection },
      locations,
      detailController.signal,
    )
    detailMode.value = 'compact'
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    detailError.value = error instanceof Error ? error.message : ui.value.detailLoadFailed
    detailMode.value = 'compact'
  } finally {
    isLoadingDetail.value = false
  }
}

async function clusterLocations(clusterId: number, pointCount: number): Promise<MapClusterLocationRequest[]> {
  const source = map?.getSource('map-points') as ClusterGeoJSONSource | undefined
  const leaves = await source?.getClusterLeaves?.(clusterId, Math.min(Math.max(pointCount, 1), 120), 0)
  const locations = new Map<string, MapClusterLocationRequest>()
  ;(leaves ?? []).forEach((leaf) => {
    const level = String(leaf.properties?.level ?? '') as MapRegionStat['level']
    const geoKey = String(leaf.properties?.geoKey ?? '')
    if (!level || !geoKey) return
    locations.set(`${level}|${geoKey}`, { level, geoKey })
  })
  return Array.from(locations.values())
}

function handleFeatureDoubleClick(event: MapLayerMouseEvent) {
  event.preventDefault()
  if (clickTimer) window.clearTimeout(clickTimer)
  const firstFeature = event.features?.[0] as GeoJsonFeature | undefined
  if (isRegionFeature(firstFeature) && pointFeaturesAtPoint(event.point).length) return
  const feature = isRegionFeature(firstFeature) ? bestRegionFeatureAtPoint(event.point) : firstFeature
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
    zoom: Math.min(expansionZoom + 0.25, currentMapMaxZoom()),
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
  const bbox = bboxFromFeatureProperties(feature.properties) ?? featureBbox(feature.geometry)
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
        maxZoom: Math.min(7.5, currentMapMaxZoom()),
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

function bboxFromFeatureProperties(props: Record<string, unknown>) {
  const bbox = [
    Number(props.bbox_w ?? props.bboxW),
    Number(props.bbox_s ?? props.bboxS),
    Number(props.bbox_e ?? props.bboxE),
    Number(props.bbox_n ?? props.bboxN),
  ] as [number, number, number, number]
  return bbox.every(Number.isFinite) && bbox[0] < bbox[2] && bbox[1] < bbox[3] ? bbox : null
}

function handlePointMouseMove(event: MapLayerMouseEvent) {
  setHoveredRegion(null)
  const feature = event.features?.[0]
  if (!feature?.properties) return
  setHoveredPoint(feature)
  showFeatureTooltip(feature, event.lngLat)
}

function handlePointMouseLeave() {
  clearHoveredPoint()
  hideTooltip()
}

function hideTooltipOnEmptyClick(event: MapMouseEvent) {
  closeSearch()
  isLayerPanelOpen.value = false
  isLanguageMenuOpen.value = false
  const layers = ALL_INTERACTIVE_LAYERS.filter((layerId) => map?.getLayer(layerId))
  const features = layers.length ? map?.queryRenderedFeatures(event.point, { layers }) : []
  if (!features?.length) hideTooltip()
}

function showTooltip(event: MapLayerMouseEvent) {
  const feature = event.features?.[0]
  if (!feature?.properties) return
  showFeatureTooltip(feature, event.lngLat)
}

function showFeatureTooltip(feature: GeoJsonFeature, lngLat: MapLayerMouseEvent['lngLat']) {
  if (!map || !hoverPopup) return
  map.getCanvas().style.cursor = 'pointer'
  hoverPopup.setLngLat(lngLat).setHTML(buildTooltipHtml(feature.properties)).addTo(map)
}

function hideTooltip() {
  if (map) map.getCanvas().style.cursor = ''
  if (regionTooltipTimer) {
    window.clearTimeout(regionTooltipTimer)
    regionTooltipTimer = undefined
  }
  hoverPopup?.remove()
}

function updateRegionHoverFromPoint(event: MapMouseEvent) {
  if (!map || !viewLayers.boundaries) return
  if (pointFeaturesAtPoint(event.point).length) {
    setHoveredRegion(null)
    return
  }

  const regionFeature = bestRegionFeatureAtPoint(event.point)
  setHoveredRegion(regionFeature)
  if (regionFeature) {
    showFeatureTooltip(regionFeature, event.lngLat)
  } else if (!hoveredPointId) {
    hideTooltip()
  }
}

function pointFeaturesAtPoint(point: MapMouseEvent['point']) {
  if (!map) return []
  const pointLayers = POINT_INTERACTIVE_LAYERS.filter((layerId) => map?.getLayer(layerId))
  return pointLayers.length
    ? map.queryRenderedFeatures(point, { layers: pointLayers as unknown as string[] })
    : []
}

function bestRegionFeatureAtPoint(point: MapMouseEvent['point']) {
  if (!map) return null
  for (const layerId of REGION_HOVER_PRIORITY_LAYERS) {
    if (!map.getLayer(layerId)) continue
    const [feature] = map.queryRenderedFeatures(point, { layers: [layerId] })
    if (feature?.properties) return enrichRenderedRegionFeature(feature as GeoJsonFeature)
  }
  return null
}

function enrichRenderedRegionFeature(feature: GeoJsonFeature) {
  const props = feature.properties
  const regionId = regionIdFromProperties(props)
  const stat = regionId ? dataRegionStatById(regionId) : undefined
  const level = String(props.level ?? stat?.level ?? props.boundaryLevel ?? '')
  const geoKey = String(props.geoKey ?? props.geo_key ?? stat?.geoKey ?? '')
  return {
    ...feature,
    properties: {
      ...props,
      ...(stat ? statProperties(stat) : {}),
      region_id: regionId || (level && geoKey ? `${level}|${geoKey}` : ''),
      boundaryLevel: level,
      level,
      geoKey,
      geo_key: geoKey,
      displayName: stat?.displayName ?? props.displayName ?? props.display_name ?? geoKey,
    },
  }
}

function setHoveredPoint(feature: GeoJsonFeature | null) {
  const nextId = feature ? pointFeatureStateId(feature) : null
  if (hoveredPointId === nextId) return
  clearHoveredPoint()
  hoveredPointId = nextId
  if (nextId != null) {
    map?.setFeatureState({ source: 'map-points', id: nextId }, { hover: true })
  }
}

function clearHoveredPoint() {
  if (hoveredPointId != null) {
    map?.setFeatureState({ source: 'map-points', id: hoveredPointId }, { hover: false })
  }
  hoveredPointId = null
}

function setSelectedPoint(feature: GeoJsonFeature | null) {
  const nextId = feature ? pointFeatureStateId(feature) : null
  if (selectedPointId != null && selectedPointId !== nextId) {
    map?.setFeatureState({ source: 'map-points', id: selectedPointId }, { selected: false })
  }
  selectedPointId = nextId
  selectedPointKey.value = feature ? regionFeatureKey(feature) : ''
  if (nextId != null) {
    map?.setFeatureState({ source: 'map-points', id: nextId }, { selected: true })
  }
}

function clearSelectedPoint() {
  setSelectedPoint(null)
}

function pointFeatureStateId(feature: GeoJsonFeature) {
  const id = feature.id ?? feature.properties.featureId
  if (typeof id === 'string' || typeof id === 'number') return id
  return null
}

function setHoveredRegion(feature: GeoJsonFeature | null) {
  if (regionFeatureKey(hoveredRegionFeature) === regionFeatureKey(feature)) return
  hoveredRegionFeature = feature
    ? {
        ...cloneHighlightFeature(feature),
        properties: { ...feature.properties, hovered: true },
      }
    : null
  updateRegionHighlightSources()
}

function setSelectedRegion(feature: GeoJsonFeature | null) {
  if (regionFeatureKey(selectedRegionFeature.value) === regionFeatureKey(feature)) return
  selectedRegionFeature.value = feature
    ? {
        ...cloneHighlightFeature(feature),
        properties: { ...feature.properties, selected: true },
      }
    : null
  if (regionSourceMode === 'geojson') updateRegionDataSource()
  updateRegionHighlightSources()
}

function selectMatchingBoundaryForPoint(feature: GeoJsonFeature) {
  const props = feature.properties
  if (regionSourceMode === 'vector') {
    setSelectedRegion(regionReferenceFeatureFromProperties(props))
    return
  }
  const boundaryFeature = boundaryFeatureForProperties(props)
  setSelectedRegion(boundaryFeature)
}

function boundaryFeatureForStat(stat: MapRegionStat) {
  return boundaryFeatureForLevelGeoKey(stat.level, stat.geoKey, stat)
}

function boundaryFeatureForProperties(props: Record<string, unknown>) {
  const level = String(props.level ?? props.sourceLevel ?? '')
  const geoKey = String(props.geoKey ?? props.sourceGeoKey ?? '')
  if (!level || !geoKey) return null
  return boundaryFeatureForLevelGeoKey(level, geoKey, statLikeFromProperties(props, level, geoKey))
}

function statLikeFromProperties(
  props: Record<string, unknown>,
  level: string,
  geoKey: string,
): MapRegionStat | undefined {
  const stat = buildStatIndex().get(`${level}|${geoKey}`)
  if (stat) return stat
  if (level !== 'country' && props.parentGeoKey) {
    return buildStatIndex().get(`${level}|${String(props.parentGeoKey)}`)
  }
  return undefined
}

function regionReferenceFeatureFromProperties(props: Record<string, unknown>) {
  const level = String(props.level ?? props.sourceLevel ?? props.boundaryLevel ?? '')
  const geoKey = String(props.geoKey ?? props.sourceGeoKey ?? props.geo_key ?? '')
  if (!level || !geoKey) return null
  const regionId = `${level}|${geoKey}`
  const stat = statLikeFromProperties(props, level, geoKey) ?? dataRegionStatById(regionId)
  return {
    type: 'Feature',
    properties: {
      ...(stat ? statProperties(stat) : {}),
      region_id: regionId,
      boundaryLevel: level,
      level,
      geoKey,
      geo_key: geoKey,
      displayName: stat?.displayName ?? props.displayName ?? props.display_name ?? geoKey,
      selected: true,
    },
    geometry: null,
  } as GeoJsonFeature
}

function boundaryFeatureForLevelGeoKey(level: string, geoKey: string, stat?: MapRegionStat) {
  if (!level || !geoKey) return null
  const names =
    level === 'country'
      ? (['countries'] as BoundaryName[])
      : level === 'city'
        ? (['chinaCities'] as BoundaryName[])
        : geoKey.startsWith('china|')
          ? (['chinaProvinces', 'admin1'] as BoundaryName[])
          : (['admin1'] as BoundaryName[])
  for (const name of names) {
    const collection = getCleanBoundaryCollection(name)
    if (!collection) continue
    const boundaryLevelValue = boundaryLevel(name)
    const feature = collection.features.find((item) => featureGeoKey(item, boundaryLevelValue) === geoKey)
    if (feature) return enrichSingleBoundaryFeature(feature, boundaryLevelValue, stat)
  }
  return null
}

function enrichSingleBoundaryFeature(
  feature: GeoJsonFeature,
  level: MapRegionStat['level'],
  sourceStat?: MapRegionStat,
) {
  const geoKey = featureGeoKey(feature, level)
  const stat = sourceStat ?? buildStatIndex().get(`${level}|${geoKey}`)
  const statProps = stat ? statProperties(stat) : {}
  return {
    ...feature,
    properties: {
      ...feature.properties,
      ...statProps,
      boundaryLevel: level,
      geoKey,
      sourceLevel: stat?.level ?? level,
      sourceGeoKey: stat?.geoKey ?? geoKey,
    },
  }
}

function isRegionFeature(feature?: GeoJsonFeature | null) {
  return Boolean(feature?.properties?.boundaryLevel)
}

function regionFeatureKey(feature?: GeoJsonFeature | null) {
  if (!feature?.properties) return ''
  const regionId = regionIdFromProperties(feature.properties)
  if (regionId) return regionId
  const level = String(feature.properties.boundaryLevel ?? feature.properties.level ?? '')
  const geoKey = String(feature.properties.geoKey ?? feature.properties.geo_key ?? '')
  return level && geoKey ? `${level}|${geoKey}` : ''
}

function buildTooltipHtml(props: Record<string, unknown>) {
  if (isClusterFeature(props)) {
    return `<strong>${ui.value.clusterTitle}</strong><br>${ui.value.clusterCount}：${formatNumber(Number(props.point_count ?? 0))}<br>${ui.value.clusterHint}`
  }
  const title = escapeHtml(String(props.displayName ?? ui.value.unnamedRegion))
  if (props.pndlGeomean == null) {
    return `<strong>${title}</strong><br>${ui.value.noPndlForSelection}`
  }
  return `<strong>${title}</strong><br>${escapeHtml(String(props.locationPrecision ?? ui.value.locationPrecision))}<br>${ui.value.biomarker}：${escapeHtml(displayOptionLabel(String(props.biomarkerLabel ?? selectedBiomarkerLabel.value)))}<br>${ui.value.pndlGeomean}：${formatCompact(Number(props.pndlGeomean))}<br>${ui.value.records}：${formatNumber(Number(props.recordCount ?? 0))}<br>${ui.value.literature}：${formatNumber(Number(props.doiCount ?? 0))}`
}

function closeDetail() {
  detailController?.abort()
  detailController = null
  isLoadingDetail.value = false
  detailMode.value = 'none'
}

function openFullDetail() {
  if (!selectedDetail.value || isLoadingDetail.value) return
  detailMode.value = 'full'
}

function closeFullDetail() {
  if (!selectedDetail.value) {
    detailMode.value = 'none'
    return
  }
  detailMode.value = 'compact'
}

function handleMapKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !isDetailOpen.value) return
  if (isFullDetailOpen.value) {
    closeFullDetail()
    return
  }
  closeDetail()
}

function toggleFilters() {
  isFilterOpen.value = !isFilterOpen.value
}

function toggleLayerPanel() {
  isLayerPanelOpen.value = !isLayerPanelOpen.value
  isLanguageMenuOpen.value = false
  closeSearch()
}

function resetMapView() {
  if (!map) return
  closeSearch()
  isLayerPanelOpen.value = false
  map.stop()
  const center = map.getCenter()
  const targetZoom =
    mapMode.value === 'globe'
      ? Math.max(GLOBE_INITIAL_ZOOM, getGlobeSafeZoom())
      : Math.max(FLAT_INITIAL_ZOOM, FLAT_MIN_ZOOM + 0.2)
  map.easeTo({
    center,
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
  updateRegionHoverFromPoint(event)
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
  clearHoveredPoint()
  setHoveredRegion(null)
  hideTooltip()
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
    country: country ?? (preserveOnMiss ? mapStatus.value.country : ui.value.unknownCountry),
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
  const countries = getCleanBoundaryCollection('countries')
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
  if (projectionSwitchInProgress || mode === mapMode.value) return
  projectionSwitchInProgress = true
  isMapStyleSwitching.value = true
  map.stop()
  isLayerPanelOpen.value = false
  closeSearch()
  clearHoveredPoint()
  setHoveredRegion(null)
  unbindLayerEvents()
  mapReady.value = false
  mapMode.value = mode
  const safeMinZoom = mode === 'globe' ? getGlobeSafeZoom() : FLAT_MIN_ZOOM
  map.setMinZoom(safeMinZoom)
  const currentCenter = map.getCenter()
  const currentZoom = map.getZoom()
  map.setStyle(buildMapStyle(mode, activeBasemapConfig) as never)
  const nextZoom =
    mode === 'globe'
      ? Math.max(currentZoom, safeMinZoom, GLOBE_INITIAL_ZOOM)
      : Math.max(currentZoom, safeMinZoom)
  const restore = () => {
    if (!projectionSwitchInProgress || !map) return
    if (!map.isStyleLoaded()) {
      map.once('idle', restore)
      return
    }
    mapReady.value = true
    addMapSourcesAndLayers()
    bindLayerEvents()
    void ensureBoundary('countries')
    ensureFallbackBoundaries()
    updateMapData()
    syncAtmosphereStyle()
    map.setMaxZoom(currentMapMaxZoom())
    map.setMinZoom(safeMinZoom)
    map.easeTo({
      center: currentCenter,
      zoom: nextZoom,
      bearing: 0,
      pitch: 0,
      duration: 680,
      essential: true,
    })
    projectionSwitchInProgress = false
    isMapStyleSwitching.value = false
  }
  map.once('idle', restore)
  window.setTimeout(restore, 900)
}

function getGlobeSafeZoom() {
  const height = mapContainer.value?.clientHeight ?? window.innerHeight
  if (height < 520) return 2.74
  if (height < 680) return 2.68
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
  setLayerVisibility([...REGION_FILL_LAYER_IDS], true)
  setLayerVisibility([...layerIdsForViewGroup('boundaries'), ...REGION_LINE_LAYER_IDS], viewLayers.boundaries)
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
    return type === 'line' && /admin|boundar|border|country|province|state/i.test(id) ? [id] : []
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
  mapWithSky.setSky?.(undefined)
}

function refreshStats() {
  scheduleStatsFetch(0)
}

function readInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'zh'
  return window.localStorage.getItem(MAP_LOCALE_STORAGE_KEY) === 'en' ? 'en' : 'zh'
}

function setLocale(value: Locale) {
  locale.value = value
  isLanguageMenuOpen.value = false
}

function displayOptionLabel(value?: string | null) {
  if (!value) return ''
  const normalized = value.trim()
  if (locale.value === 'en') {
    if (normalized === 'ALL') return ui.value.allTargetClasses
    if (normalized === '全部目标物质类别') return ui.value.allCategories
    if (normalized === '全部小类') return ui.value.allSubcategories
    if (normalized === '全部年份') return ui.value.allYears
    if (normalized === '全部 biomarker' || normalized === '全部生物标记物') {
      return ui.value.allBiomarkers
    }
    if (normalized === '未标注年份') return ui.value.unspecifiedYear
    return normalized
  }
  if (normalized === '全部 biomarker') return ui.value.allBiomarkers
  if (normalized === '全部目标物质类别') return ui.value.allCategories
  if (normalized === 'ALL') return ui.value.allTargetClasses
  return normalized
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
  return new Intl.NumberFormat(locale.value === 'zh' ? 'zh-CN' : 'en-US').format(Number(value))
}

function formatCompact(value?: number | null) {
  if (value == null || Number.isNaN(Number(value))) return ui.value.noData
  const number = Number(value)
  const numberLocale = locale.value === 'zh' ? 'zh-CN' : 'en-US'
  if (number >= 1000) return number.toLocaleString(numberLocale, { maximumFractionDigits: 0 })
  if (number >= 10) return number.toLocaleString(numberLocale, { maximumFractionDigits: 1 })
  return number.toLocaleString(numberLocale, { maximumFractionDigits: 2 })
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
      <RouterLink class="brand" to="/" :aria-label="ui.brandHome">
        <span class="brand-logo" aria-hidden="true">
          <span class="brand-drop"></span>
          <span class="brand-bars"><i></i><i></i><i></i></span>
          <span class="brand-line"><i></i><i></i></span>
        </span>
        <span>
          <strong>{{ ui.brandTitle }}</strong>
          <small>{{ ui.brandSubtitle }}</small>
        </span>
      </RouterLink>

      <div class="header-center">
        <h1 class="page-title">{{ ui.pageTitle }}</h1>

        <div class="location-search" :class="{ active: isSearchFocused && searchQuery }">
          <span class="search-mark" aria-hidden="true"></span>
          <input
            v-model="searchQuery"
            type="search"
            :placeholder="ui.searchPlaceholder"
            :aria-label="ui.searchLabel"
            @focus="openSearch"
            @input="openSearch"
            @blur="closeSearchSoon"
            @keydown.enter.prevent="applyFirstSearchResult"
          />
          <button v-if="searchQuery" type="button" :aria-label="ui.clearSearch" @mousedown.prevent @click="clearSearch">
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
            <p v-if="!searchResults.length">{{ ui.noSearchResults }}</p>
          </div>
        </div>
      </div>

      <div class="header-tools">
        <div class="language-menu" :class="{ open: isLanguageMenuOpen }">
          <button
            type="button"
            :aria-label="ui.languageMenu"
            :aria-expanded="isLanguageMenuOpen"
            @click="isLanguageMenuOpen = !isLanguageMenuOpen"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9"></circle>
              <path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18"></path>
            </svg>
            <span>{{ locale === 'zh' ? '中' : 'EN' }}</span>
          </button>
          <div v-if="isLanguageMenuOpen" class="language-popover">
            <button type="button" :class="{ active: locale === 'zh' }" @click="setLocale('zh')">
              {{ ui.chinese }}
            </button>
            <button type="button" :class="{ active: locale === 'en' }" @click="setLocale('en')">
              {{ ui.english }}
            </button>
          </div>
        </div>
        <RouterLink class="login-button" to="/">{{ ui.backHome }}</RouterLink>
      </div>
    </header>

    <section
      class="map-stage"
      :class="{
        'detail-open': isDetailOpen,
        'filters-closed': !isFilterOpen,
        switching: isMapStyleSwitching,
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
          :aria-label="ui.resetTitle"
          :title="ui.resetTitle"
          @click="resetMapView"
        >
          <span class="reset-icon" aria-hidden="true"></span>
          <span class="tool-label">{{ ui.resetView }}</span>
        </button>

        <button
          class="map-tool-button"
          type="button"
          :disabled="!globeAvailable"
          :aria-label="mapMode === 'globe' ? ui.switchToFlat : ui.switchToGlobe"
          :title="mapMode === 'globe' ? ui.switchToFlat : ui.switchToGlobe"
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
            :aria-label="ui.mapLayers"
            :title="ui.mapLayers"
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
            <strong>{{ ui.layerPanelTitle }}</strong>
            <label>
              <input v-model="viewLayers.labels" type="checkbox" />
              <span>{{ ui.labelsLayer }}</span>
            </label>
            <label>
              <input v-model="viewLayers.boundaries" type="checkbox" />
              <span>{{ ui.boundariesLayer }}</span>
            </label>
            <label>
              <input v-model="viewLayers.pndl" type="checkbox" />
              <span>{{ ui.pndlLayer }}</span>
            </label>
            <label>
              <input v-model="viewLayers.ambience" type="checkbox" />
              <span>{{ ui.ambienceLayer }}</span>
            </label>
            <p>{{ ui.coverageNote }}</p>
          </div>
        </div>
      </div>

      <div class="filter-shell" :class="{ collapsed: !isFilterOpen }">
        <form class="floating-filters" :aria-hidden="!isFilterOpen" @submit.prevent="refreshStats">
          <div class="filter-head">
            <strong>{{ ui.filterTitle }}</strong>
            <small>{{ filterSummary }}</small>
          </div>
          <label>
            <span>{{ ui.targetClass }}</span>
            <select v-model="selection.targetClass" :disabled="isLoadingFilters || !filters">
              <option value="ALL">{{ ui.allTargetClasses }}</option>
              <option v-for="targetClass in currentTargetClasses" :key="targetClass" :value="targetClass">
                {{ displayOptionLabel(targetClass) }}
              </option>
            </select>
          </label>

          <label>
            <span>{{ ui.category }}</span>
            <select v-model="selection.category" :disabled="isLoadingFilters || !filters">
              <option v-for="category in currentCategories" :key="category" :value="category">
                {{ displayOptionLabel(category) }}
              </option>
            </select>
          </label>

          <label>
            <span>{{ ui.subcategory }}</span>
            <select v-model="selection.subcategory" :disabled="!currentSubcategories.length">
              <option v-for="subcategory in currentSubcategories" :key="subcategory" :value="subcategory">
                {{ displayOptionLabel(subcategory) }}
              </option>
            </select>
          </label>

          <label>
            <span>{{ ui.biomarker }}</span>
            <select v-model="selection.biomarkerKey" :disabled="!currentBiomarkers.length">
              <option v-for="biomarker in currentBiomarkers" :key="biomarker.key" :value="biomarker.key">
                {{ displayOptionLabel(biomarker.label) }}
              </option>
            </select>
          </label>

          <label>
            <span>{{ ui.year }}</span>
            <select v-model="selection.year" :disabled="!currentYears.length">
              <option v-for="year in currentYears" :key="year" :value="year">
                {{ displayOptionLabel(year) }}
              </option>
            </select>
          </label>

          <button type="submit" :disabled="isLoadingStats">
            {{ isLoadingStats ? ui.refreshing : ui.refresh }}
          </button>
        </form>
        <button
          class="filter-toggle"
          type="button"
          :aria-label="isFilterOpen ? ui.collapseFilters : ui.expandFilters"
          @click="toggleFilters"
        >
          <span aria-hidden="true"></span>
        </button>
      </div>

      <p v-if="activeMapMessage" class="map-message" :class="activeMapMessage.type">
        {{ activeMapMessage.text }}
      </p>
      <p v-if="boundaryLoadingMessage" class="boundary-loading-chip">
        {{ boundaryLoadingMessage }}
      </p>

      <div class="map-status-chip" aria-live="polite">
        <strong>{{ formattedMapStatus.label }}</strong>
        <span>{{ ui.latitude }} {{ formattedMapStatus.latitude }}</span>
        <span>{{ ui.longitude }} {{ formattedMapStatus.longitude }}</span>
        <strong>{{ ui.country }}：{{ formattedMapStatus.country }}</strong>
      </div>

      <aside
        class="detail-drawer"
        :class="{ open: isCompactDetailOpen }"
        :aria-hidden="!isCompactDetailOpen"
        aria-live="polite"
      >
        <header>
          <span>{{ selectedDetail?.cluster ? ui.clusterTitle : ui.detail }}</span>
          <div class="detail-actions">
            <button
              v-if="selectedDetail && !isLoadingDetail"
              class="detail-expand-button"
              type="button"
              :aria-label="ui.fullDetail"
              @click.stop="openFullDetail"
            >
              <span aria-hidden="true">↗</span>
              {{ ui.fullDetail }}
            </button>
            <button type="button" :aria-label="ui.closeDetail" @click.stop="closeDetail">×</button>
          </div>
        </header>

        <template v-if="selectedDetail">
          <h2>{{ detailTitle }}</h2>
          <p class="detail-subtitle">{{ detailSubtitle }}</p>
          <div v-if="selectedDetail.summaryCards?.length" class="detail-summary-grid compact">
            <article v-for="card in selectedDetail.summaryCards.slice(0, 6)" :key="card.label">
              <span>{{ card.label }}</span>
              <strong>{{ card.value }}</strong>
              <small v-if="card.note">{{ card.note }}</small>
            </article>
          </div>

          <dl class="detail-metrics">
            <div>
              <dt>{{ ui.locationPrecision }}</dt>
              <dd>{{ detailRegion ? locationPrecisionLabel(detailRegion.level) : ui.clusterCount }}</dd>
            </div>
            <div v-if="detailRegion">
              <dt>{{ ui.pndlGeomean }}</dt>
              <dd>{{ formatCompact(detailRegion.pndlGeomeanMgD1000inh) }}</dd>
            </div>
            <div v-if="detailRegion">
              <dt>{{ ui.pndlMean }}</dt>
              <dd>{{ formatCompact(detailRegion.pndlMeanMgD1000inh) }}</dd>
            </div>
            <div v-if="detailRegion">
              <dt>{{ ui.range }}</dt>
              <dd>
                {{ formatCompact(detailRegion.pndlMinMgD1000inh) }} -
                {{ formatCompact(detailRegion.pndlMaxMgD1000inh) }}
              </dd>
            </div>
            <div v-if="detailRegion">
              <dt>{{ ui.recordsAndDoi }}</dt>
              <dd>{{ formatNumber(detailRegion.recordCount) }} / {{ formatNumber(detailRegion.doiCount) }}</dd>
            </div>
            <div v-if="detailRegion">
              <dt>{{ ui.source }}</dt>
              <dd>{{ detailRegion.pndlSources || ui.noData }}</dd>
            </div>
          </dl>

          <section v-if="selectedDetail.topBiomarkers?.length" class="detail-mini-section">
            <h3>{{ ui.topBiomarkers }}</h3>
            <ol>
              <li v-for="item in selectedDetail.topBiomarkers.slice(0, 5)" :key="item.biomarkerKey">
                <strong>{{ item.biomarkerLabel }}</strong>
                <span>{{ formatNumber(item.recordCount) }} {{ ui.records }}</span>
              </li>
            </ol>
          </section>

          <section class="source-list">
            <h3>{{ ui.sourceRecords }}</h3>
            <article v-for="(source, index) in detailSources.slice(0, 6)" :key="`${source.measurementId}-${index}`">
              <strong>{{ source.biomarkerName || source.drugName }}</strong>
              <span>{{ source.country }} {{ source.province }} {{ source.city }}</span>
              <em>{{ formatCompact(source.pndlMgD1000inh) }} mg/day/1000 inh · {{ source.pndlSource }}</em>
              <small>{{ source.doi || source.sourceWorkbook || ui.sourcePending }}</small>
            </article>
            <p v-if="!detailSources.length">{{ ui.noSourceRecords }}</p>
          </section>
        </template>

        <p v-else class="drawer-message">
          {{ detailError || selectedDetail ? ui.emptyBackendDetail : filterSummary }}
        </p>
        <p v-if="detailError" class="drawer-message error">{{ detailError }}</p>
      </aside>

      <div
        v-if="isFullDetailOpen"
        class="full-detail-backdrop"
        aria-live="polite"
        @click.self="closeFullDetail"
      >
        <aside class="full-detail-panel open" aria-modal="true" role="dialog" @click.stop>
          <header>
            <div>
              <span>{{ ui.fullDetailTitle }}</span>
              <h2>{{ detailTitle }}</h2>
              <p>{{ detailSubtitle }}</p>
            </div>
            <button type="button" :aria-label="ui.closeFullDetail" @click.stop="closeFullDetail">×</button>
          </header>

          <div v-if="selectedDetail" class="full-detail-content">
          <section>
            <h3>{{ ui.summaryOverview }}</h3>
            <div class="detail-summary-grid">
              <article v-for="card in selectedDetail.summaryCards ?? []" :key="card.label">
                <span>{{ card.label }}</span>
                <strong>{{ card.value }}</strong>
                <small v-if="card.note">{{ card.note }}</small>
              </article>
            </div>
          </section>

          <section v-if="selectedDetail.pndlRanking?.length">
            <h3>{{ ui.pndlRanking }}</h3>
            <div class="detail-table">
              <div class="detail-table-row head">
                <span>#</span>
                <span>{{ ui.locationPrecision }}</span>
                <span>{{ ui.pndlGeomean }}</span>
                <span>{{ ui.recordsAndDoi }}</span>
              </div>
              <div
                v-for="item in selectedDetail.pndlRanking"
                :key="`${item.level}-${item.geoKey}`"
                class="detail-table-row"
                :class="{ selected: item.selected }"
              >
                <span>{{ item.rank }}</span>
                <strong>{{ item.displayName }}</strong>
                <span>{{ formatCompact(item.pndlGeomeanMgD1000inh) }}</span>
                <span>{{ formatNumber(item.recordCount) }} / {{ formatNumber(item.doiCount) }}</span>
              </div>
            </div>
          </section>

          <section v-if="selectedDetail.categoryBreakdown?.length">
            <h3>{{ ui.categoryBreakdown }}</h3>
            <div class="breakdown-list">
              <article v-for="item in selectedDetail.categoryBreakdown" :key="item.label">
                <span>{{ item.label }}</span>
                <strong>{{ formatNumber(item.recordCount) }}</strong>
                <i :style="{ width: `${Math.min(Number(item.percentage ?? 0), 100)}%` }"></i>
              </article>
            </div>
          </section>

          <section v-if="selectedDetail.topBiomarkers?.length">
            <h3>{{ ui.topBiomarkers }}</h3>
            <div class="detail-table">
              <div class="detail-table-row head biomarker">
                <span>biomarker</span>
                <span>CAS</span>
                <span>{{ ui.category }}</span>
                <span>{{ ui.records }}</span>
              </div>
              <div
                v-for="item in selectedDetail.topBiomarkers"
                :key="item.biomarkerKey"
                class="detail-table-row biomarker"
              >
                <strong>{{ item.biomarkerLabel }}</strong>
                <span>{{ item.biomarkerCas || ui.noData }}</span>
                <span>{{ item.category || ui.noData }}</span>
                <span>{{ formatNumber(item.recordCount) }}</span>
              </div>
            </div>
          </section>

          <section v-if="selectedDetail.locations?.length">
            <h3>{{ ui.locationsInCluster }}</h3>
            <div class="location-chip-list">
              <span v-for="item in selectedDetail.locations.slice(0, 40)" :key="`${item.level}-${item.geoKey}`">
                {{ item.displayName }}
              </span>
            </div>
          </section>

          <section>
            <h3>{{ ui.sourceRecords }}</h3>
            <div class="source-table">
              <article v-for="(source, index) in detailSources" :key="`${source.measurementId}-${index}`">
                <strong>{{ source.biomarkerName || source.drugName }}</strong>
                <span>{{ source.country }} {{ source.province }} {{ source.city }} {{ source.plantName }}</span>
                <em>{{ formatCompact(source.pndlMgD1000inh) }} mg/day/1000 inh · {{ source.pndlSource }}</em>
                <small>{{ source.doi || source.sourceWorkbook || ui.sourcePending }}</small>
              </article>
              <p v-if="!detailSources.length">{{ ui.noSourceRecords }}</p>
            </div>
          </section>
          </div>
        </aside>
      </div>
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
  align-items: center;
  gap: 10px;
  justify-content: flex-end;
}

.language-menu {
  position: relative;
}

.language-menu > button {
  height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 9px;
  border: 1px solid rgba(91, 117, 132, 0.16);
  border-radius: 8px;
  color: #173247;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.82);
  font-size: 11px;
  font-weight: 900;
  cursor: pointer;
}

.language-menu > button svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: #229384;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.language-menu.open > button {
  border-color: rgba(34, 147, 132, 0.34);
  box-shadow:
    0 0 0 3px rgba(34, 147, 132, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.82);
}

.language-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 12;
  min-width: 138px;
  display: grid;
  gap: 4px;
  padding: 6px;
  border: 1px solid rgba(91, 117, 132, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 18px 42px rgba(19, 46, 63, 0.16);
}

.language-popover button {
  height: 34px;
  border: 0;
  border-radius: 6px;
  color: #607384;
  background: transparent;
  text-align: left;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.language-popover button:hover,
.language-popover button.active {
  color: #173247;
  background: rgba(34, 147, 132, 0.1);
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
  background: #dcecf5;
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
    linear-gradient(115deg, transparent 0 35%, rgba(26, 143, 132, 0.13) 44%, transparent 53%),
    radial-gradient(circle at 18% 32%, rgba(34, 147, 132, 0.15), transparent 24%),
    radial-gradient(circle at 78% 24%, rgba(57, 125, 161, 0.1) 0 2px, transparent 2.8px),
    radial-gradient(circle at 34% 72%, rgba(34, 147, 132, 0.1) 0 1.8px, transparent 2.8px),
    repeating-linear-gradient(
      145deg,
      rgba(23, 86, 105, 0.04) 0 1px,
      transparent 1px 46px
    );
  background-size:
    620px 620px,
    760px 760px,
    380px 380px,
    520px 520px,
    430px 430px;
  mix-blend-mode: soft-light;
  opacity: 0.38;
  animation: monitorFlow 34s linear infinite;
}

.map-stage.globe {
  background: linear-gradient(180deg, #334f5e, #3d5d6b);
}

.map-stage.globe.ambience::before {
  background:
    linear-gradient(120deg, transparent 0 37%, rgba(82, 157, 156, 0.08) 45%, transparent 54%),
    radial-gradient(circle at 18% 30%, rgba(116, 185, 181, 0.12) 0 2px, transparent 3px),
    radial-gradient(circle at 72% 68%, rgba(127, 139, 222, 0.08) 0 2px, transparent 3px),
    repeating-linear-gradient(
      145deg,
      rgba(236, 252, 251, 0.052) 0 1px,
      transparent 1px 54px
    );
  background-size:
    720px 720px,
    420px 420px,
    560px 560px,
    520px 520px;
  mix-blend-mode: soft-light;
  opacity: 0.16;
  animation: monitorFlow 42s linear infinite;
}

.map-canvas {
  position: absolute;
  inset: 0;
  z-index: 0;
  animation: mapCanvasIn 0.32s ease 0.04s both;
  transition: opacity 0.18s ease;
}

.map-stage.switching .map-canvas {
  opacity: 0.35;
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

.layer-panel p {
  margin: 2px 0 0;
  padding-top: 8px;
  border-top: 1px solid rgba(91, 117, 132, 0.12);
  color: #6a7d88;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.45;
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
  gap: 10px;
  padding: 13px;
  border: 1px solid rgba(100, 121, 133, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 14px 34px rgba(19, 46, 63, 0.14);
  transition:
    opacity 0.22s ease,
    max-height 0.3s cubic-bezier(0.2, 0.78, 0.18, 1),
    transform 0.3s cubic-bezier(0.2, 0.78, 0.18, 1);
  backdrop-filter: blur(16px);
}

.filter-head {
  min-width: 0;
  display: grid;
  gap: 3px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(91, 117, 132, 0.1);
}

.filter-head strong {
  color: #173247;
  font-size: 14px;
  font-weight: 950;
}

.filter-head small {
  overflow: hidden;
  color: #6a7d88;
  font-size: 11px;
  font-weight: 800;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.map-message.notice {
  color: #715017;
  background: rgba(255, 248, 223, 0.96);
}

.map-message.loading {
  color: #173247;
}

.boundary-loading-chip {
  position: absolute;
  left: 18px;
  bottom: 58px;
  z-index: 3;
  margin: 0;
  padding: 7px 10px;
  border: 1px solid rgba(91, 117, 132, 0.12);
  border-radius: 999px;
  color: #365061;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 10px 24px rgba(19, 46, 63, 0.12);
  font-size: 11px;
  font-weight: 850;
  pointer-events: none;
  backdrop-filter: blur(14px);
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
  gap: 12px;
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
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

.detail-drawer .detail-expand-button {
  width: auto;
  min-width: 92px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  color: #ffffff;
  background: #173247;
  border-color: rgba(23, 50, 71, 0.2);
  font-size: 12px;
  font-weight: 900;
}

.detail-drawer h2,
.source-list h3 {
  margin: 0;
}

.detail-drawer h2 {
  font-size: 23px;
}

.detail-subtitle {
  margin: -8px 0 0;
  color: #617386;
  font-size: 13px;
  font-weight: 800;
}

.detail-summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.detail-summary-grid.compact {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.detail-summary-grid article {
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(91, 117, 132, 0.14);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(246, 250, 252, 0.92), rgba(255, 255, 255, 0.92));
}

.detail-summary-grid span,
.detail-summary-grid small {
  display: block;
  color: #6a7b8b;
  font-size: 11px;
  font-weight: 800;
}

.detail-summary-grid strong {
  display: block;
  margin-top: 4px;
  color: #173247;
  font-size: 18px;
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

.detail-mini-section {
  display: grid;
  gap: 8px;
}

.detail-mini-section h3 {
  margin: 0;
  font-size: 15px;
}

.detail-mini-section ol {
  display: grid;
  gap: 7px;
  margin: 0;
  padding-left: 18px;
}

.detail-mini-section li {
  color: #526778;
  font-size: 13px;
}

.detail-mini-section li strong {
  color: #173247;
}

.detail-mini-section li span {
  margin-left: 6px;
}

.full-detail-backdrop {
  position: absolute;
  inset: 0;
  z-index: 12;
  display: grid;
  place-items: center;
  padding: 42px;
  background: rgba(9, 28, 44, 0.22);
  backdrop-filter: blur(3px);
  animation: detail-backdrop-in 0.2s ease both;
}

.full-detail-panel {
  width: min(960px, calc(100vw - 80px));
  max-width: calc(100% - 44px);
  height: min(760px, calc(100vh - 112px));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgba(91, 117, 132, 0.18);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 28px 76px rgba(19, 46, 63, 0.24);
  opacity: 0;
  pointer-events: auto;
  transform: translateY(10px) scale(0.985);
  transform-origin: center;
  transition:
    transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 0.22s ease;
  backdrop-filter: blur(18px);
}

.full-detail-panel.open {
  opacity: 1;
  transform: translateY(0) scale(1);
}

@keyframes detail-backdrop-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.full-detail-panel header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid rgba(91, 117, 132, 0.14);
  background: linear-gradient(90deg, rgba(232, 248, 249, 0.74), rgba(255, 255, 255, 0.86));
}

.full-detail-panel header span {
  color: #0f8b8d;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
}

.full-detail-panel header h2,
.full-detail-panel header p {
  margin: 0;
}

.full-detail-panel header h2 {
  margin-top: 4px;
  color: #173247;
  font-size: 25px;
}

.full-detail-panel header p {
  margin-top: 5px;
  color: #647789;
  font-weight: 800;
}

.full-detail-panel header button {
  width: 36px;
  height: 36px;
  border: 1px solid rgba(91, 117, 132, 0.22);
  border-radius: 8px;
  color: #173247;
  background: #ffffff;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}

.full-detail-content {
  display: grid;
  gap: 18px;
  padding: 18px 22px 24px;
  overflow: auto;
}

.full-detail-content section {
  display: grid;
  gap: 10px;
}

.full-detail-content h3 {
  margin: 0;
  color: #173247;
  font-size: 16px;
}

.detail-table {
  display: grid;
  overflow: hidden;
  border: 1px solid rgba(91, 117, 132, 0.14);
  border-radius: 8px;
}

.detail-table-row {
  display: grid;
  grid-template-columns: 52px minmax(160px, 1.2fr) minmax(120px, 0.7fr) minmax(120px, 0.6fr);
  gap: 12px;
  align-items: center;
  min-height: 42px;
  padding: 8px 12px;
  border-top: 1px solid rgba(91, 117, 132, 0.1);
  color: #4e6173;
  font-size: 13px;
  font-weight: 800;
}

.detail-table-row:first-child {
  border-top: 0;
}

.detail-table-row.head {
  color: #637789;
  background: #f3f7f9;
  font-size: 12px;
}

.detail-table-row.selected {
  background: rgba(79, 70, 229, 0.08);
}

.detail-table-row.biomarker {
  grid-template-columns: minmax(180px, 1.2fr) 110px minmax(140px, 0.8fr) 80px;
}

.breakdown-list {
  display: grid;
  gap: 8px;
}

.breakdown-list article {
  position: relative;
  min-height: 38px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  overflow: hidden;
  padding: 8px 10px;
  border: 1px solid rgba(91, 117, 132, 0.12);
  border-radius: 8px;
  background: #f7fafb;
}

.breakdown-list article i {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 0;
  display: block;
  background: linear-gradient(90deg, rgba(100, 120, 255, 0.2), rgba(100, 120, 255, 0.06));
}

.breakdown-list article span,
.breakdown-list article strong {
  position: relative;
  z-index: 1;
  font-weight: 900;
}

.location-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.location-chip-list span {
  padding: 6px 9px;
  border: 1px solid rgba(100, 120, 255, 0.22);
  border-radius: 999px;
  color: #38415c;
  background: rgba(100, 120, 255, 0.08);
  font-size: 12px;
  font-weight: 900;
}

.source-table {
  display: grid;
  gap: 9px;
}

.source-table article {
  display: grid;
  gap: 4px;
  padding: 12px;
  border: 1px solid rgba(91, 117, 132, 0.14);
  border-radius: 8px;
  background: #ffffff;
}

.source-table article strong {
  color: #173247;
}

.source-table article span,
.source-table article small {
  color: #647789;
}

.source-table article em {
  color: #33465b;
  font-style: normal;
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

:deep(.maplibregl-popup-content strong) {
  color: #312e81;
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

@keyframes monitorFlow {
  from {
    background-position:
      0 0,
      0 0,
      0 0,
      0 0,
      0 0;
  }

  to {
    background-position:
      720px 0,
      -240px 180px,
      210px -180px,
      -260px 220px,
      430px 430px;
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
    grid-template-columns: auto 1fr auto;
    gap: 14px;
  }

  .header-center {
    justify-self: end;
  }

  .page-title {
    font-size: 20px;
  }

  .login-button {
    padding: 0 12px;
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

  .header-tools {
    justify-content: flex-start;
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

  .full-detail-backdrop {
    padding: 12px;
    place-items: end center;
  }

  .full-detail-panel {
    width: 100%;
    max-width: none;
    height: min(78vh, calc(100vh - 24px));
    transform: translateY(18px) scale(0.992);
    transform-origin: bottom center;
  }

  .full-detail-panel.open {
    transform: translateY(0) scale(1);
  }

  .full-detail-panel header {
    padding: 16px;
  }

  .full-detail-content {
    padding: 14px 16px 18px;
  }

  .detail-summary-grid,
  .detail-summary-grid.compact {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .detail-table-row,
  .detail-table-row.biomarker {
    grid-template-columns: 42px minmax(120px, 1fr) minmax(88px, 0.7fr);
  }

  .detail-table-row span:nth-child(4),
  .detail-table-row.biomarker span:nth-child(4) {
    display: none;
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
