<script setup lang="ts">
import 'maplibre-gl/dist/maplibre-gl.css'

import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { MapFilterSelectOption } from '../components/MapFilterSelect.vue'
import MapFilterPanel from '../components/map/MapFilterPanel.vue'
import MapPageHeader from '../components/map/MapPageHeader.vue'
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
  MapPndlComparison,
  MapPndlRankingItem,
  MapRegionStat,
  MapReportedSite,
  MapSourceRecord,
  MapSummaryCard,
  MapStatsResponse,
  MapTopBiomarker,
  MapTrendSeries,
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
import {
  biomarkerExplorerMetricKeys,
  canExploreBiomarker,
  compactExplorerSummaryCards,
  countryLabelStyleForArea,
  declutterScreenSpaceCandidates,
  detailFilterContext,
  displayLevelForZoom,
  excludeUnassignedCityRows,
  excludeGeometryFromFilter,
  firstActiveRegionCandidate,
  heatRegionLevelForDisplayLevel,
  isMainlandChinaCity,
  isUnassignedAdmin1GeoKey,
  isUnassignedGeoKey,
  overviewSummaryCards,
  pndlChartAxisTicks,
  pndlChartScalePercent,
  pndlComparisonsForRegion,
  progressiveDeclutterGap,
  regionFillOpacityExpression,
  resolveStableHeatRange,
  selectRowsForDisplayLevel,
  selectionYearRange,
  sortBiomarkersByLiterature,
  temperatureBandIndex,
  usesCompactHeatFootprint,
  visibleLevelsForZoom,
} from '../utils/mapVisualization'
import {
  boundaryCollectionForParents,
  filterBoundaryFeatures,
  polygonBoundariesToLines,
  visibleParentGeoKeys,
} from '../utils/mapBoundaryGeometry'
import { probePmtilesRange } from '../utils/pmtiles'
import { getUserErrorMessage } from '../services/errors'
import {
  buildPreviewBasemapLayers,
  PREVIEW_ADMIN1_LEVEL_END,
  PREVIEW_BOUNDARY_LAYER_IDS,
  PREVIEW_COUNTRY_LEVEL_END,
  PREVIEW_LABEL_LAYER_IDS,
  PREVIEW_LABEL_LAYER_IDS_BY_LEVEL,
  PREVIEW_MAP_MAX_ZOOM,
  PREVIEW_MAP_MIN_ZOOM,
} from '../utils/previewBasemapStyle'
import {
  CITY_LEVEL_ENTER_ZOOM,
  CITY_LEVEL_EXIT_ZOOM,
  nearestWorldCopyCoordinate,
  nextMapDisplayLevel,
  wrappedWorldMinZoom,
  type MapRenderPhase,
} from '../utils/mapRuntime'
import {
  PREVIEW_REGION_POLYGON_SOURCE_LAYER,
  scheduleProgressiveFeatureState,
  vectorRegionFillColorExpression,
  vectorRegionFillOpacityExpression,
  type ProgressiveFeatureState,
} from '../utils/mapBusinessLayers'
import {
  approximateMapLabelWidth,
  businessLabelSizeAtZoom,
  businessLabelTextSizeExpression,
  labelBaseSize,
  labelCountTier,
  labelScaleForPointCount,
  MAP_POINT_COUNT_THRESHOLDS,
} from '../utils/mapLabelTypography'

type MapMode = 'globe' | 'flat'
type DetailMode = 'none' | 'compact' | 'full'
type DetailOrigin = 'none' | 'region' | 'cluster'
type BasemapMode = 'vector' | 'geojson'
type RegionSourceMode = 'vector' | 'geojson'
type MapDisplayLevel = 'country' | 'admin1' | 'city'
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
type BoundaryFeatureIndex = {
  collection: FeatureCollection
  exact: Map<string, GeoJsonFeature>
  aliases: Map<string, GeoJsonFeature>
}
type CachedFeatureCollection = {
  stats: MapStatsResponse | null
  boundaryVersion: number
  locale: Locale
  level: MapDisplayLevel
  specificBiomarker?: boolean
  layoutKey?: string
  collection: FeatureCollection
}
type BoundaryHitIndex = {
  boundaryVersion: number
  items: Array<{
    feature: GeoJsonFeature
    bbox: [number, number, number, number]
  }>
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
type RegionIndexEntry = {
  level: MapRegionStat['level']
  geo_key: string
  parent_geo_key: string
  country_key: string
  display_name: string
  name?: string
  center: [number, number]
  label_point?: [number, number]
  area?: number
  bbox: [number, number, number, number]
}
type RegionIdentity = {
  level: MapRegionStat['level']
  geoKey: string
  displayLevel?: MapDisplayLevel
}
type MapStatus = {
  latitude: number
  longitude: number
  country: string
  mode: 'center' | 'cursor'
}
type PndlColumnTooltipState = {
  visible: boolean
  key: string
  title: string
  label: string
  value: string
  metrics: Array<{ label: string; value: string }>
  x: number
  y: number
}
type BasemapConfig =
  | { mode: 'geojson'; regionSourceUrl?: string }
  | {
      mode: 'vector'
      styleSourceUrl: string
      regionSourceUrl?: string
      layers: unknown[]
      glyphs: string
    }

const EMPTY_COLLECTION: FeatureCollection = { type: 'FeatureCollection', features: [] }
const BASEMAP_PM_TILES_URL =
  import.meta.env.VITE_BASEMAP_PM_TILES_URL || '/tiles/wbe-preview-composite.pmtiles'
const REGION_INDEX_URL = '/geo/render/region-index.json'
const SPECIAL_ADMIN_URL = '/geo/render/china-special-admin-envelopes.geojson'
const SPECIAL_ADMIN_LINE_URL = '/geo/render/china-special-admin-envelopes-lines.geojson'
const BASEMAP_GLYPHS_URL =
  import.meta.env.VITE_BASEMAP_GLYPHS_URL || '/tiles/fonts/{fontstack}/{range}.pbf'
// The composite PMTiles is the sole visual map. Local GeoJSON remains the
// interaction authority for search, hit testing, selection and aggregation.
const USE_LOCAL_PM_TILES_BASEMAP = true
const REGION_VECTOR_SOURCE_ID = 'protomaps'
const REGION_VECTOR_SOURCE_LAYER = PREVIEW_REGION_POLYGON_SOURCE_LAYER
const REGION_VECTOR_LINE_SOURCE_LAYER = 'preview_region_display_outlines'
const PREVIEW_REGION_OUTLINE_SOURCE_LAYER = 'preview_region_display_outlines'
const PREVIEW_REGION_OUTLINE_LAYER_IDS = [
  'preview-region-selected-halo',
  'preview-region-selected-line',
  'preview-region-hover-line',
] as const
const BOUNDARY_URLS: Record<BoundaryName, string> = {
  countries: '/geo/render/world-countries.geojson',
  admin1: '/geo/render/world-admin1.geojson',
  chinaProvinces: '/geo/render/china-provinces.geojson',
  chinaCities: '/geo/render/china-cities.geojson',
}
const BOUNDARY_LINE_URLS: Record<BoundaryName, string> = {
  countries: '/geo/render/world-countries-lines.geojson',
  admin1: '/geo/render/world-admin1-lines.geojson',
  chinaProvinces: '/geo/render/china-provinces-lines.geojson',
  chinaCities: '/geo/render/china-cities-lines.geojson',
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
const ALL_BIOMARKER_LABEL = '全部生物标记物'
const ALL_YEAR_LABEL = DEFAULT_SELECTION.year
const SPECIAL_ADMIN_SEARCH_ALIASES: Record<string, string[]> = {
  'china|hongkong': ['香港', 'Hong Kong', 'HongKong'],
  'china|aomen': ['澳门', 'Macao', 'Macau', 'Aomen'],
}
const REGION_HOVER_PRIORITY_LAYERS = [
  'region-city-selected-fill',
  'region-city-data-fill',
  'region-city-selected-line',
  'region-city-data-line',
  'region-selected-fill',
  'region-data-fill',
  'region-selected-line',
  'region-data-line',
  'wbe-city-boundary-hit',
  'wbe-admin1-boundary-hit',
  'wbe-country-boundary-hit',
] as const
const POINT_INTERACTIVE_LAYERS = [
  'pndl-special-admin-bubble-icons',
  'pndl-special-admin-bubble-count',
  'pndl-country-bubble-icons',
  'pndl-country-bubble-count',
  'pndl-admin1-bubble-icons',
  'pndl-admin1-bubble-count',
  'pndl-city-bubble-icons',
  'pndl-city-bubble-count',
] as const
const FLAT_CENTER: [number, number] = [104, 35]
const FLAT_INITIAL_ZOOM = 1.75
const FLAT_MIN_ZOOM = PREVIEW_MAP_MIN_ZOOM
const VECTOR_MAX_ZOOM = PREVIEW_MAP_MAX_ZOOM
const FALLBACK_MAX_ZOOM = 9.2
const GLOBE_MIN_ZOOM = 2.64
const GLOBE_INITIAL_ZOOM = 2.66
const FLAT_BACKGROUND_COLOR = '#d7e0e4'
const GLOBE_BACKGROUND_COLOR = '#d7e0e4'
const LEVEL_FADE_COUNTRY_START = PREVIEW_COUNTRY_LEVEL_END
const LEVEL_FADE_COUNTRY_END = PREVIEW_COUNTRY_LEVEL_END
const LEVEL_FADE_CITY_START = CITY_LEVEL_ENTER_ZOOM
const LEVEL_FADE_CITY_END = CITY_LEVEL_ENTER_ZOOM
const CITY_BOUNDARY_MIN_ZOOM = 6.1
const COUNTRY_BOUNDARY_FADE_START = 5.2
const COUNTRY_BOUNDARY_FADE_END = 5.8
const VECTOR_REGION_FADE_START_ZOOM = 4.65
const VECTOR_REGION_FADE_END_ZOOM = 5.25
const DENSE_POINT_RADIUS_DEGREES = 38
const COUNTRY_STATUS_UPDATE_DELAY = 280
const LABEL_LAYER_IDS = [
  'wbe-country-label',
  'wbe-admin1-label',
  'wbe-city-label',
  'continent-label',
  'country-label',
  'admin1-label',
  'china-province-label',
  'china-special-admin-label',
  'china-city-label',
] as const
const BOUNDARY_LAYER_IDS = [
  'wbe-country-boundary',
  'wbe-admin1-boundary',
  'wbe-city-boundary',
  'country-line',
  'admin1-line',
  'china-province-line',
  'china-active-province-line',
  'china-city-line',
  'china-special-admin-line',
] as const
const REGION_HIGHLIGHT_LAYER_IDS = [
  'region-data-fill',
  'region-data-line',
  'region-city-data-fill',
  'region-city-data-line',
  'region-selected-fill',
  'region-selected-halo',
  'region-selected-line',
  'region-city-selected-fill',
  'region-city-selected-line',
  'region-hover-fill',
  'region-hover-line',
  'region-city-hover-fill',
  'region-city-hover-line',
  ...PREVIEW_REGION_OUTLINE_LAYER_IDS,
] as const
const REGION_FILL_LAYER_IDS = [
  'region-data-fill',
  'region-city-data-fill',
  'region-selected-fill',
  'region-city-selected-fill',
  'region-hover-fill',
  'region-city-hover-fill',
] as const
const REGION_LINE_LAYER_IDS = [
  'region-data-line',
  'region-city-data-line',
  'region-selected-halo',
  'region-selected-line',
  'region-city-selected-line',
  'region-hover-line',
  'region-city-hover-line',
] as const
const MAP_DISPLAY_LEVELS = ['country', 'admin1', 'city'] as const
const PNDL_LAYER_IDS = MAP_DISPLAY_LEVELS.flatMap((level) => [
  `pndl-${level}-heat-footprint`,
  `pndl-${level}-bubble-icons`,
  `pndl-${level}-selected-ring`,
  `pndl-${level}-bubble-count`,
  `pndl-${level}-point-labels`,
]).concat([
  'pndl-special-admin-bubble-icons',
  'pndl-special-admin-selected-ring',
  'pndl-special-admin-bubble-count',
  'pndl-special-admin-point-labels',
])
const MAP_LOCALE_STORAGE_KEY = 'wbe.map.locale'
const BOUNDARY_NOISE_AREA_THRESHOLDS: Record<BoundaryName, number> = {
  countries: 0.08,
  admin1: 0.018,
  chinaProvinces: 0.01,
  chinaCities: 0.08,
}
const MAP_HIGHLIGHT_STYLE = {
  dataFill: '#eef0f0',
  coverageFill: '#b8c8d1',
  dataLine: '#7b858b',
  hoverFill: '#eef0f0',
  hoverLine: '#3e5967',
  selectedFill: '#eef0f0',
  selectedLine: '#173f55',
  selectedHalo: '#ffffff',
  bubble: '#4f8bc9',
  bubbleHover: '#2f73b7',
  bubbleSelected: '#174f8a',
  bubbleLine: '#2e669f',
  bubbleHoverLine: '#1d568f',
  bubbleSelectedLine: '#123e6f',
  bubbleSelectedOuter: '#ffffff',
} as const
const MAP_HEAT_COLORS = ['#ffff8c', '#fdae61', '#f46d43', '#d73027'] as const
const BUBBLE_IMAGE_BUCKETS: Record<MapDisplayLevel, readonly number[]> = {
  country: [28, 38, 52, 68, 82],
  admin1: [18, 25, 34, 45, 58],
  city: [14, 18, 25, 32, 40],
} as const
const BUBBLE_COUNT_THRESHOLDS = MAP_POINT_COUNT_THRESHOLDS
const BUBBLE_COUNT_TEXT_SIZES: Record<
  MapDisplayLevel,
  readonly [number, number, number, number, number]
> = {
  country: [9.8, 11.2, 12.6, 14, 15.2],
  admin1: [8.8, 9.8, 11, 12.2, 13.4],
  city: [8.2, 9, 9.8, 10.8, 11.8],
} as const
const BUBBLE_LABEL_CLEARANCE_PX = 10
const BUBBLE_OFFSET_SCALES: Record<MapDisplayLevel, readonly number[]> = {
  country: [0.6, 0.68, 0.74, 0.8, 1],
  admin1: [1],
  city: [1],
}
const BUBBLE_HEAT_COLORS = [MAP_HIGHLIGHT_STYLE.dataFill, ...MAP_HEAT_COLORS] as const
const DENSE_EUROPE_BUBBLE_BOUNDS = [-12, 35, 35, 72] as const
type BubblePinVariant = 'overview' | 'biomarker' | 'unassigned'
type BubblePinPalette = {
  top: string
  middle: string
  bottom: string
  highlight: string
  text: string
  stroke: string
  shadow: string
}
const BUBBLE_PIN_PALETTES: Record<BubblePinVariant, BubblePinPalette> = {
  overview: {
    top: '#b7ddf7',
    middle: '#6bafe0',
    bottom: '#347fbd',
    highlight: 'rgba(236, 248, 255, 0.76)',
    text: '#123f65',
    stroke: 'rgba(35, 101, 154, 0.82)',
    shadow: 'rgba(31, 82, 122, 0.2)',
  },
  biomarker: {
    top: '#ffe29a',
    middle: '#f7ad65',
    bottom: '#eb714b',
    highlight: 'rgba(255, 247, 221, 0.7)',
    text: '#6d321f',
    stroke: 'rgba(181, 75, 44, 0.82)',
    shadow: 'rgba(134, 58, 38, 0.2)',
  },
  unassigned: {
    top: '#d7e1e7',
    middle: '#94a9b7',
    bottom: '#617b8c',
    highlight: 'rgba(247, 250, 252, 0.78)',
    text: '#263f4f',
    stroke: 'rgba(73, 101, 119, 0.84)',
    shadow: 'rgba(42, 65, 78, 0.18)',
  },
} as const
const CHINA_COUNTRY_ALIASES = new Set([
  'china',
  '中国',
  'hongkong',
  'hongkongsar',
  'hongkongchina',
  'hongkongregion',
  'hongkongspecialadministrativeregion',
  'hksar',
  '香港',
  '香港特别行政区',
  'macau',
  'macao',
  'macausar',
  'macaosar',
  'macaospecialadministrativeregion',
  '澳门',
  '澳门特别行政区',
  'taiwan',
  '台湾',
  '臺灣',
])
const SPECIAL_ADMIN_GEO_KEYS = new Set(['china|hongkong', 'china|aomen'])
const CONTINENT_LABELS = [
  { key: 'asia', zh: '亚洲', en: 'Asia', coordinates: [90, 45] },
  { key: 'europe', zh: '欧洲', en: 'Europe', coordinates: [15, 54] },
  { key: 'africa', zh: '非洲', en: 'Africa', coordinates: [20, 2] },
  { key: 'north-america', zh: '北美洲', en: 'North America', coordinates: [-102, 50] },
  { key: 'south-america', zh: '南美洲', en: 'South America', coordinates: [-60, -16] },
  { key: 'oceania', zh: '大洋洲', en: 'Oceania', coordinates: [135, -25] },
  { key: 'antarctica', zh: '南极洲', en: 'Antarctica', coordinates: [20, -82] },
] as const
const CHINA_ADMIN1_ZH_NAMES: Record<string, string> = {
  'china|anhui': '安徽省',
  'china|beijing': '北京市',
  'china|chongqing': '重庆市',
  'china|fujian': '福建省',
  'china|gansu': '甘肃省',
  'china|guangdong': '广东省',
  'china|guangxi': '广西壮族自治区',
  'china|guizhou': '贵州省',
  'china|hainan': '海南省',
  'china|hebei': '河北省',
  'china|heilongjiang': '黑龙江省',
  'china|henan': '河南省',
  'china|hong-kong': '香港特别行政区',
  'china|hongkong': '香港特别行政区',
  'china|hubei': '湖北省',
  'china|hunan': '湖南省',
  'china|inner-mongolia': '内蒙古自治区',
  'china|neimenggu': '内蒙古自治区',
  'china|jiangsu': '江苏省',
  'china|jiangxi': '江西省',
  'china|jilin': '吉林省',
  'china|liaoning': '辽宁省',
  'china|macau': '澳门特别行政区',
  'china|aomen': '澳门特别行政区',
  'china|ningxia': '宁夏回族自治区',
  'china|qinghai': '青海省',
  'china|shaanxi': '陕西省',
  'china|shandong': '山东省',
  'china|shanghai': '上海市',
  'china|shanxi': '山西省',
  'china|sichuan': '四川省',
  'china|tianjin': '天津市',
  'china|tibet': '西藏自治区',
  'china|xizang': '西藏自治区',
  'china|xinjiang': '新疆维吾尔自治区',
  'china|yunnan': '云南省',
  'china|zhejiang': '浙江省',
} as const
const UI_TEXT = {
  zh: {
    brandHome: '污水信息因子数据库首页',
    brandTitle: '污水信息因子数据库',
    brandSubtitle: 'Wastewater Biomarker Evidence',
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
    boundariesLayer: '边界线',
    pndlLayer: 'PNDL 气泡',
    coverageNote:
      '覆盖说明：世界底图含国家和部分省州，中国含城市边界；PNDL 只显示后端数据库中可映射的位置。',
    filterTitle: '筛选条件',
    filterOptionSearch: '搜索选项',
    filterOptionEmpty: '没有匹配选项',
    targetClass: '目标类别',
    allTargetClasses: '全部',
    allCategories: '全部',
    category: '物质类别',
    subcategory: '物质子类',
    biomarker: '生物标记物',
    year: '年份',
    refresh: '刷新',
    refreshing: '刷新中',
    resetFilters: '重置',
    collapseFilters: '收起筛选条件',
    expandFilters: '展开筛选条件',
    loadingFilters: '正在加载筛选项',
    loadingStats: '正在更新地图数据',
    mapInitFailed: '地图初始化失败',
    filterLoadFailed: '筛选项加载失败',
    statsLoadFailed: '地图统计加载失败',
    detailLoadFailed: '详情加载失败',
    detailExploreTitle: '生物标记物探索',
    detailExploreNote:
      '点击生物标记物会同步筛选条件并刷新地图；无 PNDL 时仍展示数据覆盖轮廓和气泡。',
    detailExploreEmpty: '当前筛选下该区域没有可展示的生物标记物。',
    pndlRegionAvailable: '有 PNDL 区域',
    pndlRegionUnavailable: '暂无 PNDL',
    clickExploreHint: '单击探索生物标记物 · 双击查看详情',
    clusterClickHint: '单击探索聚合 · 双击查看详情',
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
    pndlComparison: 'PNDL 区域对比',
    unassignedCountryComparison: '未定位数据（按所属国家的国家级口径比较）',
    pndlChartNeedsBiomarker:
      'PNDL 对比需要先选择具体生物标记物，避免把不同物质的负荷水平混在一起比较。',
    pndlChartNoData: '当前筛选下没有可用于对比的 PNDL 数据。',
    pndlLogScale: '对数尺度',
    unassignedCountryComparisonInsufficient:
      '当前筛选仅有一个国家具备同口径 PNDL，暂不构成跨国比较；下方概览仍为该未定位数据本身。',
    clusterOverview: '聚合位置概览',
    categoryBreakdown: '目标类别构成',
    topBiomarkers: '主要生物标记物',
    locationsInCluster: '聚合位置',
    backendBasemapFallback: '高质量底图未加载，已使用简化底图',
    locationPrecision: '位置精度',
    pndlMedian: 'PNDL',
    range: '范围',
    recordsAndDoi: '记录/文献',
    source: '来源',
    noData: '无数据',
    sourceRecords: '来源记录',
    reportedSites: '采样点位明细',
    siteIdentity: '点位身份',
    siteName: '报告名称',
    siteLinkStatus: '关联状态',
    siteCoverage: '覆盖记录',
    inheritedBoundaryWarning: '该边界颜色继承自上级区域，数据未定位到当前层级',
    noSourceRecords: '暂无来源记录',
    sourcePending: '来源待补充',
    sourceLocation: '位置',
    sourceSample: '采样 / 点位',
    sourceMetric: '已有指标',
    sourceReference: '文献 / 来源',
    coverageWithoutPndl:
      '当前区域有覆盖数据，但没有可换算的做图 PNDL。其他已有指标和来源记录仍在下方展示。',
    loadingDetail: '正在加载详情',
    allBiomarkers: '全部',
    allSubcategories: '全部',
    allYears: '全部',
    unspecifiedYear: '未标注年份',
    cityPrecision: '城市级位置',
    adminPrecision: '省州级位置',
    countryPrecision: '国家级位置',
    unnamedRegion: '未命名区域',
    clusterTitle: 'PNDL 位置聚合',
    clusterCount: '合并位置',
    clusterHint: '双击查看详情',
    noPndlForSelection: '当前筛选无 PNDL 数据',
    heatLegendTitle: 'PNDL 水平',
    heatLegendLow: '低',
    heatLegendMedium: '中',
    heatLegendHigh: '高',
    heatLegendNote: '黄 → 红：PNDL 由低到高',
    heatLegendCoverageOnly: '有数据，无可换算 PNDL',
    heatLegendUnit: 'mg/day/1000 inh',
    pndlTrend: 'PNDL 年度趋势',
    annualTrends: '年度趋势',
    physicochemicalProperties: 'biomarker 理化性质',
    dataNotes: '数据说明',
    dataNotePndl: 'PNDL 对比仅在选择具体生物标记物后展示；年度趋势节点使用同年同单位数据的中位数。',
    dataNoteBubble:
      '点位数按文献报告的污水厂/采样点位计算；当前版本不执行跨文献自动合并，confirmed_site_id 仅作为人工核查候选。',
    dataNoteCoverage:
      '国家、省/州、市的点位、文献、记录和 biomarker 数均按当前区域与筛选条件重新统计。',
    points: '采样点位',
    cities: '城市',
    records: '记录数',
    literature: '文献数',
    annualMedian: '年度中位数',
    dataRows: '数据行',
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
    boundariesLayer: 'Boundaries',
    pndlLayer: 'PNDL bubbles',
    coverageNote:
      'Coverage: the world basemap includes countries and selected admin-1 areas; China includes city boundaries. PNDL points only show mappable backend records.',
    filterTitle: 'Filters',
    filterOptionSearch: 'Search options',
    filterOptionEmpty: 'No matching option',
    targetClass: 'Target class',
    allTargetClasses: 'All',
    allCategories: 'All',
    category: 'Substance category',
    subcategory: 'Substance subclass',
    biomarker: 'biomarker',
    year: 'Year',
    refresh: 'Refresh',
    refreshing: 'Refreshing',
    resetFilters: 'Reset',
    collapseFilters: 'Collapse filters',
    expandFilters: 'Expand filters',
    loadingFilters: 'Loading filters',
    loadingStats: 'Updating map data',
    mapInitFailed: 'Map initialization failed',
    filterLoadFailed: 'Failed to load filters',
    statsLoadFailed: 'Failed to load map statistics',
    detailLoadFailed: 'Failed to load detail',
    detailExploreTitle: 'biomarker explorer',
    detailExploreNote:
      'Selecting a biomarker updates the filters and map. Biomarkers without PNDL still show coverage outlines and bubbles.',
    detailExploreEmpty: 'No biomarker is available for this region under the current filters.',
    pndlRegionAvailable: 'PNDL available',
    pndlRegionUnavailable: 'No PNDL',
    clickExploreHint: 'Click to explore biomarker · double-click for full detail',
    clusterClickHint: 'Click to explore cluster · double-click for full detail',
    boundaryLoadFailed: 'Some boundaries failed to load; available layers remain visible',
    boundaryLoading: 'Loading map detail',
    noFilterData:
      'Map filters are empty. Please refresh map_pndl_stats and confirm it contains mappable PNDL data.',
    noStatsData:
      'No mappable PNDL data for the current filters. Adjust filters or check location matching.',
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
    pndlComparison: 'PNDL comparison',
    unassignedCountryComparison: 'Unassigned data (compared at its parent country level)',
    pndlChartNeedsBiomarker:
      'Choose one biomarker first so PNDL values are not mixed across substances.',
    pndlChartNoData: 'No PNDL data is available for comparison under the current filters.',
    pndlLogScale: 'Log scale',
    unassignedCountryComparisonInsufficient:
      'Only one country has comparable PNDL under these filters, so no cross-country comparison is shown. The overview below still describes the unassigned records.',
    clusterOverview: 'Cluster overview',
    categoryBreakdown: 'Category breakdown',
    topBiomarkers: 'Top biomarker',
    locationsInCluster: 'Cluster locations',
    backendBasemapFallback: 'High-quality basemap is unavailable; simplified basemap is active',
    locationPrecision: 'Location precision',
    pndlMedian: 'PNDL',
    range: 'Range',
    recordsAndDoi: 'Records / DOI',
    source: 'Source',
    noData: 'No data',
    sourceRecords: 'Source records',
    reportedSites: 'Reported sampling sites',
    siteIdentity: 'Site identity',
    siteName: 'Reported name',
    siteLinkStatus: 'Link status',
    siteCoverage: 'Records covered',
    inheritedBoundaryWarning:
      'This boundary inherits its color from the parent region because the data is not located at this level',
    noSourceRecords: 'No source records',
    sourcePending: 'Source pending',
    sourceLocation: 'Location',
    sourceSample: 'Sample / site',
    sourceMetric: 'Available metric',
    sourceReference: 'Literature / source',
    coverageWithoutPndl:
      'This region has coverage data but no convertible plot PNDL. Other available metrics and source records remain visible below.',
    loadingDetail: 'Loading detail',
    allBiomarkers: 'All',
    allSubcategories: 'All',
    allYears: 'All',
    unspecifiedYear: 'Unspecified year',
    cityPrecision: 'City-level location',
    adminPrecision: 'Admin-1 location',
    countryPrecision: 'Country-level location',
    unnamedRegion: 'Unnamed region',
    clusterTitle: 'PNDL location cluster',
    clusterCount: 'Merged locations',
    clusterHint: 'Double-click for details',
    noPndlForSelection: 'No PNDL data for the current filters',
    heatLegendTitle: 'PNDL level',
    heatLegendLow: 'Low',
    heatLegendMedium: 'Medium',
    heatLegendHigh: 'High',
    heatLegendNote: 'Yellow → red: lower to higher PNDL',
    heatLegendCoverageOnly: 'Data coverage, no convertible PNDL',
    heatLegendUnit: 'mg/day/1000 inh',
    pndlTrend: 'PNDL yearly trend',
    annualTrends: 'Yearly trends',
    physicochemicalProperties: 'Biomarker properties',
    dataNotes: 'Data notes',
    dataNotePndl:
      'PNDL comparison requires a specific biomarker; yearly trend points use same-unit annual medians.',
    dataNoteBubble:
      'Sites follow literature-reported wastewater plants or sampling points. This release never auto-merges across papers; confirmed_site_id remains a review candidate only.',
    dataNoteCoverage:
      'Country, state/province, and city counts are recalculated for the current region and filters.',
    points: 'Reported sites',
    cities: 'Cities',
    records: 'Records',
    literature: 'Literature',
    annualMedian: 'Annual median',
    dataRows: 'Data rows',
  },
} as const

const BACKEND_LABEL_TRANSLATIONS: Record<Locale, Record<string, string>> = {
  zh: {
    UNASSIGNED_ADMIN1: '未定位到省州',
    UNASSIGNED_CITY: '未定位到城市',
    'biomarker 数': '生物标记物数',
  },
  en: {
    UNASSIGNED_ADMIN1: 'Unassigned to state/province',
    UNASSIGNED_CITY: 'Unassigned to city',
    'PNDL 聚合详情': 'PNDL cluster detail',
    'PNDL 详情': 'PNDL detail',
    PNDL年度趋势: 'PNDL yearly trend',
    位置数: 'Locations',
    点位数: 'Sites',
    文献数: 'Literature',
    记录数: 'Records',
    'biomarker 数': 'Biomarkers',
    'PNDL 范围': 'PNDL range',
    PNDL年份数: 'PNDL years',
    年份范围: 'Year range',
    城市数: 'Cities',
    当前区域覆盖年份: 'Years covered by the current region',
    涉及城市数: 'Cities',
    当前PNDL: 'Current PNDL',
    '当前 PNDL': 'Current PNDL',
    同层PNDL排名: 'Same-level PNDL rank',
    当前排名: 'Current rank',
    涉及城市数量: 'Covered cities',
    地图层级合并显示: 'Merged for map display',
    做图PNDL: 'Plot PNDL',
    PNDL估算: 'Estimated PNDL',
    聚合内位置对比: 'Locations in cluster',
    国家横向比较: 'Country comparison',
    中国省份横向比较: 'China province comparison',
    本国省州比较: 'Same-country admin comparison',
    '本国省/州比较': 'Same-country admin comparison',
    同国省州比较: 'Same-country admin comparison',
    '同国省/州比较': 'Same-country admin comparison',
    中国城市比较: 'China city comparison',
    中国城市横向比较: 'China city comparison',
    城市横向比较: 'City comparison',
    所属省州内城市比较: 'Cities in same province/state',
    '所属省/州内城市比较': 'Cities in same province/state',
    返回国家比较: 'Country comparison',
    聚合气泡包含的可映射位置: 'Mappable locations in the cluster bubble',
    当前筛选记录: 'Records under the current filters',
    '去重 DOI 计数': 'Unique DOI count',
    文献报告点位覆盖数: 'Literature-reported site coverage',
    '当前筛选的污水厂/采样点覆盖数': 'Wastewater plants/sampling sites under the current filters',
    '当前筛选去重 DOI': 'Unique DOIs under the current filters',
    当前筛选全部记录: 'All records under the current filters',
    去重生物标记物: 'Unique biomarkers',
    '存在可比 PNDL 的年份': 'Years with comparable PNDL',
    去重城市: 'Unique cities',
    聚合气泡包含的位置横向比较: 'Comparison of locations in the cluster bubble',
    '全球国家层面 PNDL 横向比较': 'Global country-level PNDL comparison',
    当前国家下一级行政区比较: 'Admin-1 comparison within the current country',
    '中国城市层面 PNDL 比较': 'China city-level PNDL comparison',
    '同一国家省/州层面 PNDL 横向比较': 'Province/state PNDL comparison within the same country',
    '国家层面 PNDL 横向比较': 'Country-level PNDL comparison',
    '中国城市层面 PNDL 比较；该模式不高亮当前省份':
      'China city-level PNDL comparison; the current province is not highlighted',
    '城市层面 PNDL 横向比较': 'City-level PNDL comparison',
    '同一省/州内城市 PNDL 比较': 'City PNDL comparison within the same province/state',
    精确关联: 'Exact match',
    一条记录关联多个点位: 'One record linked to multiple sites',
    位置字段回退匹配: 'Location-field fallback match',
    关联记录不计数: 'Linked record excluded from counts',
    未匹配国家: 'Country not matched',
    未匹配: 'Unmatched',
    '地图筛选项为空，请确认聚合表已刷新且存在可映射的 PNDL 数据。':
      'Map filters are empty. Refresh the aggregate table and confirm that it contains mappable PNDL data.',
    '当前筛选没有可映射的 PNDL 聚合结果。':
      'No mappable PNDL aggregate is available under the current filters.',
  },
}

const PNDL_COMPARISON_LABELS: Record<Locale, Record<string, string>> = {
  zh: {
    country: '国家级',
    admin1: '省/州级',
    'china-city': '城市级',
    city: '城市级',
    'parent-city': '同省城市',
    cluster: '聚合位置',
  },
  en: {
    country: 'Country level',
    admin1: 'Admin-1 level',
    'china-city': 'City level',
    city: 'City level',
    'parent-city': 'Same-admin cities',
    cluster: 'Cluster locations',
  },
}

const mapContainer = ref<HTMLElement | null>(null)
const pndlChartScrollRef = ref<HTMLElement | null>(null)
const pndlColumnTooltipState = ref<PndlColumnTooltipState>({
  visible: false,
  key: '',
  title: '',
  label: '',
  value: '',
  metrics: [],
  x: 0,
  y: 0,
})
const trendPointTooltipState = ref<PndlColumnTooltipState>({
  visible: false,
  key: '',
  title: '',
  label: '',
  value: '',
  metrics: [],
  x: 0,
  y: 0,
})
const filters = ref<MapFilterResponse | null>(null)
const stats = ref<MapStatsResponse | null>(null)
const selectedDetail = ref<MapDetailResponse | null>(null)
const activePndlComparisonKey = ref('')
const mapError = ref('')
const filterError = ref('')
const detailError = ref('')
const isLoadingFilters = ref(false)
const isLoadingStats = ref(false)
const isLoadingDetail = ref(false)
const mapMode = ref<MapMode>('flat')
const mapReady = ref(false)
const mapZoomLevel = ref(FLAT_INITIAL_ZOOM)
const activeMapLevel = ref<MapDisplayLevel>(mapDisplayLevelForZoom(FLAT_INITIAL_ZOOM))
const mapRenderPhase = ref<MapRenderPhase>('settled')
const boundaryVersion = ref(0)
const regionIndexVersion = ref(0)
const globeAvailable = ref(false)
const detailMode = ref<DetailMode>('none')
const detailOrigin = ref<DetailOrigin>('none')
const fullDetailShouldRestoreCompact = ref(false)
const isFilterOpen = ref(true)
const isLayerPanelOpen = ref(false)
const isLanguageMenuOpen = ref(false)
const isMapStyleSwitching = ref(false)
const searchQuery = ref('')
const isSearchFocused = ref(false)
const locale = ref<Locale>(readInitialLocale())
const loadingBoundaryNames = ref<BoundaryName[]>([])
const selectedRegionFeature = ref<GeoJsonFeature | null>(null)
const selectedRegionIdentity = ref<RegionIdentity | null>(null)
const selectedPointKey = ref('')
const pinnedBiomarkerOption = ref<MapBiomarkerOption | null>(null)
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
let hoverPopupFeatureKey = ''
let statsController: AbortController | null = null
let detailController: AbortController | null = null
let detailRequestId = 0
let fetchTimer: number | undefined
let clickTimer: number | undefined
let searchBlurTimer: number | undefined
let resizeTimer: number | undefined
let regionTooltipTimer: number | undefined
let mapStatusFrame: number | undefined
let unifiedHoverFrame: number | undefined
let hoverRefreshFrame: number | undefined
let countryStatusTimer: number | undefined
let pointSourceRefreshTimer: number | undefined
let pointPreparationRevision = 0
let pointPreparationHandle: number | undefined
let progressiveRegionStateRevision = 0
let cancelProgressiveRegionState: (() => void) | undefined
let pendingCursorPoint: [number, number] | null = null
let pendingCursorPixel: [number, number] | null = null
let removePmtilesProtocol: (() => void) | null = null
let pmtilesProtocolReady = false
let hoveredPointId: string | number | null = null
let selectedPointId: string | number | null = null
let hoveredPointSourceId = ''
let selectedPointSourceId = ''
let hoveredRegionFeature: GeoJsonFeature | null = null
let previewHoveredRegionId = ''
let previewSelectedRegionId = ''
let cameraMoving = false
let pointLayerEventsBound = false
let regionLayerEventsBound = false
let isBasemapFallbackInProgress = false
let projectionSwitchInProgress = false
let preserveSelectionOnNextSelectionChange = false
let programmaticSelectionUpdateInProgress = false
const boundaryCache = new Map<BoundaryName, FeatureCollection>()
const cleanedBoundaryCache = new Map<BoundaryName, FeatureCollection>()
const boundaryFeatureIndexCache = new Map<BoundaryName, BoundaryFeatureIndex>()
const boundaryHitIndexCache = new Map<BoundaryName, BoundaryHitIndex>()
const boundaryLineCollectionCache = new Map<BoundaryName, FeatureCollection>()
const activePolygonStateIds = new Map<MapDisplayLevel, Set<string>>()
const cityLineCollectionCache = new Map<string, FeatureCollection>()
const activeProvinceLineCollectionCache = new Map<string, FeatureCollection>()
let specialAdminEnvelopeCollection: FeatureCollection | null = null
let specialAdminLineCollection: FeatureCollection | null = null
let activeCityLineParentKey = ''
let displayRegionRowsCache: { stats: MapStatsResponse | null; rows: MapRegionStat[] } | null = null
let displayMapRowsStats: MapStatsResponse | null = null
const displayMapRowsCache = new Map<MapDisplayLevel, MapRegionStat[]>()
let regionDataCollectionCache: CachedFeatureCollection | null = null
const labelPointCollectionCache = new Map<BoundaryName, CachedFeatureCollection>()
const pointCollectionCache = new Map<MapDisplayLevel, CachedFeatureCollection>()
const missingBusinessLabelKeys = new Set<string>()
let reportedMissingBusinessLabelSignature = ''
let missingBusinessLabelsStats: MapStatsResponse | null = null
let statLookupCache: {
  stats: MapStatsResponse | null
  exact: Map<string, MapRegionStat>
  aliases: Map<string, MapRegionStat>
} | null = null
const cityAdminKeyCache = new Map<string, string>()
let cityAdminKeyCacheVersion = -1
let regionIndexEntries: RegionIndexEntry[] = []
let regionIndexPromise: Promise<void> | null = null
const regionIndexByKey = new Map<string, RegionIndexEntry>()

const ui = computed(() => UI_TEXT[locale.value])
const isCompactDetailOpen = computed(() => detailMode.value === 'compact')
const isFullDetailOpen = computed(() => detailMode.value === 'full')
const isDetailOpen = computed(() => detailMode.value !== 'none')
const isClusterDetail = computed(
  () => detailOrigin.value === 'cluster' || Boolean(selectedDetail.value?.cluster),
)
const currentTargetClasses = computed(() => {
  const items = filters.value?.targetClasses ?? []
  if (
    selection.targetClass &&
    selection.targetClass !== 'ALL' &&
    !items.includes(selection.targetClass)
  ) {
    return [...items, selection.targetClass]
  }
  return items
})
const currentCategories = computed(() => {
  if (!filters.value) return []
  const withCurrent = (items?: string[]) =>
    selection.category && !withAllCategory(items).includes(selection.category)
      ? [...withAllCategory(items), selection.category]
      : withAllCategory(items)
  if (selection.targetClass && selection.targetClass !== 'ALL') {
    return withCurrent(filters.value.categoriesByTargetClass?.[selection.targetClass])
  }
  return withCurrent(filters.value.categories)
})
const currentSubcategories = computed(() =>
  withFallbackOption(
    filters.value?.subcategoriesByCategory[selection.category]?.includes(selection.subcategory)
      ? filters.value?.subcategoriesByCategory[selection.category]
      : [
          ...(filters.value?.subcategoriesByCategory[selection.category] ?? []),
          selection.subcategory,
        ],
    ALL_SUBCATEGORY_LABEL,
  ),
)
const currentBiomarkers = computed(() => {
  const items =
    filters.value?.biomarkersByCategorySubcategory[
      buildSelectionKey(selection.category, selection.subcategory)
    ] ?? []
  const normalizedItems = withAllBiomarker(items)
  const pinned = pinnedBiomarkerOption.value
  if (
    pinned &&
    selection.biomarkerKey === pinned.key &&
    !normalizedItems.some((item) => item.key === pinned.key)
  ) {
    return [...normalizedItems, pinned]
  }
  return normalizedItems
})
const currentYears = computed(() => {
  const years =
    filters.value?.yearsBySelection[
      buildSelectionKey(selection.category, selection.subcategory, selection.biomarkerKey)
    ] ?? []
  return withFallbackOption(years, ALL_YEAR_LABEL)
})
const targetClassFilterOptions = computed<MapFilterSelectOption[]>(() => [
  { value: 'ALL', label: ui.value.allTargetClasses },
  ...toFilterSelectOptions(
    currentTargetClasses.value.filter((value) => value !== 'ALL'),
    (value) => displayOptionLabel(value),
  ),
])
const categoryFilterOptions = computed(() =>
  toFilterSelectOptions(currentCategories.value, (value) => displayOptionLabel(value)),
)
const subcategoryFilterOptions = computed(() =>
  toFilterSelectOptions(currentSubcategories.value, (value) => displayOptionLabel(value)),
)
const biomarkerFilterOptions = computed<MapFilterSelectOption[]>(() =>
  currentBiomarkers.value.map((option) => ({
    value: option.key,
    label: displayOptionLabel(option.label),
  })),
)
const yearFilterOptions = computed(() =>
  toFilterSelectOptions(currentYears.value, (value) => displayOptionLabel(value)),
)
const selectedBiomarkerLabel = computed(
  () =>
    displayOptionLabel(
      currentBiomarkers.value.find((item) => item.key === selection.biomarkerKey)?.label,
    ) ||
    (selection.biomarkerKey === ALL_BIOMARKER_KEY
      ? ui.value.allBiomarkers
      : selection.biomarkerKey),
)
const hasSpecificBiomarker = computed(() => selection.biomarkerKey !== ALL_BIOMARKER_KEY)
const effectiveFilterContext = computed(() =>
  detailFilterContext({
    hasSpecificBiomarker: hasSpecificBiomarker.value,
    biomarkerLabel: selectedBiomarkerLabel.value,
    year: displayOptionLabel(selection.year),
    fallbackParts: [
      displayOptionLabel(selection.targetClass),
      displayOptionLabel(selection.category),
      displayOptionLabel(selection.subcategory),
    ],
  }),
)
const detailRegion = computed(() => selectedDetail.value?.region ?? null)
const detailTitle = computed(() => {
  if (isClusterDetail.value)
    return localizedBackendLabel(selectedDetail.value?.title) || ui.value.detail
  if (detailRegion.value)
    return (
      localizedStatDisplayName(detailRegion.value) ||
      localizedBackendLabel(selectedDetail.value?.title) ||
      ui.value.detail
    )
  return localizedBackendLabel(selectedDetail.value?.title) || ui.value.detail
})
const detailSubtitle = computed(() => {
  const prefix = isClusterDetail.value
    ? ui.value.clusterOverview
    : detailRegion.value
      ? isUnassignedAdmin1Stat(detailRegion.value)
        ? ui.value.unassignedCountryComparison
        : ''
      : ''
  return [prefix, effectiveFilterContext.value].filter(Boolean).join(' · ')
})
const detailLocationPrecision = computed(() =>
  detailRegion.value && !isClusterDetail.value
    ? locationPrecisionLabel(detailRegion.value.level)
    : '',
)
const compactSummaryCards = computed(() =>
  compactExplorerSummaryCards(selectedDetail.value?.summaryCards ?? []),
)
const compactBiomarkers = computed(() =>
  sortBiomarkersByLiterature(selectedDetail.value?.topBiomarkers ?? []).slice(0, 20),
)
const availableYearRange = computed(() => selectionYearRange(currentYears.value))
const fullDetailSummaryCards = computed(() =>
  overviewSummaryCards(
    selectedDetail.value?.summaryCards ?? [],
    hasSpecificBiomarker.value,
    availableYearRange.value,
  ),
)
const pndlComparisons = computed(() =>
  pndlComparisonsForRegion(
    selectedDetail.value?.pndlComparisons ?? [],
    detailRegion.value?.level,
    detailRegion.value?.geoKey,
  ),
)
const detailSourceRecords = computed(
  () => selectedDetail.value?.sourceRecords ?? selectedDetail.value?.sources ?? [],
)
const detailReportedSites = computed(() => selectedDetail.value?.reportedSites ?? [])
const detailCoverageWithoutPndl = computed(() => {
  const region = detailRegion.value
  return Boolean(
    hasSpecificBiomarker.value &&
    region &&
    Number(region.recordCount ?? 0) > 0 &&
    !hasPositivePndlValue(region.pndlMedianMgD1000inh),
  )
})
const activePndlComparison = computed(() => {
  const comparisons = pndlComparisons.value
  if (!comparisons.length) return null
  return comparisons.find((item) => item.key === activePndlComparisonKey.value) ?? comparisons[0]
})
const pndlChartRows = computed(() =>
  excludeUnassignedCityRows(
    ensureSelectedPndlChartRow(
      filteredPndlComparisonRows(
        activePndlComparison.value,
        activePndlComparison.value?.rows ?? selectedDetail.value?.pndlRanking ?? [],
      ),
    ),
  ),
)
const pndlChartDisplayRows = computed(() => selectPndlChartDisplayRows(pndlChartRows.value))
const pndlChartColumnStyle = computed<Record<string, string>>(() => ({
  '--pndl-column-count': String(Math.max(pndlChartDisplayRows.value.length, 1)),
}))
const pndlRankingRows = computed(() => pndlChartRows.value.slice(0, 30))
const isUnassignedCountryComparison = computed(
  () =>
    Boolean(detailRegion.value && isUnassignedAdmin1Stat(detailRegion.value)) &&
    activePndlComparison.value?.scopeLevel === 'country',
)
const canRenderPndlChart = computed(
  () =>
    hasSpecificBiomarker.value &&
    pndlChartRows.value.length > 0 &&
    !(isUnassignedCountryComparison.value && pndlChartRows.value.length < 2),
)
const pndlChartStatusText = computed(() =>
  isUnassignedCountryComparison.value && pndlChartRows.value.length === 1
    ? ui.value.unassignedCountryComparisonInsufficient
    : ui.value.pndlChartNoData,
)
const canShowPndlComparisonSection = computed(() => hasSpecificBiomarker.value)
const pndlChartPositiveValues = computed(() =>
  pndlChartDisplayRows.value
    .map((item) => Number(item.pndlMedianMgD1000inh ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0),
)
const pndlChartMax = computed(() => Math.max(...pndlChartPositiveValues.value, 0))
const pndlChartMin = computed(() => Math.min(...pndlChartPositiveValues.value, pndlChartMax.value))
const pndlChartUsesLogScale = computed(
  () => pndlChartMin.value > 0 && pndlChartMax.value / pndlChartMin.value > 100,
)
const pndlChartTicks = computed(() =>
  pndlChartAxisTicks(pndlChartMax.value, pndlChartMin.value, pndlChartUsesLogScale.value),
)
const pndlChartTitle = computed(
  () =>
    (activePndlComparison.value ? localizedPndlComparisonLabel(activePndlComparison.value) : '') ||
    (isClusterDetail.value ? ui.value.clusterOverview : ui.value.pndlComparison),
)
const trendTitle = computed(
  () => localizedBackendLabel(activeTrendSeries.value?.label) || ui.value.pndlTrend,
)
const detailNoteItems = computed(() => [
  ui.value.dataNotePndl,
  ui.value.dataNoteBubble,
  ui.value.dataNoteCoverage,
])
const trendSeries = computed(() => selectedDetail.value?.trendSeries ?? [])
const activeTrendSeries = computed(() => trendSeries.value[0] ?? null)
const renderableTrendSeries = computed(() =>
  hasSpecificBiomarker.value && !isClusterDetail.value
    ? trendSeries.value.filter((series) => (series.points?.length ?? 0) >= 2)
    : [],
)
const canRenderTrendChart = computed(() => renderableTrendSeries.value.length > 0)
const allLevelHeatValues = computed(() =>
  (stats.value?.regions ?? [])
    .map((row) => Number(row.pndlMedianMgD1000inh ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0),
)
const stableHeatRange = computed(() =>
  resolveStableHeatRange(
    stats.value?.legend.min,
    stats.value?.legend.max,
    allLevelHeatValues.value,
  ),
)
const regionHeatMin = computed(() => stableHeatRange.value.min)
const regionHeatMax = computed(() => stableHeatRange.value.max)
const hasCoverageWithoutPndl = computed(() =>
  displayHeatRegionRows().some(
    (row) => statHasCoverage(row) && Number(row.pndlMedianMgD1000inh ?? 0) <= 0,
  ),
)
const canShowPndlGradient = computed(() => hasSpecificBiomarker.value && regionHeatMax.value > 0)
const canShowHeatLegend = computed(
  () => hasSpecificBiomarker.value && (canShowPndlGradient.value || hasCoverageWithoutPndl.value),
)
const heatLegendGradient = computed(
  () =>
    `linear-gradient(90deg, ${MAP_HEAT_COLORS.map(
      (color, index) => `${color} ${(index / Math.max(MAP_HEAT_COLORS.length - 1, 1)) * 100}%`,
    ).join(', ')})`,
)
const heatLegendBands = computed(() => {
  const min = regionHeatMin.value
  const max = regionHeatMax.value
  const middle = heatLegendMiddleValue(min, max)
  return [
    { label: ui.value.heatLegendLow, value: formatCompact(min) },
    { label: ui.value.heatLegendMedium, value: formatCompact(middle) },
    { label: ui.value.heatLegendHigh, value: formatCompact(max) },
  ]
})
const trendChartPoints = computed(() => {
  const points = activeTrendSeries.value?.points ?? []
  const values = points
    .map((point) => Number(point.value ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0)
  if (points.length < 2 || !values.length) return []
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || max || 1
  const width = 680
  const height = 210
  return points.map((point, index) => {
    const value = Number(point.value ?? 0)
    const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width
    const y = height - ((value - min) / range) * (height - 28) - 14
    return {
      ...point,
      x,
      y,
      label: formatCompact(value),
    }
  })
})
const trendPolyline = computed(() =>
  trendChartPoints.value.map((point) => `${point.x},${point.y}`).join(' '),
)

function trendChartPointsForSeries(series: MapTrendSeries) {
  const points = series.points ?? []
  const values = points
    .map((point) => Number(point.value ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0)
  if (points.length < 2 || !values.length) return []
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || max || 1
  const width = 680
  const height = 210
  return points.map((point, index) => {
    const value = Number(point.value ?? 0)
    return {
      ...point,
      x: (index / (points.length - 1)) * width,
      y: height - ((value - min) / range) * (height - 28) - 14,
      label: formatCompact(value),
    }
  })
}

function trendPolylineForSeries(series: MapTrendSeries) {
  return trendChartPointsForSeries(series)
    .map((point) => `${point.x},${point.y}`)
    .join(' ')
}

function showTrendPointTooltip(
  series: MapTrendSeries,
  point: MapTrendSeries['points'][number],
  event: MouseEvent,
) {
  const card = (event.currentTarget as Element | null)?.closest<HTMLElement>('.trend-chart-card')
  const position = chartTooltipPosition(event, card, 252, 116)
  trendPointTooltipState.value = {
    visible: true,
    key: series.metricKey,
    title: localizedBackendLabel(series.label),
    label: ui.value.annualMedian,
    value: `${formatCompact(point.value)} ${series.unit ?? ''}`.trim(),
    metrics: [
      { label: ui.value.year, value: String(point.year) },
      {
        label: ui.value.dataRows,
        value: formatNumber(point.valueCount ?? point.recordCount ?? 0),
      },
    ],
    ...position,
  }
}

function hideTrendPointTooltip() {
  if (!trendPointTooltipState.value.visible) return
  trendPointTooltipState.value = { ...trendPointTooltipState.value, visible: false }
}
const compactDetailCallout = computed(() => {
  if (!selectedDetail.value) return ''
  if (selectedDetail.value.cluster) {
    const locationCount =
      selectedDetail.value.locations?.length ?? detailRegion.value?.pointCount ?? 0
    return `${formatNumber(locationCount)} ${ui.value.clusterCount} · ${ui.value.literature} ${formatNumber(detailRegion.value?.doiCount)}`
  }
  if (!detailRegion.value) return detailSubtitle.value
  return ''
})
const fullDetailCallout = computed(() =>
  isClusterDetail.value ? compactDetailCallout.value : detailSubtitle.value,
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
    displayRegionRows().length === 0 &&
    displayPointRows().length === 0,
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
    return {
      type: 'notice',
      text: localizedBackendLabel(filters.value?.diagnostics?.message) || ui.value.noFilterData,
    }
  }
  if (hasNoStatsData.value) {
    return {
      type: 'notice',
      text: localizedBackendLabel(stats.value?.diagnostics?.message) || ui.value.noStatsData,
    }
  }
  return null
})
const boundaryLoadingMessage = computed(() =>
  loadingBoundaryNames.value.length ? ui.value.boundaryLoading : '',
)
const searchResults = computed(() => {
  boundaryVersion.value
  regionIndexVersion.value
  const query = normalizeSearch(searchQuery.value)
  if (!query) return []
  return buildSearchCandidates()
    .filter((item) => searchCandidateMatches(item, query))
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
  if (mapReady.value) {
    updateLoadedLabelSources()
    updatePointSource()
    updateRegionDataSource()
    updateRegionHighlightSources()
  }
  void refreshVectorBasemapLanguage()
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
    if (programmaticSelectionUpdateInProgress) return
    const categories = currentCategories.value
    const nextCategory = categories.includes(ALL_CATEGORY_LABEL)
      ? ALL_CATEGORY_LABEL
      : (categories[0] ?? '')
    if (selection.category !== nextCategory) selection.category = nextCategory
  },
)
watch(
  () => selection.category,
  () => {
    if (programmaticSelectionUpdateInProgress) return
    const nextSubcategory = currentSubcategories.value[0] ?? '全部小类'
    if (selection.subcategory !== nextSubcategory) selection.subcategory = nextSubcategory
  },
)
watch(
  () => selection.subcategory,
  () => {
    if (programmaticSelectionUpdateInProgress) return
    const allBiomarkers = currentBiomarkers.value
    const nextBiomarker =
      allBiomarkers.find((item) => item.key === 'ALL')?.key ?? allBiomarkers[0]?.key ?? 'ALL'
    if (selection.biomarkerKey !== nextBiomarker) selection.biomarkerKey = nextBiomarker
  },
)
watch(
  () => selection.biomarkerKey,
  () => {
    if (programmaticSelectionUpdateInProgress) return
    pointCollectionCache.clear()
    schedulePointSourceRefresh(0)
    const nextYear =
      currentYears.value.find((item) => item === '全部年份') ?? currentYears.value[0] ?? '全部年份'
    if (selection.year !== nextYear) selection.year = nextYear
  },
)
watch(
  () => ({ ...selection }),
  () => {
    if (programmaticSelectionUpdateInProgress) return
    pinnedBiomarkerOption.value = null
    const preserveSelection = preserveSelectionOnNextSelectionChange
    preserveSelectionOnNextSelectionChange = false
    closeDetail({ clearSelection: !preserveSelection })
    if (selection.category) scheduleStatsFetch()
  },
  { deep: true },
)
watch(pndlComparisons, (comparisons) => {
  activePndlComparisonKey.value = comparisons[0]?.key ?? ''
})
watch(
  [detailRegion, activePndlComparison],
  ([region, comparison]) => {
    if (region?.level !== 'city' || !shouldFilterToDetailAdmin(comparison)) return
    void ensureBoundary('chinaProvinces')
    void ensureBoundary('chinaCities')
  },
  { immediate: true },
)
watch(
  [pndlChartDisplayRows, activePndlComparison, isFullDetailOpen],
  () => {
    hidePndlColumnTooltip()
    void nextTick(scrollSelectedPndlColumnIntoView)
  },
  { flush: 'post' },
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
  if (pointSourceRefreshTimer) window.clearTimeout(pointSourceRefreshTimer)
  if (countryStatusTimer != null) {
    window.clearTimeout(countryStatusTimer)
    countryStatusTimer = undefined
  }
  if (mapStatusFrame != null) {
    window.cancelAnimationFrame(mapStatusFrame)
    mapStatusFrame = undefined
  }
  if (unifiedHoverFrame != null) {
    window.cancelAnimationFrame(unifiedHoverFrame)
    unifiedHoverFrame = undefined
  }
  if (hoverRefreshFrame != null) {
    window.cancelAnimationFrame(hoverRefreshFrame)
    hoverRefreshFrame = undefined
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
      ...result.defaultSelection,
      targetClass: result.defaultSelection?.targetClass ?? 'ALL',
      category: ALL_CATEGORY_LABEL,
      subcategory: ALL_SUBCATEGORY_LABEL,
      biomarkerKey: ALL_BIOMARKER_KEY,
    })
  } catch (error) {
    filterError.value = getUserErrorMessage(error, ui.value.filterLoadFailed)
  } finally {
    isLoadingFilters.value = false
  }
}

function withFallbackOption(items: string[] | undefined, option: string) {
  const values = (items ?? []).filter(Boolean)
  return values.includes(option) ? values : [option, ...values]
}

function toFilterSelectOptions(
  values: string[],
  labelForValue: (value: string) => string,
): MapFilterSelectOption[] {
  return values.map((value) => ({ value, label: labelForValue(value) }))
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
    regionSourceMode = basemapConfig.mode === 'vector' ? 'vector' : 'geojson'
    activeBasemapConfig = basemapConfig
    map = new maplibregl.Map({
      container: mapContainer.value,
      style: buildMapStyle(mapMode.value, basemapConfig) as never,
      center: FLAT_CENTER as LngLatLike,
      zoom: FLAT_INITIAL_ZOOM,
      minZoom: currentMapMinZoom(),
      maxZoom: currentMapMaxZoom(),
      attributionControl: false,
      renderWorldCopies: true,
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
      applyFlatWorldWrapConstraints()
      mapZoomLevel.value = map?.getZoom() ?? FLAT_INITIAL_ZOOM
      syncActiveMapLevel(mapZoomLevel.value)
      addMapSourcesAndLayers()
      bindLayerEvents()
      void ensureRegionIndex().then(() => {
        updateLoadedLabelSources()
        updatePointSource()
      })
      void ensureBoundary('countries', true)
      updateMapData()
      enforceGlobeSafeZoom(false)
      updateMapStatus()
    })
    map.on('zoomend', () => {
      const nextZoom = map?.getZoom() ?? mapZoomLevel.value
      mapZoomLevel.value = nextZoom
      const levelChanged = syncActiveMapLevel(nextZoom)
      updateMapStatus()
      ensureStagedBoundariesForCurrentZoom()
      if (levelChanged) {
        handleActiveMapLevelTransition()
        updateLoadedLabelSources()
        updateRegionDataSource()
        refreshSelectedRegionFromIdentity()
        updateRegionHighlightSources()
      }
      schedulePointSourceRefresh(0)
    })
    map.on('movestart', () => {
      cameraMoving = true
      cancelPendingMapClick()
      clearHoverForCameraMove()
    })
    map.on('move', scheduleLiveMapStatusUpdate)
    map.on('moveend', () => {
      const nextZoom = map?.getZoom() ?? mapZoomLevel.value
      mapZoomLevel.value = nextZoom
      const levelChanged = syncActiveMapLevel(nextZoom)
      if (levelChanged) {
        handleActiveMapLevelTransition()
        updateLoadedLabelSources()
        updateRegionDataSource()
        refreshSelectedRegionFromIdentity()
        updateRegionHighlightSources()
      }
      updateVisibleCityBoundaryLines()
      applyViewLayerVisibility()
      updateMapStatus()
      cameraMoving = false
      scheduleHoverRefreshAtCursor()
    })
    map.on('mousemove', handleMapMouseMove)
    map.on('mouseleave', handleMapMouseLeave)
    map.on('click', hideTooltipOnEmptyClick)
    updateMapCoordinates()
  } catch (error) {
    mapError.value = getUserErrorMessage(error, ui.value.mapInitFailed)
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

function currentMapMinZoom() {
  if (mapMode.value === 'globe') return GLOBE_MIN_ZOOM
  const width = map?.getCanvas().clientWidth ?? mapContainer.value?.clientWidth ?? window.innerWidth
  return Math.min(currentMapMaxZoom(), wrappedWorldMinZoom(width, FLAT_MIN_ZOOM))
}

function applyFlatWorldWrapConstraints() {
  if (!map) return
  const flat = mapMode.value === 'flat'
  map.setRenderWorldCopies(flat)
  map.setMinZoom(flat ? currentMapMinZoom() : GLOBE_MIN_ZOOM)
}

function mapDisplayLevelForZoom(zoom: number): MapDisplayLevel {
  return displayLevelForZoom(zoom)
}

function syncActiveMapLevel(zoom: number) {
  const nextLevel = nextMapDisplayLevel(activeMapLevel.value, zoom)
  if (activeMapLevel.value === nextLevel) return false
  activeMapLevel.value = nextLevel
  return true
}

function handleActiveMapLevelTransition() {
  mapRenderPhase.value = 'transitioning'
  progressiveRegionStateRevision += 1
  cancelProgressiveRegionState?.()
  cancelProgressiveRegionState = undefined
  clearHoverForCameraMove()
  clearSelectedPointVisualState()
  pointCollectionCache.clear()
  updatePreviewRegionOutlineLevelFilters()
  applyViewLayerVisibility()
  mapRenderPhase.value = 'settled'
}

function pointSourceId(level: MapDisplayLevel) {
  return `map-points-${level}`
}

function pndlLayerId(
  level: MapDisplayLevel,
  part: 'heat-footprint' | 'bubble-icons' | 'selected-ring' | 'bubble-count' | 'point-labels',
) {
  return `pndl-${level}-${part}`
}

function pndlLayerZoomRange(level: MapDisplayLevel) {
  const range: { minzoom?: number; maxzoom?: number } = {}
  if (level === 'country') {
    range.minzoom = PREVIEW_MAP_MIN_ZOOM
    range.maxzoom = LEVEL_FADE_COUNTRY_END
  } else if (level === 'admin1') {
    range.minzoom = LEVEL_FADE_COUNTRY_END
    range.maxzoom = LEVEL_FADE_CITY_END
  } else {
    range.minzoom = CITY_LEVEL_EXIT_ZOOM
    range.maxzoom = PREVIEW_MAP_MAX_ZOOM + 0.01
  }
  return range
}

function levelTransitionOpacityExpression(level: MapDisplayLevel, opacity = 1) {
  if (level === 'country') {
    return ['step', ['zoom'], opacity, LEVEL_FADE_COUNTRY_END, 0]
  }
  if (level === 'admin1') {
    return ['step', ['zoom'], 0, LEVEL_FADE_COUNTRY_END, opacity, LEVEL_FADE_CITY_END, 0]
  }
  return ['step', ['zoom'], 0, CITY_LEVEL_EXIT_ZOOM, opacity]
}

function invalidateMapDisplayCaches() {
  displayRegionRowsCache = null
  displayMapRowsStats = null
  displayMapRowsCache.clear()
  regionDataCollectionCache = null
  labelPointCollectionCache.clear()
  pointCollectionCache.clear()
  statLookupCache = null
}

function clampNumber(value: number, min: number, max: number) {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function clampZoom(zoom: number) {
  return clampNumber(
    zoom,
    mapMode.value === 'globe' ? getGlobeSafeZoom() : FLAT_MIN_ZOOM,
    currentMapMaxZoom(),
  )
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
  if (!USE_LOCAL_PM_TILES_BASEMAP) return { mode: 'geojson' }
  const pmtilesUrl = BASEMAP_PM_TILES_URL.trim()
  if (!pmtilesUrl || !(await canLoadVectorBasemapAssets(pmtilesUrl))) {
    return { mode: 'geojson' }
  }

  try {
    await registerPmtilesProtocol(module)
    const basemaps = await import('@protomaps/basemaps')

    return {
      mode: 'vector',
      styleSourceUrl: `pmtiles://${new URL(pmtilesUrl, window.location.origin).toString()}`,
      layers: protomapsLayersForLocale(basemaps),
      glyphs: BASEMAP_GLYPHS_URL,
    }
  } catch {
    return { mode: 'geojson' }
  }
}

function protomapsLayersForLocale(basemaps: typeof import('@protomaps/basemaps')) {
  const layers = basemaps.layers('protomaps', basemaps.namedFlavor('light'), {
    lang: locale.value === 'en' ? 'en' : 'zh',
  })
  return buildPreviewBasemapLayers(layers, locale.value)
}

async function refreshVectorBasemapLanguage() {
  if (!map || !maplibregl || basemapMode !== 'vector' || activeBasemapConfig.mode !== 'vector')
    return
  try {
    const basemaps = await import('@protomaps/basemaps')
    activeBasemapConfig = {
      ...activeBasemapConfig,
      layers: protomapsLayersForLocale(basemaps),
    }
    reloadCurrentMapStyle()
  } catch {
    // Language switching is best-effort; the existing map remains usable.
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
  if (!glyphUrls.length) return false
  return canLoadAnyStaticAsset(glyphUrls)
}

async function canLoadPmtilesArchive(url: string) {
  return (await probePmtilesRange(url)).ok
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
  resetPreviewRegionFeatureStateTracking()
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
  resetPreviewRegionFeatureStateTracking()
  map.setStyle(buildMapStyle(mapMode.value, activeBasemapConfig) as never)
  const restore = () => {
    if (!isBasemapFallbackInProgress) return
    restoreGeoJsonBasemapLayers()
  }
  map.once('idle', restore)
  window.setTimeout(restore, 700)
}

function reloadCurrentMapStyle() {
  if (!map || projectionSwitchInProgress || isBasemapFallbackInProgress) return
  isMapStyleSwitching.value = true
  const camera = {
    center: map.getCenter(),
    zoom: clampZoom(map.getZoom()),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  }
  map.stop()
  clearHoveredPoint()
  setHoveredRegion(null)
  unbindLayerEvents()
  mapReady.value = false
  resetPreviewRegionFeatureStateTracking()
  map.setStyle(buildMapStyle(mapMode.value, activeBasemapConfig) as never)
  const restore = () => {
    if (!map) return
    if (!map.isStyleLoaded()) {
      map.once('idle', restore)
      return
    }
    mapReady.value = true
    addMapSourcesAndLayers()
    bindLayerEvents()
    map.jumpTo(camera)
    applyFlatWorldWrapConstraints()
    syncActiveMapLevel(camera.zoom)
    void ensureBoundary('countries', true)
    ensureFallbackBoundaries(true)
    updateMapData()
    syncAtmosphereStyle()
    map.setMaxZoom(currentMapMaxZoom())
    isMapStyleSwitching.value = false
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
  applyFlatWorldWrapConstraints()
  syncActiveMapLevel(map.getZoom())
  void ensureBoundary('countries', true)
  ensureFallbackBoundaries(true)
  updateMapData()
  enforceGlobeSafeZoom(false)
}

function buildMapStyle(mode: MapMode, basemapConfig: BasemapConfig) {
  if (basemapConfig.mode === 'vector') {
    return {
      version: 8,
      projection: { type: mode === 'globe' ? 'globe' : 'mercator' },
      glyphs: basemapConfig.glyphs,
      sources: {
        protomaps: {
          type: 'vector',
          attribution:
            '<a href="https://github.com/protomaps/basemaps">Protomaps</a> · <a href="https://osm.org/copyright">OpenStreetMap</a> · geoBoundaries CC BY 4.0',
          url: basemapConfig.styleSourceUrl,
          promoteId: {
            [PREVIEW_REGION_OUTLINE_SOURCE_LAYER]: 'region_id',
            [PREVIEW_REGION_POLYGON_SOURCE_LAYER]: 'region_id',
          },
        },
      },
      layers: basemapConfig.layers,
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
          'background-color': mode === 'globe' ? GLOBE_BACKGROUND_COLOR : FLAT_BACKGROUND_COLOR,
        },
      },
    ],
  }
}

function isStyleLayer(layer: unknown): layer is {
  id: string
  type?: string
  filter?: unknown
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
  if (id.endsWith('-fill')) {
    return (
      layers.find((item) => /^roads_|^pois|^places|^transit|^transport/i.test(item.id))?.id ??
      mapLabelLayerBeforeId()
    )
  }
  return mapLabelLayerBeforeId()
}

function addPndlLabelLayer(level: MapDisplayLevel) {
  const filters: unknown[] = [['==', ['get', 'labelVisible'], true]]
  if (level === 'city' && regionSourceMode === 'vector') {
    filters.push(['==', ['get', 'isMainlandCity'], true])
  }
  addMapLayer({
    id: pndlLayerId(level, 'point-labels'),
    type: 'symbol',
    source: pointSourceId(level),
    ...pndlLayerZoomRange(level),
    filter: filters.length === 1 ? filters[0] : ['all', ...filters],
    layout: {
      'text-field': ['get', 'displayName'],
      'text-font': ['Noto Sans Medium'],
      'text-size': businessLabelTextSizeExpression(level),
      'text-anchor': 'center',
      'text-justify': 'center',
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-padding': 2,
      'text-optional': false,
      'text-line-height': 1.1,
    },
    paint: {
      'text-color': '#273444',
      'text-halo-color': 'rgba(255,255,255,0.96)',
      'text-halo-width': 1.8,
      'text-opacity': levelTransitionOpacityExpression(level, 0.92),
    },
  })
}

function addBubbleImages() {
  if (!map) return
  MAP_DISPLAY_LEVELS.forEach((level) => {
    ;(['overview', 'biomarker', 'unassigned'] as const).forEach((variant) => {
      BUBBLE_IMAGE_BUCKETS[level].forEach((diameter, index) => {
        const id = bubbleImageId(level, index, variant)
        if (map?.hasImage(id)) return
        map?.addImage(id, createBubbleImage(diameter, variant), { pixelRatio: 2 })
      })
    })
    BUBBLE_IMAGE_BUCKETS[level].forEach((diameter, index) => {
      const ringId = bubbleRingImageId(level, index)
      if (!map?.hasImage(ringId)) {
        map?.addImage(ringId, createBubbleRingImage(diameter), { pixelRatio: 2 })
      }
      BUBBLE_HEAT_COLORS.forEach((color, colorIndex) => {
        const heatId = bubbleHeatImageId(level, index, colorIndex)
        if (!map?.hasImage(heatId)) {
          map?.addImage(heatId, createBubbleHeatImage(diameter, color), { pixelRatio: 2 })
        }
      })
    })
  })
}

function bubbleImageId(level: MapDisplayLevel, bucketIndex: number, variant: BubblePinVariant) {
  return `wbe-bubble-${variant}-${level}-${bucketIndex}`
}

function bubbleRingImageId(level: MapDisplayLevel, bucketIndex: number) {
  return `wbe-bubble-ring-${level}-${bucketIndex}`
}

function bubbleHeatImageId(level: MapDisplayLevel, bucketIndex: number, colorIndex: number) {
  return `wbe-bubble-heat-${level}-${bucketIndex}-${colorIndex}`
}

function createBubbleImage(diameter: number, variant: BubblePinVariant) {
  const pixelRatio = 2
  const padding = 10
  const size = (diameter + padding * 2) * pixelRatio
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) {
    return new ImageData(size, size)
  }
  const palette = BUBBLE_PIN_PALETTES[variant]
  const centerX = size / 2
  const centerY = size / 2
  const radius = diameter * pixelRatio * 0.43
  context.clearRect(0, 0, size, size)

  const pinPath = new Path2D()
  pinPath.moveTo(centerX, centerY + radius * 1.16)
  pinPath.bezierCurveTo(
    centerX - radius * 0.23,
    centerY + radius * 0.88,
    centerX - radius * 0.94,
    centerY + radius * 0.29,
    centerX - radius * 0.94,
    centerY - radius * 0.2,
  )
  pinPath.bezierCurveTo(
    centerX - radius * 0.94,
    centerY - radius * 0.78,
    centerX - radius * 0.52,
    centerY - radius * 1.1,
    centerX,
    centerY - radius * 1.1,
  )
  pinPath.bezierCurveTo(
    centerX + radius * 0.54,
    centerY - radius * 1.1,
    centerX + radius * 0.94,
    centerY - radius * 0.78,
    centerX + radius * 0.94,
    centerY - radius * 0.2,
  )
  pinPath.bezierCurveTo(
    centerX + radius * 0.94,
    centerY + radius * 0.29,
    centerX + radius * 0.23,
    centerY + radius * 0.88,
    centerX,
    centerY + radius * 1.16,
  )
  pinPath.closePath()

  context.save()
  context.shadowColor = palette.shadow
  context.shadowBlur = 5 * pixelRatio
  context.shadowOffsetY = 1.5 * pixelRatio
  const gradient = context.createLinearGradient(
    centerX,
    centerY - radius * 1.1,
    centerX,
    centerY + radius * 1.16,
  )
  gradient.addColorStop(0, palette.top)
  gradient.addColorStop(0.5, palette.middle)
  gradient.addColorStop(1, palette.bottom)
  context.fillStyle = gradient
  context.fill(pinPath)
  context.restore()

  context.lineWidth = 1 * pixelRatio
  context.strokeStyle = palette.stroke
  context.stroke(pinPath)

  context.beginPath()
  context.arc(centerX, centerY - radius * 0.31, radius * 0.5, 0, Math.PI * 2)
  context.fillStyle = 'rgba(252, 254, 255, 0.94)'
  context.fill()
  context.lineWidth = 0.9 * pixelRatio
  context.strokeStyle = palette.highlight
  context.stroke()
  return context.getImageData(0, 0, size, size)
}

function createBubbleRingImage(diameter: number) {
  const pixelRatio = 2
  const padding = 10
  const size = (diameter + padding * 2) * pixelRatio
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) return new ImageData(size, size)
  const center = size / 2
  context.clearRect(0, 0, size, size)
  context.beginPath()
  context.arc(center, center, (diameter / 2 + 5) * pixelRatio, 0, Math.PI * 2)
  context.fillStyle = 'rgba(255,255,255,0.18)'
  context.fill()
  context.lineWidth = 2.75 * pixelRatio
  context.strokeStyle = '#b85435'
  context.stroke()
  return context.getImageData(0, 0, size, size)
}

function createBubbleHeatImage(diameter: number, color: string) {
  const pixelRatio = 2
  const padding = 14
  const size = (diameter + padding * 2) * pixelRatio
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) return new ImageData(size, size)
  const center = size / 2
  const radius = (diameter / 2 + 4) * pixelRatio
  context.clearRect(0, 0, size, size)
  context.save()
  context.shadowColor = color
  context.shadowBlur = 5 * pixelRatio
  context.beginPath()
  context.arc(center, center, radius, 0, Math.PI * 2)
  context.globalAlpha = 0.5
  context.fillStyle = color
  context.fill()
  context.globalAlpha = 0.7
  context.lineWidth = 1.2 * pixelRatio
  context.strokeStyle = color
  context.stroke()
  context.restore()
  return context.getImageData(0, 0, size, size)
}

function bubbleIconImageExpression(level: MapDisplayLevel) {
  return bubbleBucketImageExpression(level, 'biomarker')
}

function bubbleBucketImageExpression(level: MapDisplayLevel, variant: BubblePinVariant) {
  const buckets = BUBBLE_IMAGE_BUCKETS[level]
  const thresholds = BUBBLE_COUNT_THRESHOLDS[level]
  return [
    'step',
    pointCountNumberExpression(),
    bubbleImageId(level, 0, variant),
    thresholds[0],
    bubbleImageId(level, 1, variant),
    thresholds[1],
    bubbleImageId(level, 2, variant),
    thresholds[2],
    bubbleImageId(level, 3, variant),
    thresholds[3],
    bubbleImageId(level, Math.min(4, buckets.length - 1), variant),
  ]
}

function pointCountNumberExpression() {
  return ['to-number', ['coalesce', ['get', 'pointCount'], 1]]
}

function bubbleVisualScaleExpression() {
  return ['to-number', ['coalesce', ['get', 'bubbleScale'], 1]]
}

function bubbleTextScaleExpression() {
  return ['to-number', ['coalesce', ['get', 'bubbleTextScale'], 1]]
}

function bubbleIconOffsetExpression() {
  return bubbleOffsetMatchExpression('icon')
}

function bubbleTextOffsetExpression() {
  return bubbleOffsetMatchExpression('text')
}

function bubbleOffsetMatchExpression(kind: 'icon' | 'text') {
  const matches: unknown[] = []
  MAP_DISPLAY_LEVELS.forEach((level) => {
    BUBBLE_IMAGE_BUCKETS[level].forEach((_, bucketIndex) => {
      BUBBLE_OFFSET_SCALES[level].forEach((bubbleScale) => {
        const offsets = bubbleOffsetValues(level, bucketIndex, bubbleScale)
        matches.push(bubbleOffsetKey(level, bucketIndex, bubbleScale), [
          'literal',
          [0, kind === 'icon' ? offsets.iconY : offsets.textY],
        ])
      })
    })
  })
  return [
    'match',
    ['to-string', ['coalesce', ['get', 'bubbleOffsetKey'], '__none__']],
    ...matches,
    ['literal', kind === 'icon' ? [0, 0] : [0, -0.38]],
  ]
}

function addMapSourcesAndLayers() {
  if (!map) return
  // GeoJSON remains authoritative for every business-facing administrative
  // layer, even when the visual land/road/water basemap comes from PMTiles.
  if (regionSourceMode === 'geojson') {
    addGeoSource('country-boundaries')
    addGeoSource('country-boundary-lines')
    addGeoSource('admin1-boundary-lines')
    addGeoSource('china-province-boundary-lines')
    addGeoSource('china-city-boundary-lines')
    addGeoSource('china-active-province-boundary-lines')
    addGeoSource('china-special-admin-boundary-lines')
  }
  if (regionSourceMode === 'geojson') {
    addGeoSource('region-data')
    addGeoSource('region-data-lines')
    addGeoSource('region-hover')
    addGeoSource('region-hover-lines')
    addGeoSource('region-selected')
    addGeoSource('region-selected-lines')
  }
  addGeoSource('region-city-data')
  addGeoSource('region-city-data-lines')
  addGeoSource('region-city-hover')
  addGeoSource('region-city-hover-lines')
  addGeoSource('region-city-selected')
  addGeoSource('region-city-selected-lines')

  if (usesControlledLowZoomLabels()) {
    addGeoSource('continent-label-points')
    addGeoSource('country-label-points')
    addGeoSource('admin1-label-points')
    addGeoSource('china-province-label-points')
  }
  if (basemapMode === 'geojson') addGeoSource('china-city-label-points')
  MAP_DISPLAY_LEVELS.forEach((level) => {
    addPointSource(level)
  })
  addSpecialAdminPointSource()

  if (regionSourceMode === 'vector') addVectorRegionTopologyLayers()

  if (basemapMode === 'geojson') {
    addBaseFillLayer('country-land', 'country-boundaries', 0, 1)
  }

  if (usesControlledLowZoomLabels()) {
    addLabelLayer(
      'admin1-label',
      'admin1-label-points',
      LEVEL_FADE_COUNTRY_START,
      undefined,
      10,
      false,
    )
    addLabelLayer(
      'china-province-label',
      'china-province-label-points',
      LEVEL_FADE_COUNTRY_START,
      5.8,
      10,
      true,
      false,
      'exclude',
    )
    addLabelLayer(
      'china-special-admin-label',
      'china-province-label-points',
      4.1,
      undefined,
      10.5,
      true,
      false,
      'only',
    )
    addLabelLayer('continent-label', 'continent-label-points', 0, 1.75, 16)
    addLabelLayer('country-label', 'country-label-points', 1.35, LEVEL_FADE_COUNTRY_END, 12)
    updateContinentLabels()
  }
  if (basemapMode === 'geojson') {
    addLabelLayer(
      'china-city-label',
      'china-city-label-points',
      CITY_BOUNDARY_MIN_ZOOM + 0.3,
      undefined,
      10,
      true,
      true,
    )
  }
  addRegionDataLayers()
  addRegionHighlightLayers()
  addPreviewRegionOutlineLayers()
  addCityFallbackRegionLayers()
  if (basemapMode === 'geojson') addBoundaryLineLayers()

  addBubbleImages()
  MAP_DISPLAY_LEVELS.forEach(addPndlPointLayers)
  MAP_DISPLAY_LEVELS.forEach(addPndlCountLayer)
  addSpecialAdminPointLayers()
  applyMainlandCityLabelAuthority()
  applyViewLayerVisibility()
}

function addVectorRegionTopologyLayers() {
  addVectorBoundaryHitLayer('wbe-country-boundary-hit', 'country', 0, LEVEL_FADE_COUNTRY_END + 0.05)
  addVectorBoundaryHitLayer(
    'wbe-admin1-boundary-hit',
    'admin1',
    LEVEL_FADE_COUNTRY_START,
    LEVEL_FADE_CITY_END + 0.05,
  )
  addVectorBoundaryHitLayer('wbe-city-boundary-hit', 'city', CITY_LEVEL_EXIT_ZOOM)
}

function addVectorBoundaryHitLayer(
  id: string,
  level: MapDisplayLevel,
  minzoom: number,
  maxzoom?: number,
) {
  addRegionLayer({
    id,
    type: 'fill',
    source: REGION_VECTOR_SOURCE_ID,
    'source-layer': REGION_VECTOR_SOURCE_LAYER,
    minzoom,
    ...(maxzoom != null ? { maxzoom } : {}),
    filter: ['==', ['get', 'level'], level],
    paint: { 'fill-color': '#000000', 'fill-opacity': 0 },
  })
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

function addPointSource(level: MapDisplayLevel) {
  const id = pointSourceId(level)
  if (!map?.getSource(id)) {
    map?.addSource(id, {
      type: 'geojson',
      data: EMPTY_COLLECTION as never,
      promoteId: 'featureId',
    } as never)
  }
}

function addSpecialAdminPointSource() {
  if (!map?.getSource('map-points-special-admin')) {
    map?.addSource('map-points-special-admin', {
      type: 'geojson',
      data: EMPTY_COLLECTION as never,
      promoteId: 'featureId',
    } as never)
  }
}

function addSpecialAdminPointLayers() {
  const source = 'map-points-special-admin'
  addMapLayer({
    id: 'pndl-special-admin-bubble-icons',
    type: 'symbol',
    source,
    minzoom: CITY_LEVEL_EXIT_ZOOM,
    layout: {
      'icon-image': bubbleIconImageExpression('admin1'),
      'icon-size': bubbleVisualScaleExpression(),
      'icon-offset': bubbleIconOffsetExpression(),
      'icon-anchor': 'center',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'symbol-sort-key': pointCountNumberExpression(),
    },
    paint: { 'icon-opacity': 0.96 },
  })
  addMapLayer({
    id: 'pndl-special-admin-selected-ring',
    type: 'symbol',
    source,
    minzoom: CITY_LEVEL_EXIT_ZOOM,
    filter: ['!=', ['get', 'geoKey'], 'china|hongkong'],
    layout: {
      'icon-image': ['get', 'bubbleRingImage'],
      'icon-size': bubbleVisualScaleExpression(),
      'icon-offset': bubbleIconOffsetExpression(),
      'icon-anchor': 'center',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: {
      'icon-opacity': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        1,
        ['boolean', ['feature-state', 'hover'], false],
        0.9,
        0,
      ],
    },
  })
  addMapLayer({
    id: 'pndl-special-admin-bubble-count',
    type: 'symbol',
    source,
    minzoom: CITY_LEVEL_EXIT_ZOOM,
    layout: {
      'text-field': ['to-string', ['coalesce', ['get', 'pointCount'], 1]],
      'text-font': ['Noto Sans Regular'],
      'text-size': bubbleCountTextSize('admin1'),
      'text-offset': bubbleTextOffsetExpression(),
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': BUBBLE_PIN_PALETTES.biomarker.text,
      'text-halo-color': 'rgba(255,255,255,0.72)',
      'text-halo-width': 0.65,
    },
  })
  addMapLayer({
    id: 'pndl-special-admin-point-labels',
    type: 'symbol',
    source,
    minzoom: CITY_LEVEL_EXIT_ZOOM,
    maxzoom: PREVIEW_MAP_MAX_ZOOM + 0.01,
    filter: ['==', ['get', 'labelVisible'], true],
    layout: {
      'text-field': ['get', 'displayName'],
      'text-font': ['Noto Sans Medium'],
      'text-size': businessLabelTextSizeExpression('admin1'),
      'text-anchor': 'center',
      'text-justify': 'center',
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-padding': 2,
      'text-optional': false,
      'text-line-height': 1.1,
    },
    paint: {
      'text-color': '#273444',
      'text-halo-color': 'rgba(255,255,255,0.96)',
      'text-halo-width': 1.8,
      'text-opacity': 0.94,
    },
  })
}

function addPndlPointLayers(level: MapDisplayLevel) {
  const sourceId = pointSourceId(level)
  const pointCount = pointCountNumberExpression()
  addMapLayer({
    id: pndlLayerId(level, 'heat-footprint'),
    type: 'symbol',
    source: sourceId,
    ...pndlLayerZoomRange(level),
    filter: [
      'all',
      ['==', ['get', 'compactHeatFootprint'], true],
      ['==', ['get', 'hasPndlValue'], true],
    ],
    layout: {
      'icon-image': ['get', 'bubbleHeatImage'],
      'icon-size': bubbleVisualScaleExpression(),
      'icon-offset': bubbleIconOffsetExpression(),
      'icon-anchor': 'center',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: { 'icon-opacity': levelTransitionOpacityExpression(level, 0.95) },
  })

  addMapLayer({
    id: pndlLayerId(level, 'bubble-icons'),
    type: 'symbol',
    source: sourceId,
    ...pndlLayerZoomRange(level),
    layout: {
      'icon-image': bubbleIconImageExpression(level),
      'icon-size': bubbleVisualScaleExpression(),
      'icon-offset': bubbleIconOffsetExpression(),
      'icon-anchor': 'center',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'symbol-sort-key': pointCount,
    },
    paint: {
      'icon-opacity': levelTransitionOpacityExpression(level, level === 'city' ? 0.96 : 0.94),
    },
  })

  addMapLayer({
    id: pndlLayerId(level, 'selected-ring'),
    type: 'symbol',
    source: sourceId,
    ...pndlLayerZoomRange(level),
    layout: {
      'icon-image': ['get', 'bubbleRingImage'],
      'icon-size': bubbleVisualScaleExpression(),
      'icon-offset': bubbleIconOffsetExpression(),
      'icon-anchor': 'center',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: {
      'icon-opacity': [
        '*',
        levelTransitionOpacityExpression(level, 0.92),
        [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          1,
          ['boolean', ['feature-state', 'hover'], false],
          0.9,
          0,
        ],
      ],
    },
  })

  addPndlLabelLayer(level)
}

function addPndlCountLayer(level: MapDisplayLevel) {
  const pointCount = pointCountNumberExpression()
  addMapLayer({
    id: pndlLayerId(level, 'bubble-count'),
    type: 'symbol',
    source: pointSourceId(level),
    ...pndlLayerZoomRange(level),
    layout: {
      'text-field': ['to-string', ['coalesce', ['get', 'pointCount'], 1]],
      'text-font': ['Noto Sans Regular'],
      'text-size': ['*', bubbleCountTextSize(level), bubbleTextScaleExpression()],
      'symbol-sort-key': pointCount,
      'text-offset': bubbleTextOffsetExpression(),
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': BUBBLE_PIN_PALETTES.biomarker.text,
      'text-halo-color': 'rgba(255, 255, 255, 0.72)',
      'text-halo-width': 0.65,
      'text-opacity': levelTransitionOpacityExpression(level, 1),
    },
  })
}

function bubbleCountTextSize(level: MapDisplayLevel, scale = 1) {
  const thresholds = BUBBLE_COUNT_THRESHOLDS[level]
  const sizes = BUBBLE_COUNT_TEXT_SIZES[level]
  return [
    'step',
    pointCountNumberExpression(),
    sizes[0] * scale,
    thresholds[0],
    sizes[1] * scale,
    thresholds[1],
    sizes[2] * scale,
    thresholds[2],
    sizes[3] * scale,
    thresholds[3],
    sizes[4] * scale,
  ]
}

function addBaseFillLayer(
  id: string,
  source: string,
  minzoom = 0,
  opacity = 0.92,
  maxzoom?: number,
) {
  addMapLayer({
    id,
    type: 'fill',
    source,
    minzoom,
    ...(maxzoom != null ? { maxzoom } : {}),
    paint: {
      'fill-color': '#fcfcfb',
      'fill-opacity': opacity,
    },
  })
}

function addBoundaryLineLayers() {
  addLineLayer('country-line', 'country-boundary-lines', '#657681', 0.76, 0, 0.78)
  addLineLayer('admin1-line', 'admin1-boundary-lines', '#7f8d95', 0.66, 3.3, 0.64)
  addLineLayer('china-province-line', 'china-province-boundary-lines', '#73838c', 0.7, 3.3, 0.68)
  addLineLayer(
    'china-active-province-line',
    'china-active-province-boundary-lines',
    '#687983',
    0.82,
    CITY_BOUNDARY_MIN_ZOOM,
    0.78,
  )
  addLineLayer(
    'china-city-line',
    'china-city-boundary-lines',
    '#a0abb0',
    0.46,
    CITY_BOUNDARY_MIN_ZOOM,
    0.56,
  )
  addLineLayer(
    'china-special-admin-line',
    'china-special-admin-boundary-lines',
    '#526975',
    1.05,
    4.1,
    0.92,
  )
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
      'line-width': width,
      'line-opacity': opacity,
      'line-blur': 0,
    },
  })
}

function addRegionDataLayers() {
  addRegionOverlayLayers(
    'region-data',
    regionDataFillColorExpression(),
    MAP_HIGHLIGHT_STYLE.dataLine,
    {
      fillOpacity: regionDataFillOpacityExpression(),
      lineOpacity: regionDataLineOpacityExpression(),
      lineWidth: regionDataLineWidthExpression(),
      filter:
        regionSourceMode === 'vector'
          ? previewRegionPolygonLevelFilter()
          : regionVectorFilter(vectorRegionIds(dataRegionIds())),
    },
  )
}

function addRegionHighlightLayers() {
  addRegionOverlayLayers(
    'region-selected',
    selectedRegionFillColorExpression(),
    MAP_HIGHLIGHT_STYLE.selectedLine,
    {
      fillOpacity: selectedRegionFillOpacityExpression(),
      lineOpacity:
        regionSourceMode === 'vector'
          ? ['case', regionLevelEqualsExpression('city'), 0, 0.94]
          : regionOverlayOpacityExpression(0.92),
      lineWidth: regionHighlightLineWidthExpression('selected'),
      filter: regionVectorFilter(
        selectedRegionId() ? vectorRegionIds([selectedRegionId() as string]) : [],
      ),
      halo: {
        color: MAP_HIGHLIGHT_STYLE.selectedHalo,
        opacity:
          regionSourceMode === 'vector'
            ? ['case', regionLevelEqualsExpression('city'), 0, 0.36]
            : regionOverlayOpacityExpression(0.34),
        width: regionSelectedHaloWidthExpression(),
      },
    },
  )
  addRegionOverlayLayers(
    'region-hover',
    hoveredRegionFillColorExpression(),
    MAP_HIGHLIGHT_STYLE.hoverLine,
    {
      fillOpacity: 0,
      lineOpacity: regionOverlayOpacityExpression(1),
      lineWidth: regionHighlightLineWidthExpression('hover'),
      filter: regionVectorFilter(
        activeHoveredRegionId() ? vectorRegionIds([activeHoveredRegionId() as string]) : [],
      ),
    },
  )
}

function addPreviewRegionOutlineLayers() {
  if (basemapMode !== 'vector') return
  const levelFilter = previewRegionOutlineLevelFilter()
  addRegionLayer({
    id: 'preview-region-selected-halo',
    type: 'line',
    source: 'protomaps',
    'source-layer': PREVIEW_REGION_OUTLINE_SOURCE_LAYER,
    filter: levelFilter,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': MAP_HIGHLIGHT_STYLE.selectedHalo,
      'line-width': regionSelectedHaloWidthExpression(),
      'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.34, 0],
    },
  })
  addRegionLayer({
    id: 'preview-region-selected-line',
    type: 'line',
    source: 'protomaps',
    'source-layer': PREVIEW_REGION_OUTLINE_SOURCE_LAYER,
    filter: levelFilter,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': MAP_HIGHLIGHT_STYLE.selectedLine,
      'line-width': regionHighlightLineWidthExpression('selected'),
      'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.94, 0],
    },
  })
  addRegionLayer({
    id: 'preview-region-hover-line',
    type: 'line',
    source: 'protomaps',
    'source-layer': PREVIEW_REGION_OUTLINE_SOURCE_LAYER,
    filter: levelFilter,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': MAP_HIGHLIGHT_STYLE.hoverLine,
      'line-width': regionHighlightLineWidthExpression('hover'),
      'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0],
    },
  })
}

function addCityFallbackRegionLayers() {
  addCityFallbackLayerPair(
    'region-city-data',
    regionDataFillColorExpression(),
    MAP_HIGHLIGHT_STYLE.dataLine,
    regionDataFillOpacityExpression(),
    regionDataLineOpacityExpression(),
    regionDataLineWidthExpression(),
  )
  addCityFallbackLayerPair(
    'region-city-selected',
    selectedRegionFillColorExpression(),
    MAP_HIGHLIGHT_STYLE.selectedLine,
    selectedRegionFillOpacityExpression(),
    0.92,
    regionHighlightLineWidthExpression('selected'),
  )
  addCityFallbackLayerPair(
    'region-city-hover',
    hoveredRegionFillColorExpression(),
    MAP_HIGHLIGHT_STYLE.hoverLine,
    0,
    1,
    regionHighlightLineWidthExpression('hover'),
  )
}

function addCityFallbackLayerPair(
  sourceId: 'region-city-data' | 'region-city-selected' | 'region-city-hover',
  fillColor: unknown,
  lineColor: string,
  fillOpacity: unknown,
  lineOpacity: unknown,
  lineWidth: unknown,
) {
  addRegionLayer({
    id: `${sourceId}-fill`,
    type: 'fill',
    source: sourceId,
    paint: {
      'fill-color': fillColor,
      'fill-opacity': fillOpacity,
      'fill-antialias': true,
    },
  })
  addRegionLayer({
    id: `${sourceId}-line`,
    type: 'line',
    source: `${sourceId}-lines`,
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': lineColor,
      'line-width': lineWidth,
      'line-opacity': lineOpacity,
    },
  })
}

function addRegionOverlayLayers(
  sourceId: 'region-data' | 'region-selected' | 'region-hover',
  fillColor: unknown,
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
        source: regionSourceMode === 'vector' ? REGION_VECTOR_SOURCE_ID : `${sourceId}-lines`,
        ...(regionSourceMode === 'vector'
          ? { 'source-layer': REGION_VECTOR_LINE_SOURCE_LAYER, filter: options.filter }
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
    source: regionSourceMode === 'vector' ? REGION_VECTOR_SOURCE_ID : `${sourceId}-lines`,
    ...(regionSourceMode === 'vector'
      ? { 'source-layer': REGION_VECTOR_LINE_SOURCE_LAYER, filter: options.filter }
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
  if (regionSourceMode === 'vector') return vectorRegionFillOpacityExpression
  return regionFillOpacityExpression(hasSpecificBiomarker.value)
}

function selectedRegionFillOpacityExpression() {
  // GeoJSON selection uses the original outline-only interaction style.
  return 0
}

function regionDataLineOpacityExpression() {
  if (!hasSpecificBiomarker.value) {
    return [
      'interpolate',
      ['linear'],
      ['zoom'],
      0,
      0.08,
      LEVEL_FADE_COUNTRY_END,
      0.2,
      LEVEL_FADE_CITY_END,
      0.34,
      currentMapMaxZoom(),
      0.42,
    ]
  }
  return [
    'case',
    ['==', ['get', 'hasPndlValue'], true],
    0.34,
    ['==', ['get', 'hasCoverage'], true],
    0.28,
    0.18,
  ]
}

function regionDataLineWidthExpression() {
  return ['interpolate', ['linear'], ['zoom'], 0, 0.48, 8, 1.08]
}

function regionDataFillColorExpression() {
  if (regionSourceMode === 'vector') return vectorRegionFillColorExpression
  if (!hasSpecificBiomarker.value) return MAP_HIGHLIGHT_STYLE.dataFill
  return [
    'case',
    ['==', ['get', 'hasPndlValue'], true],
    ['coalesce', ['get', 'heatColor'], MAP_HIGHLIGHT_STYLE.dataFill],
    ['==', ['get', 'hasCoverage'], true],
    MAP_HIGHLIGHT_STYLE.coverageFill,
    MAP_HIGHLIGHT_STYLE.dataFill,
  ]
}

function selectedRegionFillColorExpression() {
  return regionDataFillColorExpression()
}

function hoveredRegionFillColorExpression() {
  return regionDataFillColorExpression()
}

function regionOverlayOpacityExpression(opacity: number) {
  if (regionSourceMode === 'vector') {
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
  return ['any', ['==', ['get', 'boundaryLevel'], level], ['==', ['get', 'level'], level]]
}

function regionHighlightLineWidthExpression(kind: 'selected' | 'hover') {
  const widths =
    kind === 'selected'
      ? { country: 1.45, admin1: 1.2, city: 0.92 }
      : { country: 1.55, admin1: 1.28, city: 1 }
  return [
    'case',
    regionLevelEqualsExpression('country'),
    widths.country,
    regionLevelEqualsExpression('admin1'),
    widths.admin1,
    widths.city,
  ]
}

function regionSelectedHaloWidthExpression() {
  return [
    'case',
    regionLevelEqualsExpression('country'),
    2.15,
    regionLevelEqualsExpression('admin1'),
    1.72,
    1.32,
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
  mainlandCitiesOnly = false,
  specialAdminMode: 'include' | 'exclude' | 'only' = 'include',
) {
  addMapLayer({
    id,
    type: 'symbol',
    source,
    minzoom,
    ...(maxzoom ? { maxzoom } : {}),
    filter: labelLayerFilter(includeChina, mainlandCitiesOnly, specialAdminMode),
    layout: {
      'text-field': ['get', 'display_name'],
      'text-font': ['Noto Sans Regular'],
      'text-size':
        id === 'country-label'
          ? [
              'interpolate',
              ['linear'],
              ['zoom'],
              minzoom,
              ['to-number', ['coalesce', ['get', 'countryLabelSize'], textSize]],
              8,
              [
                '+',
                ['to-number', ['coalesce', ['get', 'countryLabelSize'], textSize]],
                1.1,
              ],
            ]
          : gentleZoomTextSize(minzoom, textSize, 8, 1.4),
      ...(id === 'country-label'
        ? { 'symbol-sort-key': ['to-number', ['coalesce', ['get', 'countryLabelSort'], 3]] }
        : {}),
      'text-allow-overlap': id === 'china-special-admin-label',
      'text-ignore-placement': id === 'china-special-admin-label',
      'text-padding': id === 'continent-label' ? 22 : id === 'country-label' ? 7 : 10,
    },
    paint: {
      'text-color': id === 'continent-label' ? '#6d7f8a' : '#53616c',
      'text-halo-color': 'rgba(255,255,255,0.94)',
      'text-halo-width': id === 'continent-label' ? 2.2 : 1.8,
      'text-opacity': id === 'continent-label' ? 0.74 : 0.92,
    },
  })
}

function gentleZoomTextSize(minZoom: number, baseSize: number, maxZoom: number, growth: number) {
  return ['interpolate', ['linear'], ['zoom'], minZoom, baseSize, maxZoom, baseSize + growth]
}

function labelLayerFilter(
  includeChina: boolean,
  mainlandCitiesOnly: boolean,
  specialAdminMode: 'include' | 'exclude' | 'only',
) {
  const filters: unknown[] = [['==', ['get', 'labelVisible'], true]]
  if (specialAdminMode !== 'only') filters.push(['!=', ['get', 'hasPndlRegion'], true])
  if (!includeChina) filters.push(['!=', ['get', 'country_key'], 'china'])
  if (regionSourceMode === 'vector' && mainlandCitiesOnly) {
    filters.push(['==', ['get', 'isMainlandCity'], true])
  }
  if (specialAdminMode === 'only') filters.push(['==', ['get', 'isSpecialAdmin'], true])
  if (specialAdminMode === 'exclude') filters.push(['!=', ['get', 'isSpecialAdmin'], true])
  return filters.length === 1 ? filters[0] : ['all', ...filters]
}

function mainlandChinaGeometry() {
  const countries = boundaryCache.get('countries')
  const feature = countries?.features.find((item) => {
    const properties = item.properties ?? {}
    return (
      String(
        properties['ISO3166-1-Alpha-3'] ?? properties.iso_a3 ?? properties.ISO_A3 ?? '',
      ).toUpperCase() === 'CHN'
    )
  })
  return feature?.geometry ?? null
}

function originalVectorLayerFilter(layerId: string) {
  if (activeBasemapConfig.mode !== 'vector') return null
  const layer = activeBasemapConfig.layers.find((item) => isStyleLayer(item) && item.id === layerId)
  return isStyleLayer(layer) ? (layer.filter ?? null) : null
}

function applyMainlandCityLabelAuthority() {
  if (!map || basemapMode !== 'geojson' || !boundaryCache.has('chinaCities')) return
  const layerId = 'places_locality'
  if (!map.getLayer(layerId)) return
  const geometry = mainlandChinaGeometry()
  if (!geometry) return
  map.setFilter(
    layerId,
    excludeGeometryFromFilter(originalVectorLayerFilter(layerId), geometry) as never,
  )
}

function bindLayerEvents() {
  if (!pointLayerEventsBound) {
    map?.on('click', handleUnifiedMapClick)
    map?.on('dblclick', handleUnifiedMapDoubleClick)
    pointLayerEventsBound = true
  }
  regionLayerEventsBound = true
}

function unbindLayerEvents() {
  if (!map) return
  map.off('click', handleUnifiedMapClick)
  map.off('dblclick', handleUnifiedMapDoubleClick)
  pointLayerEventsBound = false
  regionLayerEventsBound = false
}

async function ensureBoundary(name: BoundaryName, refreshCached = false) {
  if (!mapReady.value) return
  if (boundaryCache.has(name)) {
    if (refreshCached) {
      updateBoundarySource(name)
      updateRegionDataSource()
      applyMainlandCityLabelAuthority()
      applyViewLayerVisibility()
    }
    return
  }
  pushBoundaryLoading(name)
  try {
    const [response, lineResponse, specialResponse, specialLineResponse] = await Promise.all([
      fetch(BOUNDARY_URLS[name]),
      regionSourceMode === 'geojson'
        ? fetch(BOUNDARY_LINE_URLS[name]).catch(() => null)
        : Promise.resolve(null),
      name === 'chinaProvinces'
        ? fetch(SPECIAL_ADMIN_URL).catch(() => null)
        : Promise.resolve(null),
      name === 'chinaProvinces' && regionSourceMode === 'geojson'
        ? fetch(SPECIAL_ADMIN_LINE_URL).catch(() => null)
        : Promise.resolve(null),
    ])
    if (!response.ok) throw new Error(`${name} boundary failed`)
    boundaryCache.set(name, (await response.json()) as FeatureCollection)
    if (lineResponse?.ok) {
      boundaryLineCollectionCache.set(name, (await lineResponse.json()) as FeatureCollection)
    }
    if (specialResponse?.ok) {
      specialAdminEnvelopeCollection = (await specialResponse.json()) as FeatureCollection
    }
    if (specialLineResponse?.ok) {
      specialAdminLineCollection = (await specialLineResponse.json()) as FeatureCollection
    }
    cleanedBoundaryCache.delete(name)
    if (!lineResponse?.ok) boundaryLineCollectionCache.delete(name)
    boundaryFeatureIndexCache.delete(name)
    boundaryHitIndexCache.delete(name)
    regionDataCollectionCache = null
    labelPointCollectionCache.delete(name)
    pointCollectionCache.clear()
    displayMapRowsCache.clear()
    if (name === 'chinaCities' || name === 'chinaProvinces') {
      cityLineCollectionCache.clear()
      activeProvinceLineCollectionCache.clear()
      activeCityLineParentKey = ''
    }
    boundaryVersion.value += 1
    updateBoundarySource(name)
    refreshSelectedRegionFromIdentity()
    updatePointSource()
    updateRegionDataSource()
    applyMainlandCityLabelAuthority()
    applyViewLayerVisibility()
    if (name === 'countries') updateMapStatus()
  } catch {
    mapError.value = ui.value.boundaryLoadFailed
  } finally {
    popBoundaryLoading(name)
  }
}

function ensureStagedBoundariesForCurrentZoom(refreshCached = false) {
  if (!mapReady.value) return
  void ensureBoundary('countries', refreshCached)
  if (regionSourceMode === 'vector' && basemapMode === 'vector') {
    void ensureRegionIndex()
    return
  }
  if (activeMapLevel.value !== 'country') {
    void ensureBoundary('admin1', refreshCached)
    void ensureBoundary('chinaProvinces', refreshCached)
  }
  if (activeMapLevel.value === 'city') {
    void ensureBoundary('chinaCities', refreshCached)
  }
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
  syncActiveMapLevel(map?.getZoom() ?? mapZoomLevel.value)
  updateLoadedLabelSources()
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
  if (name === 'chinaCities') {
    updateVisibleCityBoundaryLines(true)
  } else {
    const lineSource = map?.getSource(boundaryLineSourceId(name)) as GeoJSONSource | undefined
    let lineCollection = boundaryLineCollectionCache.get(name)
    if (!lineCollection) {
      lineCollection = polygonBoundariesToLines(collection) as FeatureCollection
      boundaryLineCollectionCache.set(name, lineCollection)
    }
    lineSource?.setData(lineCollection as never)
    if (name === 'chinaProvinces') {
      const specialLineSource = map?.getSource('china-special-admin-boundary-lines') as
        | GeoJSONSource
        | undefined
      specialLineSource?.setData((specialAdminLineCollection ?? EMPTY_COLLECTION) as never)
      updateVisibleCityBoundaryLines(true)
    }
  }
  updateLabelSource(name, collection)
}

function updateVisibleCityBoundaryLines(force = false) {
  if (!map) return
  const citySource = map.getSource('china-city-boundary-lines') as GeoJSONSource | undefined
  const parentSource = map.getSource('china-active-province-boundary-lines') as
    | GeoJSONSource
    | undefined
  if (!citySource || !parentSource) return
  if (activeMapLevel.value !== 'city') {
    if (force || activeCityLineParentKey) {
      citySource.setData(EMPTY_COLLECTION as never)
      parentSource.setData(EMPTY_COLLECTION as never)
      activeCityLineParentKey = ''
    }
    return
  }
  const provinces = getCleanBoundaryCollection('chinaProvinces')
  const cities = getCleanBoundaryCollection('chinaCities')
  if (!provinces || !cities) return
  const bounds = map.getBounds()
  const parentKeys = visibleParentGeoKeys(provinces, [
    bounds.getWest(),
    bounds.getSouth(),
    bounds.getEast(),
    bounds.getNorth(),
  ])
  const cacheKey = parentKeys.join('|')
  if (!force && cacheKey === activeCityLineParentKey) return
  let cityLines = cityLineCollectionCache.get(cacheKey)
  if (!cityLines) {
    const visibleCities = boundaryCollectionForParents(cities, parentKeys)
    cityLines = scopedTopologyLines(boundaryLineCollectionCache.get('chinaCities'), parentKeys)
    if (!cityLines.features.length) {
      cityLines = polygonBoundariesToLines(visibleCities) as FeatureCollection
    }
    cityLineCollectionCache.set(cacheKey, cityLines)
  }
  const visibleProvinces = filterBoundaryFeatures(provinces, (feature) =>
    parentKeys.includes(featureGeoKey(feature, 'admin1')),
  ) as FeatureCollection
  let provinceLines = activeProvinceLineCollectionCache.get(cacheKey)
  if (!provinceLines) {
    provinceLines = boundaryOutlinesForFeatures(visibleProvinces)
    activeProvinceLineCollectionCache.set(cacheKey, provinceLines)
  }
  citySource.setData(cityLines as never)
  parentSource.setData(provinceLines as never)
  activeCityLineParentKey = cacheKey
}

function scopedTopologyLines(
  collection: FeatureCollection | undefined,
  parentKeys: readonly string[],
): FeatureCollection {
  if (!collection) return EMPTY_COLLECTION
  const keys = new Set(parentKeys)
  return filterBoundaryFeatures(collection, (feature) => {
    const parent = String(
      feature.properties.parent_geo_key ?? feature.properties.boundary_group ?? '',
    )
    return keys.has(parent)
  }) as FeatureCollection
}

function boundaryOutlinesForFeatures(collection: FeatureCollection): FeatureCollection {
  const features = collection.features.flatMap((feature) => {
    const geoKey = featureGeoKey(feature, 'admin1')
    if (SPECIAL_ADMIN_GEO_KEYS.has(geoKey)) return []
    return (
      polygonBoundariesToLines({
        type: 'FeatureCollection',
        features: [feature],
      }) as FeatureCollection
    ).features
  })
  return { type: 'FeatureCollection', features }
}

function updateLabelSource(name: BoundaryName, collection: FeatureCollection) {
  const source = map?.getSource(labelSourceId(name)) as GeoJSONSource | undefined
  source?.setData(buildLabelPointCollection(collection, boundaryLevel(name), name) as never)
}

function updateLoadedLabelSources() {
  if (usesControlledLowZoomLabels()) updateContinentLabels()
  ;(['countries', 'admin1', 'chinaProvinces', 'chinaCities'] as BoundaryName[]).forEach((name) => {
    const collection = getCleanBoundaryCollection(name)
    if (collection) updateLabelSource(name, collection)
  })
}

function usesControlledLowZoomLabels() {
  return basemapMode === 'geojson'
}

function getCleanBoundaryCollection(name: BoundaryName) {
  const cached = cleanedBoundaryCache.get(name)
  if (cached) return cached
  const collection = boundaryCache.get(name)
  if (!collection) return null
  const normalized = normalizeBoundaryCollection(cleanBoundaryCollection(collection, name), name)
  const displayNormalized =
    name === 'chinaProvinces'
      ? replaceSpecialAdminDisplayGeometry(normalized, specialAdminEnvelopeCollection)
      : normalized
  const cleaned =
    name === 'chinaCities'
      ? (filterBoundaryFeatures(displayNormalized, (feature) =>
          isMainlandChinaCity(
            featureGeoKey(feature, 'city'),
            String(feature.properties.parent_geo_key ?? ''),
            String(feature.properties.province_key ?? ''),
          ),
        ) as FeatureCollection)
      : displayNormalized
  cleanedBoundaryCache.set(name, cleaned)
  return cleaned
}

function replaceSpecialAdminDisplayGeometry(
  provinces: FeatureCollection,
  envelopes: FeatureCollection | null,
): FeatureCollection {
  if (!envelopes?.features.length) return provinces
  const byKey = new Map(
    envelopes.features.map((feature) => [featureGeoKey(feature, 'admin1'), feature]),
  )
  return {
    type: 'FeatureCollection',
    features: provinces.features.map((feature) => {
      const geoKey = featureGeoKey(feature, 'admin1')
      const envelope = byKey.get(geoKey)
      return envelope
        ? {
            ...feature,
            properties: { ...feature.properties, ...envelope.properties, display_only: true },
            geometry: envelope.geometry,
          }
        : feature
    }),
  }
}

function normalizeBoundaryCollection(
  collection: FeatureCollection,
  name: BoundaryName,
): FeatureCollection {
  if (name !== 'countries') return collection
  const chinaFeatures = collection.features.filter(
    (feature) => canonicalCountryKey(featureGeoKey(feature, 'country')) === 'china',
  )
  if (chinaFeatures.length < 2) return collection

  const base = [...chinaFeatures].sort(
    (left, right) => boundaryFeatureAreaScore(right) - boundaryFeatureAreaScore(left),
  )[0] as GeoJsonFeature
  const polygons = chinaFeatures.flatMap((feature) => geometryPolygons(feature.geometry))
  if (!polygons.length) return collection
  const chinaAliases = new Set<string>(['china'])
  chinaFeatures.forEach((feature) => {
    const props = feature.properties
    ;[
      featureGeoKey(feature, 'country'),
      props.country_key,
      props.region_key,
      props.name,
      props.display_name,
      ...(Array.isArray(props.keys) ? props.keys : []),
    ]
      .filter(Boolean)
      .forEach((value) => chinaAliases.add(String(value)))
  })
  const mergedChina: GeoJsonFeature = {
    ...base,
    properties: {
      ...base.properties,
      country_key: 'china',
      geo_key: 'china',
      region_key: 'china',
      display_name: '中国',
      name: 'China',
      keys: [...chinaAliases],
    },
    geometry: { type: 'MultiPolygon', coordinates: polygons },
  }
  const firstChinaIndex = collection.features.findIndex((feature) =>
    chinaFeatures.includes(feature),
  )
  return {
    type: 'FeatureCollection',
    features: collection.features.flatMap((feature, index) => {
      if (!chinaFeatures.includes(feature)) return [feature]
      return index === firstChinaIndex ? [mergedChina] : []
    }),
  }
}

function geometryPolygons(geometry: unknown) {
  if (!geometry || typeof geometry !== 'object') return []
  const typedGeometry = geometry as { type?: string; coordinates?: unknown }
  if (typedGeometry.type === 'Polygon' && Array.isArray(typedGeometry.coordinates)) {
    return [typedGeometry.coordinates]
  }
  if (typedGeometry.type === 'MultiPolygon' && Array.isArray(typedGeometry.coordinates)) {
    return typedGeometry.coordinates.filter((polygon) => Array.isArray(polygon))
  }
  return []
}

function getBoundaryFeatureIndex(name: BoundaryName) {
  const collection = getCleanBoundaryCollection(name)
  if (!collection) return null
  const cached = boundaryFeatureIndexCache.get(name)
  if (cached?.collection === collection) return cached
  const level = boundaryLevel(name)
  const exact = new Map<string, GeoJsonFeature>()
  const aliases = new Map<string, GeoJsonFeature>()
  collection.features.forEach((feature) => {
    const geoKey = featureGeoKey(feature, level)
    if (geoKey) setBestBoundaryIndexFeature(exact, `${level}|${geoKey}`, feature)
    boundaryFeatureAliases(feature, level).forEach((alias) => {
      const key = boundaryAliasKey(level, alias)
      if (key) setBestBoundaryIndexFeature(aliases, key, feature)
    })
  })
  const index = { collection, exact, aliases }
  boundaryFeatureIndexCache.set(name, index)
  return index
}

function setBestBoundaryIndexFeature(
  index: Map<string, GeoJsonFeature>,
  key: string,
  feature: GeoJsonFeature,
) {
  const existing = index.get(key)
  if (!existing || boundaryFeatureAreaScore(feature) > boundaryFeatureAreaScore(existing)) {
    index.set(key, feature)
  }
}

function boundaryFeatureAreaScore(feature: GeoJsonFeature) {
  const bbox = featureBbox(feature.geometry)
  if (!bbox) return 0
  return Math.abs((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]))
}

function boundaryFeatureAliases(feature: GeoJsonFeature, level: MapRegionStat['level']) {
  const props = feature.properties
  const countryKey = String(props.country_key ?? '')
  const regionKey = String(props.region_key ?? '')
  const propKeys = Array.isArray(props.keys) ? props.keys : []
  return [
    featureGeoKey(feature, level),
    regionKey,
    props.name,
    props.display_name,
    ...propKeys,
    `${countryKey}|${regionKey}`,
    `${countryKey}|${props.name ?? ''}`,
    `${countryKey}|${props.display_name ?? ''}`,
  ]
    .filter(Boolean)
    .flatMap((value) => {
      const stringValue = String(value)
      const keyParts = stringValue
        .split('|')
        .filter((part) => part && normalizeGeoAlias(part) !== normalizeGeoAlias(countryKey))
      return [stringValue, ...keyParts]
    })
}

function boundaryAliasKey(level: MapRegionStat['level'], alias: string) {
  const normalizedAlias = normalizeGeoAlias(alias)
  return normalizedAlias ? `${level}|${normalizedAlias}` : ''
}

function lookupBoundaryFeature(
  name: BoundaryName,
  level: MapRegionStat['level'],
  geoKey: string,
  stat?: MapRegionStat,
) {
  const index = getBoundaryFeatureIndex(name)
  if (!index) return null
  const exact = index.exact.get(`${level}|${geoKey}`)
  if (exact) return exact
  const geoKeyParts = geoKey.split('|')
  const regionPart = geoKeyParts[geoKeyParts.length - 1]
  const targets = [geoKey, regionPart, stat?.displayName, stat?.province, stat?.city, stat?.country]
    .filter(Boolean)
    .flatMap((value) => {
      const stringValue = String(value)
      return [stringValue, ...stringValue.split('|').slice(1)]
    })
  for (const target of targets) {
    const feature = index.aliases.get(boundaryAliasKey(level, target))
    if (feature) return feature
  }
  return null
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
  if (pointSourceRefreshTimer != null) {
    window.clearTimeout(pointSourceRefreshTimer)
    pointSourceRefreshTimer = undefined
  }
  if (missingBusinessLabelsStats !== stats.value) {
    missingBusinessLabelsStats = stats.value
    missingBusinessLabelKeys.clear()
    reportedMissingBusinessLabelSignature = ''
  }
  clearHoveredPoint()
  pointPreparationRevision += 1
  if (pointPreparationHandle != null) {
    if (typeof window.cancelIdleCallback === 'function')
      window.cancelIdleCallback(pointPreparationHandle)
    else globalThis.cancelAnimationFrame(pointPreparationHandle)
    pointPreparationHandle = undefined
  }
  const activeLevel = activeMapLevel.value
  const collection = buildPointCollection(activeLevel)
  const source = map?.getSource(pointSourceId(activeLevel)) as GeoJSONSource | undefined
  source?.setData(collection as never)
  const specialSource = map?.getSource('map-points-special-admin') as GeoJSONSource | undefined
  specialSource?.setData(
    (activeLevel === 'city' ? buildSpecialAdminPointCollection() : EMPTY_COLLECTION) as never,
  )
  scheduleNextPointLevelPreparation(activeLevel, pointPreparationRevision)
  reportMissingBusinessLabels()
}

function scheduleNextPointLevelPreparation(activeLevel: MapDisplayLevel, revision: number) {
  const zoom = map?.getZoom() ?? mapZoomLevel.value
  const nextLevel =
    activeLevel === 'admin1' && zoom >= 5.75 ? 'city' : activeLevel === 'city' ? 'admin1' : null
  if (!nextLevel) return
  const prepare = () => {
    pointPreparationHandle = undefined
    if (revision !== pointPreparationRevision || !map || cameraMoving) return
    mapRenderPhase.value = 'preparing-next'
    const nextCollection = buildPointCollection(nextLevel)
    if (revision !== pointPreparationRevision) return
    const nextSource = map.getSource(pointSourceId(nextLevel)) as GeoJSONSource | undefined
    nextSource?.setData(nextCollection as never)
    if (activeMapLevel.value === activeLevel) mapRenderPhase.value = 'settled'
  }
  if (typeof window.requestIdleCallback === 'function') {
    pointPreparationHandle = window.requestIdleCallback(prepare, { timeout: 160 })
  } else {
    pointPreparationHandle = globalThis.requestAnimationFrame(prepare)
  }
}

function buildSpecialAdminPointCollection(): FeatureCollection {
  const compactHeatIds = compactHeatRegionIdSet('admin1')
  return {
    type: 'FeatureCollection',
    features: displayMapRegionRows('admin1').flatMap((row) => {
      if (!SPECIAL_ADMIN_GEO_KEYS.has(row.geoKey)) return []
      const feature = pointFeatureForRow('admin1', row, compactHeatIds)
      if (!feature) return []
      return [
        {
          ...feature,
          properties: {
            ...feature.properties,
            displayLevel: 'city',
            pointSourceId: 'map-points-special-admin',
          },
        },
      ]
    }),
  }
}

function schedulePointSourceRefresh(delay = 120) {
  if (!mapReady.value || !map) return
  if (pointSourceRefreshTimer != null) window.clearTimeout(pointSourceRefreshTimer)
  pointSourceRefreshTimer = window.setTimeout(() => {
    pointSourceRefreshTimer = undefined
    updatePointSource()
  }, delay)
}

function updateRegionDataSource() {
  updateRegionPaintStyles()
  updateCityFallbackPaintStyles()
  updateSelectedRegionPaintStyles()
  updateCityFallbackRegionSources()
  if (regionSourceMode === 'vector') {
    updateRegionVectorFilters()
    scheduleProgressiveRegionStates(activeMapLevel.value)
    return
  }
  const collection = buildRegionDataCollection()
  setGeoJsonSourceData('region-data', null, collection)
  setGeoJsonLineSourceData('region-data-lines', collection)
}

function updateRegionPaintStyles() {
  if (!map?.getLayer('region-data-fill')) return
  map.setPaintProperty('region-data-fill', 'fill-color', regionDataFillColorExpression() as never)
  map.setPaintProperty(
    'region-data-fill',
    'fill-opacity',
    regionDataFillOpacityExpression() as never,
  )
  if (map.getLayer('region-data-line')) {
    map.setPaintProperty(
      'region-data-line',
      'line-opacity',
      regionDataLineOpacityExpression() as never,
    )
    map.setPaintProperty('region-data-line', 'line-width', regionDataLineWidthExpression() as never)
  }
}

function updateCityFallbackPaintStyles() {
  if (!map?.getLayer('region-city-data-fill')) return
  map.setPaintProperty(
    'region-city-data-fill',
    'fill-color',
    regionDataFillColorExpression() as never,
  )
  map.setPaintProperty(
    'region-city-data-fill',
    'fill-opacity',
    regionDataFillOpacityExpression() as never,
  )
  map.setPaintProperty(
    'region-city-data-line',
    'line-opacity',
    regionDataLineOpacityExpression() as never,
  )
  map.setPaintProperty(
    'region-city-data-line',
    'line-width',
    regionDataLineWidthExpression() as never,
  )
}

function updateSelectedRegionPaintStyles() {
  if (map?.getLayer('region-selected-fill')) {
    map.setPaintProperty(
      'region-selected-fill',
      'fill-color',
      selectedRegionFillColorExpression() as never,
    )
    map.setPaintProperty(
      'region-selected-fill',
      'fill-opacity',
      selectedRegionFillOpacityExpression() as never,
    )
  }
  if (map?.getLayer('region-hover-fill')) {
    map.setPaintProperty(
      'region-hover-fill',
      'fill-color',
      hoveredRegionFillColorExpression() as never,
    )
  }
  if (map?.getLayer('region-city-selected-fill')) {
    map.setPaintProperty(
      'region-city-selected-fill',
      'fill-color',
      selectedRegionFillColorExpression() as never,
    )
    map.setPaintProperty(
      'region-city-selected-fill',
      'fill-opacity',
      selectedRegionFillOpacityExpression() as never,
    )
  }
  if (map?.getLayer('region-city-hover-fill')) {
    map.setPaintProperty(
      'region-city-hover-fill',
      'fill-color',
      hoveredRegionFillColorExpression() as never,
    )
  }
}

function updateRegionHighlightSources() {
  updatePreviewRegionOutlineFeatureState()
  // The composite PMTiles owns hover/selection outlines. Avoid rebuilding
  // GeoJSON line sources or vector filters at pointer frequency.
  if (basemapMode === 'vector') return
  if (regionSourceMode === 'vector') {
    updateRegionVectorFilters()
    updateCityFallbackRegionSources()
    return
  }
  updateCityFallbackRegionSources()
  const hoverCollection = featureCollectionOrEmpty(activeHoveredRegionFeature())
  const selectedCollection = featureCollectionOrEmpty(
    selectedRegionVisibleAtActiveLevel() ? selectedRegionFeature.value : null,
  )
  setGeoJsonSourceData('region-hover', null, hoverCollection)
  setGeoJsonLineSourceData('region-hover-lines', hoverCollection)
  setGeoJsonSourceData('region-selected', null, selectedCollection)
  setGeoJsonLineSourceData('region-selected-lines', selectedCollection)
}

function updatePreviewRegionOutlineFeatureState() {
  if (basemapMode !== 'vector') return
  const nextSelectedId = visibleSelectedRegionId()
  const nextHoveredId = activeHoveredRegionId()
  if (previewSelectedRegionId !== nextSelectedId) {
    setPreviewRegionFeatureState(previewSelectedRegionId, 'selected', false)
    previewSelectedRegionId = nextSelectedId
    setPreviewRegionFeatureState(previewSelectedRegionId, 'selected', true)
  }
  if (previewHoveredRegionId !== nextHoveredId) {
    setPreviewRegionFeatureState(previewHoveredRegionId, 'hover', false)
    previewHoveredRegionId = nextHoveredId
    setPreviewRegionFeatureState(previewHoveredRegionId, 'hover', true)
  }
}

function setPreviewRegionFeatureState(
  regionId: string,
  state: 'selected' | 'hover',
  active: boolean,
) {
  if (!map || !regionId || !map.getSource('protomaps')) return
  try {
    map.setFeatureState(
      {
        source: 'protomaps',
        sourceLayer: PREVIEW_REGION_OUTLINE_SOURCE_LAYER,
        id: regionId,
      },
      { [state]: active },
    )
  } catch {
    // A style replacement can invalidate vector feature state for one frame.
  }
}

function updatePreviewRegionOutlineLevelFilters() {
  if (basemapMode !== 'vector') return
  const filter = previewRegionOutlineLevelFilter()
  PREVIEW_REGION_OUTLINE_LAYER_IDS.forEach((layerId) => {
    if (map?.getLayer(layerId)) map.setFilter(layerId, filter as never)
  })
}

function previewRegionOutlineLevelFilter() {
  if (activeMapLevel.value !== 'city') {
    return ['==', ['get', 'level'], activeMapLevel.value]
  }
  return [
    'any',
    ['==', ['get', 'level'], 'city'],
    [
      'all',
      ['==', ['get', 'level'], 'admin1'],
      ['in', ['get', 'geo_key'], ['literal', [...SPECIAL_ADMIN_GEO_KEYS]]],
    ],
  ]
}

function updateRegionVectorFilters() {
  setRegionLayerFilter(['region-data-fill', 'region-data-line'], previewRegionPolygonLevelFilter())
  setRegionLayerFilter(
    ['region-selected-fill', 'region-selected-halo', 'region-selected-line'],
    regionVectorFilter(
      visibleSelectedRegionId() ? vectorRegionIds([visibleSelectedRegionId()]) : [],
    ),
  )
  setRegionLayerFilter(
    ['region-hover-fill', 'region-hover-line'],
    regionVectorFilter(
      activeHoveredRegionId() ? vectorRegionIds([activeHoveredRegionId() as string]) : [],
    ),
  )
}

function previewRegionPolygonLevelFilter() {
  if (activeMapLevel.value !== 'city') {
    return ['==', ['get', 'level'], activeMapLevel.value]
  }
  return [
    'any',
    ['==', ['get', 'level'], 'city'],
    [
      'all',
      ['==', ['get', 'level'], 'admin1'],
      ['in', ['get', 'geo_key'], ['literal', [...SPECIAL_ADMIN_GEO_KEYS]]],
    ],
  ]
}

function scheduleProgressiveRegionStates(level: MapDisplayLevel) {
  if (!map || regionSourceMode !== 'vector' || !map.getSource(REGION_VECTOR_SOURCE_ID)) return
  progressiveRegionStateRevision += 1
  const revision = progressiveRegionStateRevision
  cancelProgressiveRegionState?.()
  mapRenderPhase.value = level === activeMapLevel.value ? 'transitioning' : 'preparing-next'

  const previousIds = activePolygonStateIds.get(level) ?? new Set<string>()
  const rows = displayHeatRegionRows(level)
  const nextIds = new Set(rows.map(regionIdForStat).filter(Boolean))
  const entries: ProgressiveFeatureState[] = []
  previousIds.forEach((id) => {
    if (!nextIds.has(id)) entries.push({ id, state: { active: false, fillOpacity: 0 } })
  })
  rows.forEach((row) => {
    const id = regionIdForStat(row)
    if (!id) return
    entries.push({
      id,
      state: {
        active: true,
        fillColor: vectorFillColorForStat(row),
        fillOpacity: vectorFillOpacityForStat(row),
      },
    })
  })

  cancelProgressiveRegionState = scheduleProgressiveFeatureState(entries, {
    batchSize: 32,
    budgetMs: 4,
    isCurrent: () => revision === progressiveRegionStateRevision && Boolean(map),
    apply: ({ id, state }) => {
      try {
        map?.setFeatureState(
          {
            source: REGION_VECTOR_SOURCE_ID,
            sourceLayer: PREVIEW_REGION_POLYGON_SOURCE_LAYER,
            id,
          },
          state,
        )
      } catch {
        // Tiles outside the current viewport receive the same promoted state
        // when they are loaded; a concurrent style swap can invalidate one batch.
      }
    },
    onComplete: () => {
      if (revision !== progressiveRegionStateRevision) return
      activePolygonStateIds.set(level, nextIds)
      mapRenderPhase.value = 'settled'
      cancelProgressiveRegionState = undefined
      applyViewLayerVisibility()
    },
  })
}

function vectorFillColorForStat(stat: MapRegionStat) {
  if (!hasSpecificBiomarker.value) return MAP_HIGHLIGHT_STYLE.dataFill
  if (Number(stat.pndlMedianMgD1000inh ?? 0) > 0) return heatColorForStat(stat)
  if (statHasCoverage(stat)) return MAP_HIGHLIGHT_STYLE.coverageFill
  return MAP_HIGHLIGHT_STYLE.dataFill
}

function vectorFillOpacityForStat(stat: MapRegionStat) {
  if (!hasSpecificBiomarker.value) return 0
  const hasPndl = Number(stat.pndlMedianMgD1000inh ?? 0) > 0
  if (hasPndl) return stat.level === 'city' ? 0.76 : stat.level === 'admin1' ? 0.72 : 0.68
  if (statHasCoverage(stat)) {
    return stat.level === 'city' ? 0.34 : stat.level === 'admin1' ? 0.38 : 0.32
  }
  return 0
}

function vectorRegionIds(regionIds: string[]) {
  // Keep the visual business overlay on one geometry source. The PMTiles region
  // layer is still useful when it is complete, but current local tiles can miss
  // country/city ids; the GeoJSON overlay below guarantees every data region is visible.
  void regionIds
  return []
}

function setRegionLayerFilter(layerIds: string[], filter: unknown) {
  if (regionSourceMode !== 'vector') return
  layerIds.forEach((layerId) => {
    if (!map?.getLayer(layerId)) return
    map.setFilter(layerId, filter as never)
  })
}

function updateCityFallbackRegionSources() {
  if (regionSourceMode !== 'vector') {
    setGeoJsonSourceData('region-city-data', null, EMPTY_COLLECTION)
    setGeoJsonLineSourceData('region-city-data-lines', EMPTY_COLLECTION)
    setGeoJsonSourceData('region-city-hover', null, EMPTY_COLLECTION)
    setGeoJsonLineSourceData('region-city-hover-lines', EMPTY_COLLECTION)
    setGeoJsonSourceData('region-city-selected', null, EMPTY_COLLECTION)
    setGeoJsonLineSourceData('region-city-selected-lines', EMPTY_COLLECTION)
    return
  }
  const dataCollection = buildCityFallbackRegionDataCollection()
  const hoverCollection = buildCityFallbackSingleCollection(activeHoveredRegionId(), 'hovered')
  const selectedCollection = buildCityFallbackSingleCollection(selectedRegionId(), 'selected')
  setGeoJsonSourceData('region-city-data', null, dataCollection)
  setGeoJsonLineSourceData('region-city-data-lines', dataCollection)
  setGeoJsonSourceData('region-city-hover', null, hoverCollection)
  setGeoJsonLineSourceData('region-city-hover-lines', hoverCollection)
  setGeoJsonSourceData('region-city-selected', null, selectedCollection)
  setGeoJsonLineSourceData('region-city-selected-lines', selectedCollection)
}

function regionVectorFilter(regionIds: string[]) {
  return regionIds.length
    ? ['in', ['get', 'region_id'], ['literal', regionIds]]
    : ['==', ['get', 'region_id'], '__none__']
}

function dataRegionIds() {
  return [...dataRegionIdSet()]
}

function dataRegionIdSet() {
  return new Set(displayHeatRegionRows().map(regionIdForStat).filter(Boolean))
}

function pointRegionIdSet() {
  return new Set(displayMapRegionRows().map(regionIdForStat).filter(Boolean))
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

function setGeoJsonLineSourceData(sourceId: string, collection: FeatureCollection) {
  const source = map?.getSource(sourceId) as GeoJSONSource | undefined
  source?.setData(polygonBoundariesToLines(collection) as never)
}

function featureCollectionOrEmpty(feature: GeoJsonFeature | null): FeatureCollection {
  return feature ? featureCollectionFromFeature(feature) : EMPTY_COLLECTION
}

function featureCollectionFromFeature(feature: GeoJsonFeature): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [cloneHighlightFeature(feature)],
  }
}

function cloneHighlightFeature(feature: GeoJsonFeature, stat?: MapRegionStat): GeoJsonFeature {
  const regionId = stat ? regionIdForStat(stat) : regionIdFromProperties(feature.properties)
  return {
    type: 'Feature',
    id: feature.id,
    properties: {
      ...feature.properties,
      ...(stat ? statProperties(stat) : {}),
      region_id: regionId,
      heatColor: heatColorForStat(stat),
    },
    geometry: feature.geometry,
  }
}

function buildRegionDataCollection(): FeatureCollection {
  const level = activeMapLevel.value
  if (
    regionDataCollectionCache &&
    regionDataCollectionCache.stats === stats.value &&
    regionDataCollectionCache.boundaryVersion === boundaryVersion.value &&
    regionDataCollectionCache.locale === locale.value &&
    regionDataCollectionCache.level === level
  ) {
    return regionDataCollectionCache.collection
  }
  const compactHeatIds = compactHeatRegionIdSet(level)
  const collection: FeatureCollection = {
    type: 'FeatureCollection',
    features: displayHeatRegionRows(level).flatMap((stat) => heatFeaturesForStat(stat, level)),
  }
  regionDataCollectionCache = {
    stats: stats.value,
    boundaryVersion: boundaryVersion.value,
    locale: locale.value,
    level,
    collection,
  }
  return collection
}

function heatFeaturesForStat(stat: MapRegionStat, displayLevel: MapDisplayLevel) {
  const fallbackBoundaries = inheritedHeatBoundaries(stat, displayLevel)
  if (fallbackBoundaries.length) {
    return fallbackBoundaries.map((feature) => inheritedHeatFeature(feature, stat))
  }
  const feature = boundaryFeatureForStat(stat)
  return feature ? [cloneHighlightFeature(feature, stat)] : []
}

function inheritedHeatBoundaries(stat: MapRegionStat, displayLevel: MapDisplayLevel) {
  if (stat.level === 'admin1' && isUnassignedStat(stat)) {
    return admin1BoundariesForCountry(countryGroupKey(stat))
  }
  if (stat.level === 'city' && isUnassignedStat(stat)) {
    return cityBoundariesForAdmin(unassignedParentGeoKey(stat))
  }
  if (stat.level === 'country' && displayLevel !== 'country') {
    return admin1BoundariesForCountry(countryGroupKey(stat))
  }
  if (stat.level === 'admin1' && displayLevel === 'city' && countryGroupKey(stat) === 'china') {
    return cityBoundariesForAdmin(stat.geoKey)
  }
  return []
}

function admin1BoundariesForCountry(countryKey: string) {
  const collection = getCleanBoundaryCollection(
    countryKey === 'china' ? 'chinaProvinces' : 'admin1',
  )
  if (!collection) return []
  return collection.features.filter(
    (feature) =>
      canonicalCountryKey(
        String(feature.properties.country_key ?? feature.properties.country_display ?? ''),
      ) === canonicalCountryKey(countryKey),
  )
}

function cityBoundariesForAdmin(parentGeoKey: string) {
  const collection = getCleanBoundaryCollection('chinaCities')
  if (!collection || !parentGeoKey) return []
  return collection.features.filter((feature) => {
    const featureParent = String(
      feature.properties.parent_geo_key ?? feature.properties.province_key ?? '',
    )
    return featureParent === parentGeoKey
  })
}

function inheritedHeatFeature(feature: GeoJsonFeature, stat: MapRegionStat) {
  const boundaryLevel: MapRegionStat['level'] =
    stat.level === 'country' || (stat.level === 'admin1' && !isUnassignedStat(stat))
      ? stat.level === 'country'
        ? 'admin1'
        : 'city'
      : stat.level
  const cloned = cloneHighlightFeature(feature, stat)
  return {
    ...cloned,
    properties: {
      ...cloned.properties,
      fallbackDisplayOnly: true,
      boundaryLevel,
      boundaryGeoKey: featureGeoKey(feature, boundaryLevel),
      boundaryDisplayName: localizedBoundaryName(feature, boundaryLevel),
      sourceLevel: stat.level,
      sourceGeoKey: stat.geoKey,
    },
  }
}

function buildCityFallbackRegionDataCollection(): FeatureCollection {
  return buildRegionDataCollection()
}

function buildCityFallbackSingleCollection(
  regionId: string,
  state: 'hovered' | 'selected',
): FeatureCollection {
  const [level, geoKey] = regionId.split('|') as [MapRegionStat['level'], string]
  if (!normalizeMapLevel(level) || !geoKey) return EMPTY_COLLECTION
  const stat = dataRegionStatById(regionId)
  const feature = boundaryFeatureForLevelGeoKey(level, geoKey, stat)
  if (!feature) return EMPTY_COLLECTION
  const cloned = cloneHighlightFeature(feature, stat)
  return {
    type: 'FeatureCollection',
    features: [
      {
        ...cloned,
        properties: {
          ...cloned.properties,
          [state]: true,
        },
      },
    ],
  }
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
  return selectedRegionFeature.value
    ? regionIdFromProperties(selectedRegionFeature.value.properties)
    : ''
}

function selectedRegionVisibleAtActiveLevel() {
  const identity = selectedRegionIdentity.value
  if (!identity) return false
  return (identity.displayLevel ?? identity.level) === activeMapLevel.value
}

function visibleSelectedRegionId() {
  return selectedRegionVisibleAtActiveLevel() ? selectedRegionId() : ''
}

function hoveredRegionId() {
  return hoveredRegionFeature ? regionIdFromProperties(hoveredRegionFeature.properties) : ''
}

function activeHoveredRegionId() {
  const hoverId = hoveredRegionId()
  const hoverDisplayLevel = normalizeMapLevel(
    hoveredRegionFeature?.properties.displayLevel ??
      hoveredRegionFeature?.properties.boundaryLevel ??
      hoveredRegionFeature?.properties.level,
  )
  return hoverId &&
    hoverDisplayLevel === activeMapLevel.value &&
    hoverId !== visibleSelectedRegionId()
    ? hoverId
    : ''
}

function activeHoveredRegionFeature() {
  return activeHoveredRegionId() ? hoveredRegionFeature : null
}

function dataRegionStatById(regionId: string) {
  return (
    displayMapRegionRows().find((row) => regionIdForStat(row) === regionId) ??
    displayRegionRows().find((row) => regionIdForStat(row) === regionId) ??
    findStatByRegionIdAlias(regionId)
  )
}

function cleanBoundaryCollection(
  collection: FeatureCollection,
  name: BoundaryName,
): FeatureCollection {
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
  if (!geometry || typeof geometry !== 'object') return null
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

function declutterPointRows(level: MapDisplayLevel, rows: MapRegionStat[]) {
  if (!map || rows.length < 2) return rows
  const zoom = map.getZoom()
  // Z8 is the terminal inspection view. Real city points with coordinates and
  // names must not be discarded by the screen-space density pass there.
  if (level === 'city' && zoom >= 7.85) return rows
  const selectedId = selectedRegionId()
  const candidates = rows
    .map((row, index) => {
      const coordinates = representativeCoordinates(row)
      if (!coordinates) return null
      const projected = map?.project(coordinates as [number, number])
      if (!projected) return null
      const regionId = regionIdForStat(row)
      const radius = approximateBubbleRadius(level, row, coordinates)
      const area =
        regionIndexEntryFor(row.level, row.geoKey)?.area ??
        primaryPolygonArea(findBoundaryFeature(row)?.geometry)
      const renderedLabelSize = businessLabelSizeAtZoom(
        level,
        zoom,
        Number(row.pointCount ?? 0),
        area,
      )
      const labelWidth = approximateBusinessLabelWidth(
        localizedStatDisplayName(row),
        renderedLabelSize,
      )
      const labelHeight = renderedLabelSize * 1.1
      const halfWidth = Math.max(radius, labelWidth / 2)
      return {
        value: row,
        order: index,
        forceVisible: Boolean(
          regionId && (regionId === selectedId || regionId === selectedPointKey.value),
        ),
        pointCount: Number(row.pointCount ?? 0),
        recordCount: Number(row.recordCount ?? 0),
        area,
        bounds: {
          left: projected.x - halfWidth,
          right: projected.x + halfWidth,
          top: projected.y - radius * 2 - BUBBLE_LABEL_CLEARANCE_PX,
          bottom: projected.y + labelHeight / 2,
        },
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  return declutterScreenSpaceCandidates(candidates, progressiveDeclutterGap(level, zoom))
}

function approximateBubbleRadius(
  level: MapDisplayLevel,
  row: MapRegionStat,
  coordinates: [number, number],
) {
  const bucket = bubbleBucketIndex(level, Number(row.pointCount ?? 0))
  const diameter = BUBBLE_IMAGE_BUCKETS[level][bucket] ?? BUBBLE_IMAGE_BUCKETS[level][0] ?? 24
  return (diameter * bubbleVisualScale(level, row, coordinates)) / 2
}

function approximateBusinessLabelWidth(label: string, renderedSize: number) {
  return approximateMapLabelWidth(label, renderedSize)
}

function enrichBoundaryCollection(collection: FeatureCollection, level: MapRegionStat['level']) {
  return {
    type: 'FeatureCollection',
    features: collection.features.map((feature) => {
      const geoKey = featureGeoKey(feature, level)
      return {
        ...feature,
        properties: {
          ...feature.properties,
          boundaryLevel: level,
          geoKey,
        },
      }
    }),
  }
}

function buildLabelPointCollection(
  collection: FeatureCollection,
  level: MapRegionStat['level'],
  name?: BoundaryName,
) {
  const cached = name ? labelPointCollectionCache.get(name) : undefined
  if (
    cached &&
    cached.stats === stats.value &&
    cached.boundaryVersion === boundaryVersion.value &&
    cached.locale === locale.value &&
    cached.level === activeMapLevel.value
  ) {
    return cached.collection
  }
  const seen = new Set<string>()
  const activeRegionIds = pointRegionIdSet()
  const features = collection.features.flatMap((feature) => {
    const geoKey = featureGeoKey(feature, level)
    if (!geoKey || seen.has(geoKey)) return []
    const regionId = `${level}|${geoKey}`
    const countryLabelArea = level === 'country' ? primaryPolygonArea(feature.geometry) : 0
    const countryLabelStyle = countryLabelStyleForArea(countryLabelArea)
    const indexEntry = regionIndexEntryFor(level, geoKey)
    const coordinates =
      indexEntry?.label_point ??
      indexEntry?.center ??
      labelPointForGeometry(feature.geometry, level === 'country')
    if (!coordinates) return []
    seen.add(geoKey)
    const stat = findStatByLevelGeoKey(level, geoKey, feature.properties)
    const statRegionId = stat ? regionIdForStat(stat) : ''
    const displayName = localizedBoundaryName(feature, level)
    const isMainlandCity =
      level === 'city' &&
      isMainlandChinaCity(
        geoKey,
        String(feature.properties.parent_geo_key ?? ''),
        String(feature.properties.province_key ?? ''),
      )
    return [
      {
        type: 'Feature',
        properties: {
          ...feature.properties,
          display_name: displayName,
          labelVisible: Boolean(displayName) && !isSuppressedCountryAliasLabel(name, geoKey),
          boundaryLevel: level,
          geoKey,
          region_id: statRegionId || regionId,
          hasPndlRegion: activeRegionIds.has(statRegionId || regionId),
          isMainlandCity,
          isSpecialAdmin: SPECIAL_ADMIN_GEO_KEYS.has(geoKey),
          countryLabelArea,
          countryLabelSize: countryLabelStyle.size,
          countryLabelSort: countryLabelStyle.sort,
        },
        geometry: {
          type: 'Point',
          coordinates,
        },
      },
    ]
  })
  const result: FeatureCollection = {
    type: 'FeatureCollection',
    features: features as GeoJsonFeature[],
  }
  if (name) {
    labelPointCollectionCache.set(name, {
      stats: stats.value,
      boundaryVersion: boundaryVersion.value,
      locale: locale.value,
      level: activeMapLevel.value,
      collection: result,
    })
  }
  return result
}

function isSuppressedCountryAliasLabel(name: BoundaryName | undefined, geoKey: string) {
  if (name !== 'countries') return false
  return canonicalCountryKey(geoKey) === 'china' && geoKey !== 'china'
}

function buildPointCollection(level: MapDisplayLevel) {
  const cached = pointCollectionCache.get(level)
  const layoutKey = pointLayoutCacheKey(level)
  if (
    cached &&
    cached.stats === stats.value &&
    cached.boundaryVersion === boundaryVersion.value &&
    cached.locale === locale.value &&
    cached.level === level &&
    cached.specificBiomarker === hasSpecificBiomarker.value &&
    cached.layoutKey === layoutKey
  ) {
    return cached.collection
  }
  const compactHeatIds = compactHeatRegionIdSet(level)
  const collection: FeatureCollection = {
    type: 'FeatureCollection',
    features: declutterPointRows(level, displayMapRegionRows(level)).flatMap((row) => {
      const feature = pointFeatureForRow(level, row, compactHeatIds)
      return feature ? [feature] : []
    }),
  }
  pointCollectionCache.set(level, {
    stats: stats.value,
    boundaryVersion: boundaryVersion.value,
    locale: locale.value,
    level,
    specificBiomarker: hasSpecificBiomarker.value,
    layoutKey,
    collection,
  })
  return collection
}

function pointFeatureForRow(
  level: MapDisplayLevel,
  row: MapRegionStat,
  compactHeatIds: ReadonlySet<string>,
): GeoJsonFeature | null {
  const coordinates = representativeCoordinates(row)
  if (!coordinates) return null
  const properties = statProperties(row)
  const displayName = String(properties.displayName ?? '').trim()
  if (!displayName) {
    missingBusinessLabelKeys.add(`${level}|${row.geoKey}`)
    return null
  }
  const bubbleScale = bubbleVisualScale(level, row, coordinates)
  const boundaryArea =
    regionIndexEntryFor(row.level, row.geoKey)?.area ??
    primaryPolygonArea(findBoundaryFeature(row)?.geometry)
  const pointCount = Number(row.pointCount ?? 0)
  const bubblePresentation = bubblePresentationProperties(
    level,
    pointCount,
    bubbleScale,
    heatColorForStat(row) ?? MAP_HIGHLIGHT_STYLE.dataFill,
  )
  return {
    type: 'Feature',
    id: pointFeatureId(row),
    properties: {
      ...properties,
      displayLevel: level,
      pointSourceId: pointSourceId(level),
      compactHeatFootprint: compactHeatIds.has(regionIdForStat(row)),
      bubbleScale,
      bubbleTextScale: bubbleTextScaleForVisualScale(bubbleScale),
      labelBaseSize: labelBaseSize(level, boundaryArea),
      labelCountTier: labelCountTier(level, pointCount),
      labelScale: labelScaleForPointCount(level, pointCount),
      ...bubblePresentation,
    },
    geometry: { type: 'Point', coordinates },
  }
}

function pointLayoutCacheKey(level: MapDisplayLevel) {
  const canvas = map?.getCanvas()
  const zoom = Math.round((map?.getZoom() ?? mapZoomLevel.value) * 100) / 100
  return [
    level,
    mapMode.value,
    zoom,
    canvas?.clientWidth ?? 0,
    canvas?.clientHeight ?? 0,
    selectedRegionId(),
    selectedPointKey.value,
  ].join('|')
}

function reportMissingBusinessLabels() {
  if (!missingBusinessLabelKeys.size) return
  const keys = [...missingBusinessLabelKeys].sort()
  const signature = keys.join('|')
  if (signature === reportedMissingBusinessLabelSignature) return
  reportedMissingBusinessLabelSignature = signature
  console.warn('Map bubbles omitted because their paired names are missing.', {
    count: keys.length,
    sample: keys.slice(0, 12),
  })
}

function displayPointRows() {
  return displayMapRegionRows()
}

function displayHeatRegionRows(level: MapDisplayLevel = activeMapLevel.value) {
  return displayMapRegionRows(heatRegionLevelForDisplayLevel(level))
}

function compactHeatRegionIdSet(level: MapDisplayLevel) {
  return new Set(
    displayHeatRegionRows(level)
      .filter((row) => usesCompactHeatFootprint(row.level, level))
      .map(regionIdForStat),
  )
}

function displayMapRegionRows(level: MapDisplayLevel = activeMapLevel.value) {
  if (displayMapRowsStats !== stats.value) {
    displayMapRowsStats = stats.value
    displayMapRowsCache.clear()
  }
  const cachedRows = displayMapRowsCache.get(level)
  if (cachedRows) {
    return cachedRows
  }
  const rows = displayRegionRows()
  if (level === 'country') {
    const countryRows = rows.filter(
      (row) => row.level === 'country' && countryGroupKey(row) === row.geoKey,
    )
    const merged = new Map<string, MapRegionStat>()
    countryRows.forEach((row) => {
      const id = regionIdForStat(row)
      if (!merged.has(id)) merged.set(id, row)
    })
    const result = [...merged.values()]
    displayMapRowsCache.set(level, result)
    return result
  }
  const result = selectRowsForDisplayLevel(rows, level, countryGroupKey)
  displayMapRowsCache.set(level, result)
  return result
}

function displayRegionRows() {
  if (displayRegionRowsCache && displayRegionRowsCache.stats === stats.value) {
    return displayRegionRowsCache.rows
  }
  const rows = rawStatRows()
  const byRegionId = new Map<string, MapRegionStat>()
  rows.forEach((row) => {
    const id = regionIdForStat(row)
    if (!id || byRegionId.has(id)) return
    byRegionId.set(id, row)
  })
  const result = [...byRegionId.values()]
  displayRegionRowsCache = { stats: stats.value, rows: result }
  return result
}

function rawStatRows() {
  return stats.value?.regions?.length ? stats.value.regions : (stats.value?.points ?? [])
}

function synthesizeCountryRows(rows: MapRegionStat[]) {
  const groups = groupRowsBy(rows, countryGroupKey)
  return [...groups.entries()].flatMap(([countryKey, group]) => {
    if (!countryKey || group.some((row) => row.level === 'country' && row.geoKey === countryKey)) {
      return []
    }
    return [
      combineStatRows(
        group,
        'country',
        countryKey,
        displayNameForSynthetic('country', countryKey, group),
      ),
    ]
  })
}

function synthesizeAdminRows(rows: MapRegionStat[]) {
  const groups = groupRowsBy(
    rows.filter((row) => row.level === 'city'),
    adminGroupKey,
  )
  return [...groups.entries()].flatMap(([adminKey, group]) => {
    if (!adminKey || rows.some((row) => row.level === 'admin1' && row.geoKey === adminKey))
      return []
    return [
      combineStatRows(
        group,
        'admin1',
        adminKey,
        displayNameForSynthetic('admin1', adminKey, group),
        countryGroupKey(group[0] as MapRegionStat),
      ),
    ]
  })
}

function groupRowsBy(rows: MapRegionStat[], keyGetter: (row: MapRegionStat) => string) {
  const groups = new Map<string, MapRegionStat[]>()
  rows.forEach((row) => {
    const key = keyGetter(row)
    if (!key) return
    groups.set(key, [...(groups.get(key) ?? []), row])
  })
  return groups
}

function combineStatRows(
  rows: MapRegionStat[],
  level: MapRegionStat['level'],
  geoKey: string,
  displayName: string,
  parentGeoKey: string | null = null,
): MapRegionStat {
  const first = rows[0] as MapRegionStat
  const recordCount = sumStat(rows, 'recordCount')
  const pointCount = sumStat(rows, 'pointCount')
  const doiCount = sumStat(rows, 'doiCount')
  const cityCount =
    level === 'country'
      ? uniqueCount(rows.map((row) => (row.level === 'city' ? row.geoKey : (row.city ?? ''))))
      : sumStat(rows, 'cityCount') || uniqueCount(rows.map((row) => row.city ?? row.geoKey))
  const yearCount = Math.max(...rows.map((row) => Number(row.yearCount ?? 0)), 0)
  return {
    ...first,
    level,
    geoKey,
    parentGeoKey,
    displayName,
    country:
      level === 'country'
        ? (first.country ?? displayName)
        : (first.country ?? rows.find((row) => row.country)?.country ?? ''),
    province: level === 'admin1' ? (first.province ?? displayName) : null,
    city: null,
    category: selection.category,
    subcategory: selection.subcategory,
    biomarkerKey: selection.biomarkerKey,
    biomarkerLabel: selectedBiomarkerLabel.value,
    yearLabel: selection.year,
    pndlMedianMgD1000inh: null,
    pndlMinMgD1000inh: minStat(rows, 'pndlMinMgD1000inh'),
    pndlMaxMgD1000inh: maxStat(rows, 'pndlMaxMgD1000inh'),
    recordCount,
    doiCount,
    pointCount,
    yearCount,
    cityCount,
    biomarkerCount: Math.max(...rows.map((row) => Number(row.biomarkerCount ?? 0)), 0),
    pndlRecordCount: 0,
    pndlDoiCount: 0,
    pndlPointCount: 0,
    pndlYearCount: 0,
    pndlSources: first.pndlSources || '地图层级合并显示',
  }
}

function sumStat(rows: MapRegionStat[], key: keyof MapRegionStat) {
  return rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0)
}

function uniqueCount(values: Array<string | null | undefined>) {
  return new Set(values.filter(Boolean)).size
}

function minStat(rows: MapRegionStat[], key: keyof MapRegionStat) {
  const values = rows.map((row) => Number(row[key] ?? 0)).filter((value) => value > 0)
  return values.length ? Math.min(...values) : null
}

function maxStat(rows: MapRegionStat[], key: keyof MapRegionStat) {
  const values = rows.map((row) => Number(row[key] ?? 0)).filter((value) => value > 0)
  return values.length ? Math.max(...values) : null
}

function displayNameForSynthetic(
  level: MapRegionStat['level'],
  geoKey: string,
  rows: MapRegionStat[],
) {
  const exact = rows.find((row) => row.level === level && row.geoKey === geoKey)
  if (exact?.displayName) return exact.displayName
  if (level === 'country')
    return rows.find((row) => row.country)?.country || titleCaseGeoKey(geoKey)
  if (level === 'admin1')
    return rows.find((row) => row.province)?.province || titleCaseGeoKey(geoKey)
  return rows.find((row) => row.city)?.city || titleCaseGeoKey(geoKey)
}

function titleCaseGeoKey(value: string) {
  return (
    value
      .split('|')
      .pop()
      ?.replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (match) => match.toUpperCase()) || value
  )
}

function representativeCoordinates(row: MapRegionStat): [number, number] | null {
  if (isUnassignedStat(row)) {
    const parentFeature = unassignedParentBoundaryFeature(row)
    const parentCenter = parentFeature ? labelPointForGeometry(parentFeature.geometry, true) : null
    if (parentCenter) return parentCenter
  }
  const feature = findBoundaryFeature(row)
  const indexEntry = regionIndexEntryFor(row.level, row.geoKey)
  const suppliedPoint =
    row.latitude != null && row.longitude != null
      ? ([Number(row.longitude), Number(row.latitude)] as [number, number])
      : null
  const indexedLabelPoint = indexEntry?.label_point
  const geometryLabelPoint = feature ? labelPointForGeometry(feature.geometry, true) : null
  const indexedCenter = indexEntry?.center

  // A country aggregate may inherit one reported monitoring coordinate from
  // the API. Keep its bubble at the polygon's cartographic label point so it
  // remains visibly associated with the whole country.
  if (row.level === 'country' && feature) {
    const countryAnchor = [indexedLabelPoint, geometryLabelPoint, indexedCenter].find(
      (point) => point && pointInGeometry(point, feature.geometry),
    )
    if (countryAnchor) return countryAnchor
  }
  // China admin-1 bubbles and the PMTiles province names must share one
  // cartographic anchor. API aggregate coordinates describe the underlying
  // records and can fall into a concavity or a neighbouring province.
  if (row.level === 'admin1' && countryGroupKey(row) === 'china' && feature) {
    const provinceAnchor = [indexedLabelPoint, geometryLabelPoint, indexedCenter].find(
      (point) => point && pointInGeometry(point, feature.geometry),
    )
    if (provinceAnchor) return provinceAnchor
  }
  if (
    feature &&
    suppliedPoint &&
    suppliedPoint.every(Number.isFinite) &&
    pointInGeometry(suppliedPoint, feature.geometry)
  ) {
    return suppliedPoint
  }
  const boundaryCenter = indexedLabelPoint ?? indexedCenter ?? geometryLabelPoint
  if (boundaryCenter && pointInGeometry(boundaryCenter, feature?.geometry)) return boundaryCenter
  return suppliedPoint?.every(Number.isFinite) ? suppliedPoint : null
}

function bubbleVisualScale(
  level: MapDisplayLevel,
  row: MapRegionStat,
  coordinates: [number, number],
) {
  if (level !== 'country' || !isDenseEuropeBubblePoint(coordinates)) return 1
  const feature = findBoundaryFeature(row)
  const area = feature ? primaryPolygonArea(feature.geometry) : 0
  if (area > 0 && area < 1) return 0.6
  if (area > 0 && area < 5) return 0.68
  if (area > 0 && area < 20) return 0.74
  return 0.8
}

function bubbleTextScaleForVisualScale(bubbleScale: number) {
  return Math.round(Math.max(0.9, Math.min(1, 0.75 + bubbleScale * 0.25)) * 100) / 100
}

function bubblePresentationProperties(
  level: MapDisplayLevel,
  pointCount: number,
  bubbleScale: number,
  heatColor: string,
) {
  const bucketIndex = bubbleBucketIndex(level, pointCount)
  const safeScale = Math.max(0.1, bubbleScale)
  const heatColorIndex = Math.max(0, (BUBBLE_HEAT_COLORS as readonly string[]).indexOf(heatColor))
  return {
    bubbleOffsetKey: bubbleOffsetKey(level, bucketIndex, safeScale),
    bubbleRingImage: bubbleRingImageId(level, bucketIndex),
    bubbleHeatImage: bubbleHeatImageId(level, bucketIndex, heatColorIndex),
  }
}

function bubbleOffsetKey(level: MapDisplayLevel, bucketIndex: number, bubbleScale: number) {
  return `${level}:${bucketIndex}:${roundBubbleLayoutValue(bubbleScale)}`
}

function bubbleOffsetValues(level: MapDisplayLevel, bucketIndex: number, bubbleScale: number) {
  const diameter = BUBBLE_IMAGE_BUCKETS[level][bucketIndex] ?? BUBBLE_IMAGE_BUCKETS[level][0] ?? 28
  const safeScale = Math.max(0.1, bubbleScale)
  const iconY = -(diameter * 0.5 + BUBBLE_LABEL_CLEARANCE_PX / safeScale)
  const finalIconOffsetY = iconY * safeScale
  const textScale = bubbleTextScaleForVisualScale(safeScale)
  const renderedTextSize =
    (BUBBLE_COUNT_TEXT_SIZES[level][bucketIndex] ?? BUBBLE_COUNT_TEXT_SIZES[level][0]) * textScale
  return {
    iconY: roundBubbleLayoutValue(iconY),
    textY: roundBubbleLayoutValue(finalIconOffsetY / renderedTextSize - 0.38),
  }
}

function bubbleBucketIndex(level: MapDisplayLevel, pointCount: number) {
  const index = BUBBLE_COUNT_THRESHOLDS[level].findIndex((threshold) => pointCount < threshold)
  return index < 0 ? BUBBLE_IMAGE_BUCKETS[level].length - 1 : index
}

function roundBubbleLayoutValue(value: number) {
  return Math.round(value * 100) / 100
}

function isDenseEuropeBubblePoint([longitude, latitude]: [number, number]) {
  const [west, south, east, north] = DENSE_EUROPE_BUBBLE_BOUNDS
  return longitude >= west && longitude <= east && latitude >= south && latitude <= north
}

function representativeBoundaryCenter(row: MapRegionStat): [number, number] | null {
  const feature = findBoundaryFeature(row)
  return feature ? labelPointForGeometry(feature.geometry) : null
}

function findBoundaryFeature(row: MapRegionStat) {
  const names: BoundaryName[] =
    row.level === 'country'
      ? ['countries']
      : row.level === 'city'
        ? ['chinaCities']
        : isChinaRegion(row)
          ? ['chinaProvinces', 'admin1']
          : ['admin1']
  for (const name of names) {
    const level = boundaryLevel(name)
    const feature = lookupBoundaryFeature(name, level, row.geoKey, row)
    if (feature) return feature
  }
  return null
}

function statProperties(stat: MapRegionStat): Record<string, unknown> {
  const featureId = pointFeatureId(stat)
  const displayName = localizedStatDisplayName(stat)
  return {
    featureId,
    region_id: regionIdForStat(stat),
    level: stat.level,
    geoKey: stat.geoKey,
    parentGeoKey: stat.parentGeoKey ?? '',
    country: stat.country ?? '',
    province: stat.province ?? '',
    city: stat.city ?? '',
    countryKey: countryGroupKey(stat),
    displayName,
    labelVisible: Boolean(displayName),
    isMainlandCity:
      stat.level === 'city' &&
      isMainlandChinaCity(stat.geoKey, stat.parentGeoKey, adminGroupKey(stat)),
    biomarkerLabel: stat.biomarkerLabel,
    specificBiomarker: hasSpecificBiomarker.value,
    isUnassignedAdmin1: isUnassignedAdmin1Stat(stat),
    isUnassigned: isUnassignedStat(stat),
    locationPrecision: locationPrecisionLabel(stat.level),
    pndlMedian: numberOrNull(stat.pndlMedianMgD1000inh),
    hasPndlValue: Number(stat.pndlMedianMgD1000inh ?? 0) > 0,
    hasCoverage: statHasCoverage(stat),
    pndlMin: numberOrNull(stat.pndlMinMgD1000inh),
    pndlMax: numberOrNull(stat.pndlMaxMgD1000inh),
    pndlRank: valueRank(stat.pndlMedianMgD1000inh),
    heatColor: heatColorForStat(stat),
    recordCount: stat.recordCount ?? 0,
    doiCount: stat.doiCount ?? 0,
    yearCount: stat.yearCount ?? 0,
    pointCount: stat.pointCount ?? 0,
    biomarkerCount: stat.biomarkerCount ?? 0,
    pndlRecordCount: stat.pndlRecordCount ?? 0,
    pndlDoiCount: stat.pndlDoiCount ?? 0,
    pndlPointCount: stat.pndlPointCount ?? 0,
    pndlYearCount: stat.pndlYearCount ?? 0,
    pndlSources: stat.pndlSources ?? '',
    pointCountBasis: stat.pointCountBasis ?? 'reported_site_key',
    pointGeometryBasis: stat.pointGeometryBasis ?? 'region_centroid',
    crossDocumentMergeEnabled: stat.crossDocumentMergeEnabled ?? false,
  }
}

function statHasCoverage(stat: MapRegionStat) {
  return (
    Number(stat.recordCount ?? 0) > 0 ||
    Number(stat.doiCount ?? 0) > 0 ||
    Number(stat.pointCount ?? 0) > 0 ||
    Number(stat.biomarkerCount ?? 0) > 0
  )
}

function localizedStatDisplayName(stat: MapRegionStat): string {
  if (isUnassignedStat(stat)) {
    const translationKey = stat.level === 'city' ? 'UNASSIGNED_CITY' : 'UNASSIGNED_ADMIN1'
    const fallbackLabel =
      stat.level === 'city'
        ? locale.value === 'zh'
          ? '未定位到城市'
          : 'Unassigned to city'
        : locale.value === 'zh'
          ? '未定位到省州'
          : 'Unassigned to state/province'
    const parentName = unassignedParentDisplayName(stat)
    const unassignedLabel =
      BACKEND_LABEL_TRANSLATIONS[locale.value][translationKey] || fallbackLabel
    return parentName ? `${parentName} · ${unassignedLabel}` : unassignedLabel
  }
  if (locale.value === 'zh') {
    const chineseName = localizedChineseStatName(stat)
    if (chineseName) return chineseName
    const boundaryFeature = findBoundaryFeature(stat)
    if (boundaryFeature) {
      const boundaryName = localizedBoundaryName(boundaryFeature, stat.level)
      return hasCjk(boundaryName) ? boundaryName : ''
    }
    return ''
  }
  const boundaryFeature = findBoundaryFeature(stat)
  if (boundaryFeature) return localizedBoundaryName(boundaryFeature, stat.level)
  return singleLanguageLabel(stat.displayName, 'en') || stat.displayName
}

function localizedChineseStatName(stat: MapRegionStat) {
  if (stat.level === 'country') {
    if (countryGroupKey(stat) === 'china') return '中国'
    if (hasCjk(stat.country)) return singleLanguageLabel(stat.country as string, 'zh')
    if (hasCjk(stat.displayName)) return singleLanguageLabel(stat.displayName, 'zh')
    return ''
  }
  if (stat.level === 'admin1') {
    const mappedName = chineseAdmin1NameForStat(stat)
    if (mappedName) return mappedName
    if (hasCjk(stat.province)) return singleLanguageLabel(stat.province as string, 'zh')
    if (hasCjk(stat.displayName)) return singleLanguageLabel(stat.displayName, 'zh')
    return ''
  }
  if (hasCjk(stat.city)) return singleLanguageLabel(stat.city as string, 'zh')
  if (hasCjk(stat.displayName)) return singleLanguageLabel(stat.displayName, 'zh')
  return ''
}

function isUnassignedAdmin1Stat(stat: MapRegionStat) {
  return isUnassignedAdmin1GeoKey(stat.level, stat.geoKey)
}

function isUnassignedStat(stat: MapRegionStat) {
  return isUnassignedGeoKey(stat.level, stat.geoKey)
}

function unassignedParentGeoKey(stat: MapRegionStat) {
  if (stat.parentGeoKey) return stat.parentGeoKey
  const parts = stat.geoKey.split('|')
  return parts.length > 1 ? parts.slice(0, -1).join('|') : ''
}

function unassignedParentBoundaryFeature(stat: MapRegionStat) {
  const parentGeoKey = unassignedParentGeoKey(stat)
  if (!parentGeoKey) return null
  const parentLevel: MapRegionStat['level'] = stat.level === 'city' ? 'admin1' : 'country'
  const parentStat = findStatByLevelGeoKey(parentLevel, parentGeoKey)
  return boundaryFeatureForLevelGeoKey(parentLevel, parentGeoKey, parentStat)
}

function unassignedParentDisplayName(stat: MapRegionStat): string {
  const parentGeoKey = unassignedParentGeoKey(stat)
  if (!parentGeoKey) return ''
  const parentLevel: MapRegionStat['level'] = stat.level === 'city' ? 'admin1' : 'country'
  const parentStat = findStatByLevelGeoKey(parentLevel, parentGeoKey)
  if (parentStat) return localizedStatDisplayName(parentStat)
  const feature = boundaryFeatureForLevelGeoKey(parentLevel, parentGeoKey)
  return feature ? localizedBoundaryName(feature, parentLevel) : ''
}

function chineseAdmin1NameForStat(stat: MapRegionStat) {
  const direct = CHINA_ADMIN1_ZH_NAMES[(stat.geoKey ?? '').trim().toLowerCase()]
  if (direct) return direct
  const aliases = [stat.geoKey, stat.geoKey.split('|').pop(), stat.province, stat.displayName]
  for (const alias of aliases) {
    const normalizedAlias = normalizeGeoAlias(String(alias ?? ''))
    if (!normalizedAlias) continue
    for (const [key, label] of Object.entries(CHINA_ADMIN1_ZH_NAMES)) {
      const keyAlias = normalizeGeoAlias(String(key.split('|').pop() ?? ''))
      if (keyAlias && keyAlias === normalizedAlias) return label
    }
  }
  return ''
}

function hasCjk(value: string | null | undefined) {
  return Boolean(value && /[\u3400-\u9fff]/.test(value))
}

function singleLanguageLabel(
  value: string | null | undefined,
  targetLocale: Locale = locale.value,
) {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return ''
  const cleanLoosePunctuation = (label: string) =>
    label
      .replace(/[()（）［］[\]【】]/g, '')
      .replace(/[|/·,，;；:：]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  if (targetLocale === 'zh') {
    if (!hasCjk(normalized)) return ''
    return cleanLoosePunctuation(
      normalized.replace(/[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ\s.'’()/-]*/g, '').replace(/\s+/g, ''),
    )
  }
  return cleanLoosePunctuation(
    normalized.replace(/[\u3400-\u9fff]+/g, '').replace(/[、。！？《》“”‘’]/g, ' '),
  )
}

function localizedPropertyName(props: Record<string, unknown>, fallback = '') {
  const primary = locale.value === 'en' ? props.name : props.display_name
  const secondary = locale.value === 'en' ? props.display_name : props.name
  return (
    singleLanguageLabel(String(primary ?? ''), locale.value) ||
    singleLanguageLabel(String(secondary ?? ''), locale.value) ||
    singleLanguageLabel(String(props.displayName ?? ''), locale.value) ||
    singleLanguageLabel(fallback, locale.value) ||
    fallback
  )
}

function localizedLocationMeta(values: Array<string | null | undefined>) {
  return values
    .map((value) => singleLanguageLabel(value, locale.value))
    .filter(Boolean)
    .join(' · ')
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
  if (row.level === 'country') return canonicalCountryKey(row.geoKey)
  const geoCountry = row.geoKey.split('|')[0]
  if (geoCountry) return canonicalCountryKey(geoCountry)
  const parentCountry = row.parentGeoKey?.split('|')[0]
  return canonicalCountryKey(parentCountry || row.geoKey)
}

function adminGroupKey(row: MapRegionStat) {
  if (row.level === 'admin1') return row.geoKey
  if (row.parentGeoKey?.includes('|')) return row.parentGeoKey
  const [country, admin] = row.geoKey.split('|')
  return country && admin ? `${country}|${admin}` : ''
}

function canonicalCountryKey(value: string | null | undefined) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const countryPart = raw.split('|')[0] || raw
  const alias = normalizeGeoAlias(countryPart)
  return CHINA_COUNTRY_ALIASES.has(alias) ? 'china' : countryPart
}

function localizedBoundaryName(feature: GeoJsonFeature, level: MapRegionStat['level']) {
  const props = feature.properties
  if (locale.value === 'zh' && level === 'country') {
    const alpha2 = String(props['ISO3166-1-Alpha-2'] ?? '').trim()
    if (/^[A-Z]{2}$/i.test(alpha2)) {
      try {
        const displayName = new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(alpha2)
        if (hasCjk(displayName)) return displayName ?? ''
      } catch {
        // Some Natural Earth placeholders use non-standard country codes.
      }
    }
    return (
      localizedFeatureChineseAlias(props) ||
      singleLanguageLabel(String(props.display_name ?? props.name ?? ''), 'zh')
    )
  }
  if (locale.value === 'zh') {
    const directLabel = singleLanguageLabel(String(props.display_name ?? props.name ?? ''), 'zh')
    return directLabel || localizedFeatureChineseAlias(props)
  }
  const primary = locale.value === 'en' ? props.name : props.display_name
  const fallback = locale.value === 'en' ? props.display_name : props.name
  return singleLanguageLabel(String(primary ?? fallback ?? ''), locale.value)
}

function localizedFeatureChineseAlias(props: Record<string, unknown>) {
  const aliases = Array.isArray(props.keys) ? props.keys : []
  for (const alias of aliases) {
    const candidate =
      String(alias ?? '')
        .split('|')
        .pop() ?? ''
    const label = singleLanguageLabel(candidate, 'zh')
    if (label) return label
  }
  return ''
}

function boundaryFeatureMatchesGeoKey(
  feature: GeoJsonFeature,
  level: MapRegionStat['level'],
  geoKey: string,
  stat?: MapRegionStat,
) {
  const props = feature.properties
  const exactGeoKey = featureGeoKey(feature, level)
  if (exactGeoKey === geoKey) return true

  const normalizedTargets = new Set(
    [geoKey, ...geoKey.split('|'), stat?.displayName, stat?.country, stat?.province, stat?.city]
      .filter(Boolean)
      .map((value) => normalizeGeoAlias(String(value))),
  )
  normalizedTargets.delete('')
  if (!normalizedTargets.size) return false

  const countryKey = String(props.country_key ?? '')
  const regionKey = String(props.region_key ?? '')
  const propKeys = Array.isArray(props.keys) ? props.keys : []
  const aliases = [
    exactGeoKey,
    regionKey,
    props.name,
    props.display_name,
    ...propKeys,
    `${countryKey}|${regionKey}`,
    `${countryKey}|${props.name ?? ''}`,
    `${countryKey}|${props.display_name ?? ''}`,
  ]
    .filter(Boolean)
    .map((value) => normalizeGeoAlias(String(value)))

  return aliases.some((alias) => alias && normalizedTargets.has(alias))
}

function normalizeGeoAlias(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/市|省|地区|盟|州|特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区/g, '')
    .replace(/municipality|province|prefecture|autonomousregion|specialadministrativeregion/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function isChinaRegion(row?: Pick<MapRegionStat, 'geoKey' | 'country' | 'displayName'>) {
  if (!row) return false
  return [row.geoKey, row.country, row.displayName]
    .filter(Boolean)
    .map((value) => normalizeGeoAlias(String(value)))
    .some((value) => value === 'china' || value === '中国' || value.startsWith('china'))
}

function locationPrecisionLabel(level: MapRegionStat['level'] | string) {
  if (level === 'city') return ui.value.cityPrecision
  if (level === 'admin1') return ui.value.adminPrecision
  return ui.value.countryPrecision
}

function buildStatLookups() {
  if (statLookupCache?.stats === stats.value) return statLookupCache
  const exact = new Map<string, MapRegionStat>()
  const aliases = new Map<string, MapRegionStat>()
  displayRegionRows().forEach((row) => {
    exact.set(`${row.level}|${row.geoKey}`, row)
    statLookupAliases(row).forEach((alias) => {
      const key = statLookupAliasKey(row.level, alias)
      if (key && !aliases.has(key)) aliases.set(key, row)
    })
  })
  statLookupCache = { stats: stats.value, exact, aliases }
  return statLookupCache
}

function buildStatIndex() {
  return buildStatLookups().exact
}

function statLookupAliasKey(level: string, alias: string) {
  const normalizedAlias = normalizeGeoAlias(alias)
  return normalizedAlias ? `${level}|${normalizedAlias}` : ''
}

function statLookupAliases(row: MapRegionStat) {
  const geoKeyParts = row.geoKey.split('|')
  const regionPart = geoKeyParts[geoKeyParts.length - 1]
  const aliases = [
    row.geoKey,
    regionPart,
    row.displayName,
    row.level === 'country' ? row.country : '',
    row.level === 'admin1' ? row.province : '',
    row.level === 'city' ? row.city : '',
  ]
  return aliases.filter(Boolean).map((value) => String(value))
}

function findStatByRegionIdAlias(regionId: string) {
  const [level, ...geoKeyParts] = regionId.split('|')
  if (!level) return undefined
  return findStatByLevelGeoKey(level, geoKeyParts.join('|'))
}

function findStatByFeatureId(featureId: string) {
  if (!featureId) return undefined
  return displayRegionRows().find((row) => pointFeatureId(row) === featureId)
}

function statFromFeatureProperties(props: Record<string, unknown>): MapRegionStat | undefined {
  const featureId = String(props.featureId ?? '')
  const byFeatureId = findStatByFeatureId(featureId)
  if (byFeatureId) return byFeatureId

  const explicitRegionId = String(props.region_id ?? '')
  const byRegionId = explicitRegionId ? dataRegionStatById(explicitRegionId) : undefined
  if (byRegionId) return byRegionId

  const candidates: Array<[unknown, unknown]> = [
    [props.sourceLevel, props.sourceGeoKey],
    [props.level, props.geoKey],
    [props.boundaryLevel, props.geoKey],
    [props.level, props.geo_key],
    [props.boundaryLevel, props.geo_key],
    [props.sourceLevel, props.geo_key],
  ]
  for (const [levelValue, geoKeyValue] of candidates) {
    const level = normalizeMapLevel(levelValue)
    const geoKey = String(geoKeyValue ?? '')
    if (!level || !geoKey) continue
    const stat = findStatByLevelGeoKey(level, geoKey, props)
    if (stat) return stat
  }

  const derivedRegionId = regionIdFromProperties(props)
  return derivedRegionId ? dataRegionStatById(derivedRegionId) : undefined
}

function rawStatsForDetail() {
  return [...(stats.value?.regions ?? []), ...(stats.value?.points ?? [])]
}

function statAliasSet(stat: MapRegionStat) {
  return new Set(
    [
      stat.geoKey,
      ...stat.geoKey.split('|'),
      stat.displayName,
      stat.country,
      stat.province,
      stat.city,
    ]
      .filter(Boolean)
      .map((value) => normalizeGeoAlias(String(value)))
      .filter(Boolean),
  )
}

function statAliasesOverlap(a: MapRegionStat, b: MapRegionStat) {
  const aliases = statAliasSet(a)
  return [...statAliasSet(b)].some((alias) => aliases.has(alias))
}

function backendStatForMapStat(stat: MapRegionStat) {
  const rows = rawStatsForDetail()
  return (
    rows.find(
      (row) => row.level === stat.level && row.geoKey === stat.geoKey && statHasBackendData(row),
    ) ??
    rows.find(
      (row) => row.level === stat.level && statAliasesOverlap(row, stat) && statHasBackendData(row),
    ) ??
    undefined
  )
}

function findStatByLevelGeoKey(
  level: string,
  geoKey: string,
  props?: Record<string, unknown>,
): MapRegionStat | undefined {
  const lookups = buildStatLookups()
  const exact = lookups.exact.get(`${level}|${geoKey}`)
  if (exact) return exact
  const propKeys = Array.isArray(props?.keys) ? props.keys : []
  const geoKeyParts = geoKey.split('|')
  const regionPart = geoKeyParts[geoKeyParts.length - 1]
  const normalizedTargets = new Set(
    [
      geoKey,
      regionPart,
      props?.geoKey,
      props?.sourceGeoKey,
      props?.geo_key,
      props?.region_key,
      props?.name,
      props?.display_name,
      ...propKeys,
    ]
      .filter(Boolean)
      .map((value) => normalizeGeoAlias(String(value))),
  )
  normalizedTargets.delete('')
  if (!normalizedTargets.size) return undefined
  for (const target of normalizedTargets) {
    const stat = lookups.aliases.get(`${level}|${target}`)
    if (stat) return stat
  }
  return undefined
}

function buildSearchCandidates() {
  const candidates = new Map<string, MapSearchResult>()
  ;[...(stats.value?.points ?? []), ...(stats.value?.regions ?? [])].forEach((row) => {
    if (isUnassignedStat(row)) return
    if (
      row.level === 'city' &&
      countryGroupKey(row) === 'china' &&
      !isMainlandChinaCity(row.geoKey, row.parentGeoKey, adminGroupKey(row))
    ) {
      return
    }
    const label = localizedSearchResultLabel(
      row.geoKey,
      localizedStatDisplayName(row) || singleLanguageLabel(row.displayName, locale.value),
    )
    if (!label) return
    const viewportFeature = findBoundaryFeature(row)
    const indexEntry = regionIndexEntryFor(row.level, row.geoKey)
    const center =
      (viewportFeature ? labelPointForGeometry(viewportFeature.geometry, true) : null) ??
      representativeCoordinates(row) ??
      indexEntry?.center ??
      undefined
    addSearchCandidate(candidates, {
      id: `stat|${row.level}|${row.geoKey}`,
      label,
      meta: localizedLocationMeta([
        locationPrecisionLabel(row.level),
        row.country,
        row.province,
        row.city,
      ]),
      level: row.level,
      geoKey: row.geoKey,
      center,
      bbox: viewportFeature
        ? (featureBbox(viewportFeature.geometry) ?? indexEntry?.bbox)
        : indexEntry?.bbox,
    })
  })
  boundarySearchCandidates(candidates)
  return [...candidates.values()]
}

function boundarySearchCandidates(candidates: Map<string, MapSearchResult>) {
  if (regionIndexEntries.length) {
    regionIndexEntries.forEach((entry) => {
      if (isUnassignedGeoKey(entry.level, entry.geo_key)) return
      addSearchCandidate(candidates, {
        id: `index|${entry.level}|${entry.geo_key}`,
        label: localizedRegionIndexName(entry),
        meta: localizedLocationMeta([locationPrecisionLabel(entry.level), entry.country_key]),
        level: entry.level,
        geoKey: entry.geo_key,
        center: entry.center,
        bbox: entry.bbox,
      })
    })
    return
  }
  ;(['countries', 'admin1', 'chinaProvinces', 'chinaCities'] as BoundaryName[]).forEach((name) => {
    const collection = getCleanBoundaryCollection(name)
    if (!collection) return
    const level = boundaryLevel(name)
    collection.features.forEach((feature) => {
      const props = feature.properties
      const label = localizedBoundaryName(feature, level)
      if (!label) return
      const geoKey = featureGeoKey(feature, level)
      addSearchCandidate(candidates, {
        id: `boundary|${level}|${geoKey}`,
        label,
        meta: localizedLocationMeta([
          locationPrecisionLabel(level),
          String(props.country_display ?? ''),
        ]),
        level,
        geoKey,
        center: labelPointForGeometry(feature.geometry) ?? undefined,
        bbox: featureBbox(feature.geometry) ?? undefined,
      })
    })
  })
}

function localizedRegionIndexName(entry: RegionIndexEntry) {
  const fallback =
    locale.value === 'en'
      ? entry.name || entry.display_name || entry.geo_key
      : entry.display_name || entry.name || entry.geo_key
  return localizedSearchResultLabel(entry.geo_key, fallback)
}

function localizedSearchResultLabel(geoKey: string, fallback: string) {
  if (locale.value !== 'en') return fallback
  if (geoKey === 'china|hongkong') return 'Hong Kong'
  if (geoKey === 'china|aomen') return 'Macao'
  return fallback
}

function addSearchCandidate(candidates: Map<string, MapSearchResult>, candidate: MapSearchResult) {
  const key = `${candidate.level}|${candidate.geoKey}`
  const existing = candidates.get(key)
  if (!existing) {
    candidates.set(key, candidate)
    return
  }
  candidates.set(key, {
    ...existing,
    center: existing.center ?? candidate.center,
    bbox: existing.bbox ?? candidate.bbox,
  })
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function searchCandidateMatches(item: MapSearchResult, query: string) {
  const aliases = SPECIAL_ADMIN_SEARCH_ALIASES[item.geoKey] ?? []
  const haystack = normalizeSearch(`${item.label} ${item.meta} ${item.geoKey} ${aliases.join(' ')}`)
  if (haystack.includes(query)) return true
  return compactSearch(haystack).includes(compactSearch(query))
}

function compactSearch(value: string) {
  return value.replace(/[\s_-]+/g, '')
}

function openSearch() {
  if (searchBlurTimer) window.clearTimeout(searchBlurTimer)
  isSearchFocused.value = true
  void ensureRegionIndex()
  if (regionSourceMode === 'vector') {
    return
  }
  void ensureBoundary('admin1')
  void ensureBoundary('chinaProvinces')
  void ensureBoundary('chinaCities')
}

function regionIndexEntryFor(level: MapRegionStat['level'], geoKey: string) {
  return regionIndexByKey.get(`${level}|${geoKey}`)
}

async function ensureRegionIndex() {
  if (regionIndexEntries.length) return
  if (regionIndexPromise) return regionIndexPromise
  regionIndexPromise = (async () => {
    try {
      const response = await fetch(REGION_INDEX_URL)
      if (!response.ok) return
      const payload = (await response.json()) as { regions?: RegionIndexEntry[] }
      regionIndexEntries = Array.isArray(payload.regions) ? payload.regions : []
      regionIndexByKey.clear()
      regionIndexEntries.forEach((entry) => {
        if (!entry?.geo_key || !entry?.level) return
        regionIndexByKey.set(`${entry.level}|${entry.geo_key}`, entry)
      })
      labelPointCollectionCache.clear()
      pointCollectionCache.clear()
      regionIndexVersion.value += 1
    } catch {
      // Search falls back to the currently loaded boundaries.
    }
  })().finally(() => {
    regionIndexPromise = null
  })
  return regionIndexPromise
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
  cancelPendingMapClick()
  clearHoveredPoint()
  setHoveredRegion(null)
  hideTooltip()
  searchQuery.value = result.label
  isSearchFocused.value = false
  const feature =
    boundaryFeatureForLevelGeoKey(result.level, result.geoKey) ??
    regionReferenceFeatureFromProperties({
      level: result.level,
      geoKey: result.geoKey,
      displayName: result.label,
    })
  const targetZoom = searchZoomForLevel(result.level, result.geoKey)
  setSelectedRegion(feature, {
    level: result.level,
    geoKey: result.geoKey,
    displayLevel: mapDisplayLevelForZoom(targetZoom),
  })
  clearSelectedPoint()
  pointCollectionCache.clear()
  schedulePointSourceRefresh(0)
  map.stop()
  if (result.bbox) {
    map.fitBounds(
      [
        [result.bbox[0], result.bbox[1]],
        [result.bbox[2], result.bbox[3]],
      ] as LngLatBoundsLike,
      {
        padding: {
          top: 90,
          right: window.innerWidth >= 900 ? 96 : 44,
          bottom: window.innerWidth >= 760 ? 80 : 170,
          left: window.innerWidth >= 900 ? 96 : 44,
        },
        duration: 720,
        maxZoom: clampZoom(targetZoom),
      },
    )
    return
  }
  if (result.center) {
    map.easeTo({
      center: result.center,
      zoom: clampZoom(targetZoom),
      duration: 720,
      essential: true,
    })
  }
}

function searchZoomForLevel(level: MapRegionStat['level'], geoKey = '') {
  if (SPECIAL_ADMIN_GEO_KEYS.has(geoKey)) return Math.min(7.4, currentMapMaxZoom())
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

function heatColorForStat(stat?: MapRegionStat) {
  if (!hasSpecificBiomarker.value || !stat) return MAP_HIGHLIGHT_STYLE.dataFill
  return heatColorForValue(Number(stat.pndlMedianMgD1000inh ?? 0))
}

function heatColorForValue(value: number) {
  if (!Number.isFinite(value) || value <= 0) return MAP_HIGHLIGHT_STYLE.dataFill
  const min = regionHeatMin.value
  const max = regionHeatMax.value
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= 0) {
    return MAP_HIGHLIGHT_STYLE.dataFill
  }
  if (max <= min) return MAP_HEAT_COLORS[Math.floor(MAP_HEAT_COLORS.length / 2)]
  const index = temperatureBandIndex(value, min, max, MAP_HEAT_COLORS.length)
  return MAP_HEAT_COLORS[index]
}

function heatLegendMiddleValue(min: number, max: number) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= 0) return 0
  if (min <= 0 || max <= min) return max
  return max / min > 100
    ? 10 ** ((Math.log10(min + 1) + Math.log10(max + 1)) / 2) - 1
    : (min + max) / 2
}

function featureGeoKey(feature: GeoJsonFeature, level: MapRegionStat['level']) {
  const props = feature.properties
  const explicitGeoKey = String(props.geo_key ?? props.geoKey ?? '').trim()
  if (explicitGeoKey) return explicitGeoKey
  if (level === 'country') return String(props.country_key ?? '')
  if (level === 'admin1' && String(props.country_key ?? '') === 'china') {
    const canonicalChinaKey = canonicalChinaAdminBoundaryKey(props)
    if (canonicalChinaKey) return canonicalChinaKey
  }
  return `${String(props.country_key ?? '')}|${String(props.region_key ?? '')}`
}

function canonicalChinaAdminBoundaryKey(props: Record<string, unknown>) {
  const keys = Array.isArray(props.keys) ? props.keys.map((key) => String(key)) : []
  return keys.find((key) => /^china\|[a-z][a-z0-9-]*$/i.test(key)) || ''
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

function boundaryLineSourceId(name: BoundaryName) {
  if (name === 'countries') return 'country-boundary-lines'
  if (name === 'admin1') return 'admin1-boundary-lines'
  if (name === 'chinaProvinces') return 'china-province-boundary-lines'
  return 'china-city-boundary-lines'
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
    stats.value = await fetchMapStats(
      { ...selection },
      ['country', 'admin1', 'city'],
      statsController.signal,
    )
    invalidateMapDisplayCaches()
    ensureFallbackBoundaries()
    ensureStagedBoundariesForCurrentZoom()
    updateMapData()
    focusGlobeOnDensePoints()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    filterError.value = getUserErrorMessage(error, ui.value.statsLoadFailed)
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
    zoom: clampZoom(Math.max(map.getZoom(), safeZoom)),
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

function ensureFallbackBoundaries(refreshCached = false) {
  ensureStagedBoundariesForCurrentZoom(refreshCached)
}

function handleUnifiedMapClick(event: MapMouseEvent) {
  closeSearch()
  const pointFeature = bestPointFeatureAtPoint(event.point)
  if (pointFeature?.properties) {
    centerNearestWorldCopyForFeature(pointFeature)
    if (isClusterFeature(pointFeature.properties)) {
      scheduleClusterDetailOpen(pointFeature)
      return
    }
    setSelectedPoint(pointFeature)
    selectMatchingBoundaryForPoint(pointFeature)
    scheduleDetailOpen(pointFeature)
    return
  }
  const regionFeature = bestRegionFeatureAtPoint(event.point)
  if (!regionFeature?.properties) return
  centerNearestWorldCopyForFeature(regionFeature)
  setSelectedRegion(regionFeature)
  clearSelectedPoint()
  scheduleDetailOpen(regionFeature)
}

function handleUnifiedMapDoubleClick(event: MapMouseEvent) {
  event.preventDefault()
  if (clickTimer) window.clearTimeout(clickTimer)
  clickTimer = undefined
  closeSearch()
  const feature = bestPointFeatureAtPoint(event.point) ?? bestRegionFeatureAtPoint(event.point)
  if (!feature?.properties) return
  centerNearestWorldCopyForFeature(feature)
  if (isClusterFeature(feature.properties)) {
    void openClusterDetail(feature, 'full')
    return
  }
  if (isRegionFeature(feature)) {
    setSelectedRegion(feature)
    clearSelectedPoint()
  } else {
    setSelectedPoint(feature)
    selectMatchingBoundaryForPoint(feature)
  }
  void openFeatureDetail(feature, 'full')
}

function handlePointClick(event: MapLayerMouseEvent) {
  closeSearch()
  const feature = bestPointFeatureAtPoint(event.point)
  if (!feature?.properties) return
  centerNearestWorldCopyForFeature(feature)
  if (isClusterFeature(feature.properties)) {
    scheduleClusterDetailOpen(feature)
    return
  }
  setSelectedPoint(feature)
  selectMatchingBoundaryForPoint(feature)
  scheduleDetailOpen(feature)
}

function handleRegionClick(event: MapLayerMouseEvent) {
  closeSearch()
  if (pointFeaturesAtPoint(event.point).length) return
  const feature = bestRegionFeatureAtPoint(event.point)
  if (!feature?.properties) return
  centerNearestWorldCopyForFeature(feature)
  setSelectedRegion(feature)
  clearSelectedPoint()
  scheduleDetailOpen(feature)
}

function scheduleDetailOpen(feature: GeoJsonFeature) {
  if (clickTimer) window.clearTimeout(clickTimer)
  clickTimer = window.setTimeout(() => {
    clickTimer = undefined
    void openFeatureDetail(feature)
  }, 260)
}

function scheduleClusterDetailOpen(feature: GeoJsonFeature) {
  if (clickTimer) window.clearTimeout(clickTimer)
  clickTimer = window.setTimeout(() => {
    clickTimer = undefined
    void openClusterDetail(feature)
  }, 260)
}

function cancelPendingMapClick() {
  if (clickTimer == null) return
  window.clearTimeout(clickTimer)
  clickTimer = undefined
}

function focusCompactDetailTarget(feature: GeoJsonFeature) {
  if (!map || window.innerWidth < 900) return
  centerNearestWorldCopyForFeature(feature, 420)
}

function centerNearestWorldCopyForFeature(feature: GeoJsonFeature, duration = 420) {
  if (!map || mapMode.value !== 'flat') return
  const target = detailTargetFromFeature(feature)
  const indexEntry = target ? regionIndexEntryFor(target.level, target.geoKey) : undefined
  const targetCenter =
    (target?.stat ? representativeCoordinates(target.stat) : null) ??
    indexEntry?.label_point ??
    indexEntry?.center ??
    pointCoordinates(feature) ??
    compactDetailRegionCenter(feature)
  if (!targetCenter) return
  const wrappedCenter = nearestWorldCopyCoordinate(targetCenter, map.getCenter().lng)
  try {
    map.stop()
    map.easeTo({
      center: wrappedCenter,
      offset: [0, 0],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      duration,
      essential: true,
    })
  } catch {
    // A concurrent style refresh must not turn successful detail data into an error state.
  }
}

function compactDetailRegionCenter(feature: GeoJsonFeature): [number, number] | null {
  const target = detailTargetFromFeature(feature)
  const geometryCenter =
    labelPointForGeometry(feature.geometry) ?? bboxCenter(featureBbox(feature.geometry))
  if (geometryCenter) return geometryCenter
  const detailStat = detailRegion.value
  if (detailStat?.latitude != null && detailStat.longitude != null) {
    return [Number(detailStat.longitude), Number(detailStat.latitude)]
  }
  const stat =
    target?.level && target.geoKey
      ? (target.stat ??
        buildStatIndex().get(`${target.level}|${target.geoKey}`) ??
        statLikeFromProperties(feature.properties, target.level, target.geoKey))
      : undefined
  if (stat) {
    const coordinates = representativeCoordinates(stat)
    if (coordinates) return coordinates
  }
  return labelPointForGeometry(feature.geometry) ?? pointCoordinates(feature)
}

async function openFeatureDetail(feature: GeoJsonFeature, mode: DetailMode = 'compact') {
  const target = detailTargetFromFeature(feature)
  if (!target) return
  const requestId = ++detailRequestId
  hideTooltip()
  detailController?.abort()
  detailController = new AbortController()
  selectedDetail.value = null
  isLoadingDetail.value = true
  detailMode.value = mode === 'compact' ? 'compact' : 'none'
  detailOrigin.value = 'region'
  fullDetailShouldRestoreCompact.value = false
  detailError.value = ''
  try {
    let detail = await fetchMapDetail(
      target.level,
      target.geoKey,
      { ...selection },
      detailController.signal,
    )
    if (requestId !== detailRequestId) return
    const retryStat = target.stat ? backendStatForMapStat(target.stat) : undefined
    if (
      target.stat &&
      statHasBackendData(target.stat) &&
      !detailHasBackendData(detail) &&
      retryStat &&
      (retryStat.level !== target.level || retryStat.geoKey !== target.geoKey)
    ) {
      detail = await fetchMapDetail(
        retryStat.level,
        retryStat.geoKey,
        { ...selection },
        detailController.signal,
      )
      if (requestId !== detailRequestId) return
    }
    if (target.stat && statHasBackendData(target.stat) && !detailHasBackendData(detail)) {
      selectedDetail.value = null
      detailError.value = ui.value.emptyBackendDetail
      detailMode.value = 'none'
      return
    }
    selectedDetail.value = detail
    detailMode.value = mode
    if (mode === 'compact') {
      await nextTick()
      focusCompactDetailTarget(feature)
    }
  } catch (error) {
    if (requestId !== detailRequestId) return
    if (error instanceof DOMException && error.name === 'AbortError') return
    detailError.value = getUserErrorMessage(error, ui.value.detailLoadFailed)
    detailMode.value = mode === 'compact' ? 'compact' : 'none'
  } finally {
    if (requestId === detailRequestId) isLoadingDetail.value = false
  }
}

async function openClusterDetail(feature: GeoJsonFeature, mode: DetailMode = 'compact') {
  if (!map) return
  const clusterId = Number(feature.properties.cluster_id)
  if (Number.isNaN(clusterId)) return
  const requestId = ++detailRequestId
  hideTooltip()
  detailController?.abort()
  detailController = new AbortController()
  selectedDetail.value = null
  isLoadingDetail.value = true
  detailMode.value = mode === 'compact' ? 'compact' : 'none'
  detailOrigin.value = 'cluster'
  fullDetailShouldRestoreCompact.value = false
  detailError.value = ''
  try {
    const locations = await clusterLocations(clusterId, Number(feature.properties.point_count ?? 0))
    const detail = await fetchMapClusterDetail({ ...selection }, locations, detailController.signal)
    if (requestId !== detailRequestId) return
    selectedDetail.value = detail
    detailMode.value = mode
  } catch (error) {
    if (requestId !== detailRequestId) return
    if (error instanceof DOMException && error.name === 'AbortError') return
    detailError.value = getUserErrorMessage(error, ui.value.detailLoadFailed)
    detailMode.value = 'compact'
  } finally {
    if (requestId === detailRequestId) isLoadingDetail.value = false
  }
}

async function clusterLocations(
  clusterId: number,
  pointCount: number,
): Promise<MapClusterLocationRequest[]> {
  const source = map?.getSource('map-points') as ClusterGeoJSONSource | undefined
  const leaves = await source?.getClusterLeaves?.(
    clusterId,
    Math.min(Math.max(pointCount, 1), 120),
    0,
  )
  const locations = new Map<string, MapClusterLocationRequest>()
  ;(leaves ?? []).forEach((leaf) => {
    const target = canonicalDetailTargetFromFeature(leaf as GeoJsonFeature)
    const level = target?.level
    const geoKey = target?.geoKey
    if (!level || !geoKey) return
    locations.set(`${level}|${geoKey}`, { level, geoKey })
  })
  return Array.from(locations.values())
}

function handleFeatureDoubleClick(event: MapLayerMouseEvent) {
  event.preventDefault()
  if (clickTimer) window.clearTimeout(clickTimer)
  clickTimer = undefined
  const firstFeature = event.features?.[0] as GeoJsonFeature | undefined
  if (isRegionFeature(firstFeature) && pointFeaturesAtPoint(event.point).length) return
  const feature = isRegionFeature(firstFeature)
    ? bestRegionFeatureAtPoint(event.point)
    : (visiblePointFeatureFromEvent(event) ?? bestPointFeatureAtPoint(event.point))
  if (!feature?.properties) return
  if (isClusterFeature(feature.properties)) {
    void openClusterDetail(feature, 'full')
    return
  }
  if (isRegionFeature(feature)) {
    setSelectedRegion(feature)
    clearSelectedPoint()
  } else {
    setSelectedPoint(feature)
    selectMatchingBoundaryForPoint(feature)
  }
  void openFeatureDetail(feature, 'full')
}

function clearHoverForCameraMove() {
  if (unifiedHoverFrame != null) {
    window.cancelAnimationFrame(unifiedHoverFrame)
    unifiedHoverFrame = undefined
  }
  if (hoverRefreshFrame != null) {
    window.cancelAnimationFrame(hoverRefreshFrame)
    hoverRefreshFrame = undefined
  }
  clearHoveredPoint()
  setHoveredRegion(null)
  hideTooltip()
}

function scheduleHoverRefreshAtCursor() {
  if (!map || !pendingCursorPixel) return
  if (hoverRefreshFrame != null) window.cancelAnimationFrame(hoverRefreshFrame)
  hoverRefreshFrame = window.requestAnimationFrame(() => {
    hoverRefreshFrame = undefined
    refreshHoverAtCursor()
  })
}

function cameraInteractionActive() {
  if (!map) return cameraMoving
  // MapLibre may emit an initial movestart before our listeners are fully
  // attached. Reconcile the cached flag with the renderer so hover cannot
  // remain permanently suspended after a fast zoom, drag, or style reload.
  if (cameraMoving && !map.isMoving()) cameraMoving = false
  return cameraMoving
}

function refreshHoverAtCursor() {
  if (!map || !pendingCursorPixel || cameraInteractionActive()) return
  const point = map.project(map.unproject(pendingCursorPixel)) as MapMouseEvent['point']
  sampleUnifiedHover(point, map.unproject(pendingCursorPixel))
}

function hideTooltipOnEmptyClick(event: MapMouseEvent) {
  closeSearch()
  isLayerPanelOpen.value = false
  isLanguageMenuOpen.value = false
  if (!pointFeaturesAtPoint(event.point).length && !bestRegionFeatureAtPoint(event.point)) {
    hideTooltip()
  }
}

function showFeatureTooltip(feature: GeoJsonFeature, lngLat: MapLayerMouseEvent['lngLat']) {
  if (!map || !hoverPopup) return
  map.getCanvas().style.cursor = 'pointer'
  const tooltipKey = regionFeatureKey(feature) || String(pointFeatureStateId(feature) ?? '')
  hoverPopup.setLngLat(lngLat)
  if (hoverPopupFeatureKey !== tooltipKey) {
    hoverPopup.setHTML(buildTooltipHtml(feature.properties))
    hoverPopupFeatureKey = tooltipKey
    hoverPopup.addTo(map)
    return
  }
  if (!hoverPopup.isOpen()) hoverPopup.addTo(map)
}

function hideTooltip() {
  if (map) map.getCanvas().style.cursor = ''
  if (regionTooltipTimer) {
    window.clearTimeout(regionTooltipTimer)
    regionTooltipTimer = undefined
  }
  hoverPopupFeatureKey = ''
  hoverPopup?.remove()
}

function hoverMatchingBoundaryForPoint(feature: GeoJsonFeature) {
  const props = feature.properties
  const boundaryFeature =
    regionSourceMode === 'vector'
      ? regionReferenceFeatureFromProperties(props)
      : (boundaryFeatureForProperties(props) ?? regionReferenceFeatureFromProperties(props))
  setHoveredRegion(
    boundaryFeature
      ? {
          ...boundaryFeature,
          properties: {
            ...boundaryFeature.properties,
            displayLevel:
              normalizeMapLevel(props.displayLevel) ||
              normalizeMapLevel(boundaryFeature.properties.level),
          },
        }
      : null,
  )
}

function bestPointFeatureAtPoint(point: MapMouseEvent['point']) {
  return bestPointFeatureFromCandidates(pointFeaturesAtPoint(point) as GeoJsonFeature[])
}

function bestPointFeatureFromCandidates(features: GeoJsonFeature[]) {
  const activeLevel = activeMapLevel.value
  return (
    features.filter(isVisiblePointFeature).sort((a, b) => {
      const aLevel = normalizeMapLevel(a.properties.displayLevel ?? a.properties.level)
      const bLevel = normalizeMapLevel(b.properties.displayLevel ?? b.properties.level)
      return Number(bLevel === activeLevel) - Number(aLevel === activeLevel)
    })[0] ?? null
  )
}

function visiblePointFeatureFromEvent(event: MapLayerMouseEvent) {
  return (
    ((event.features ?? []) as GeoJsonFeature[]).find((feature) =>
      isVisiblePointFeature(feature),
    ) ?? null
  )
}

function isVisiblePointFeature(feature?: GeoJsonFeature | null) {
  if (!feature?.properties) return false
  const level = normalizeMapLevel(feature.properties.displayLevel ?? feature.properties.level)
  if (!level) return false
  return visiblePointLevelsForZoom(map?.getZoom() ?? mapZoomLevel.value).includes(level)
}

function pointFeaturesAtPoint(point: MapMouseEvent['point']) {
  if (!map) return []
  const pointLayers = interactivePointLayerIdsForCurrentZoom()
  return pointLayers.length
    ? map.queryRenderedFeatures(point, { layers: pointLayers as unknown as string[] })
    : []
}

function interactivePointLayerIdsForCurrentZoom() {
  const visibleLevels = new Set(visiblePointLevelsForZoom(map?.getZoom() ?? mapZoomLevel.value))
  return POINT_INTERACTIVE_LAYERS.filter(
    (layerId) => visibleLevels.has(pointLevelFromLayerId(layerId)) && map?.getLayer(layerId),
  )
}

function visiblePointLevelsForZoom(zoom: number): MapDisplayLevel[] {
  return visibleLevelsForZoom(zoom)
}

function pointLevelFromLayerId(layerId: string): MapDisplayLevel {
  if (layerId.includes('-special-admin-')) return 'city'
  if (layerId.includes('-city-')) return 'city'
  if (layerId.includes('-admin1-')) return 'admin1'
  return 'country'
}

function bestRegionFeatureAtPoint(point: MapMouseEvent['point']) {
  if (!map) return null
  const layers = REGION_HOVER_PRIORITY_LAYERS.filter((layerId) => map?.getLayer(layerId))
  if (!layers.length) return null
  return bestRegionFeatureFromCandidates(
    map.queryRenderedFeatures(point, { layers: layers as unknown as string[] }) as GeoJsonFeature[],
  )
}

function bestRegionFeatureFromCandidates(features: GeoJsonFeature[]) {
  const activeRegionIds = pointRegionIdSet()
  for (const layerId of REGION_HOVER_PRIORITY_LAYERS) {
    const candidates = features
      .filter((feature) => renderedFeatureLayerId(feature) === layerId)
      .filter((feature) => feature?.properties)
      .map((feature) => enrichRenderedRegionFeature(feature as GeoJsonFeature))
    const activeFeature = firstActiveRegionCandidate(candidates, activeRegionIds, regionFeatureKey)
    if (activeFeature) return activeFeature
  }
  return null
}

function renderedFeatureLayerId(feature: GeoJsonFeature) {
  return String((feature as GeoJsonFeature & { layer?: { id?: string } }).layer?.id ?? '')
}

function unifiedInteractiveFeaturesAtPoint(point: MapMouseEvent['point']) {
  if (!map) return []
  const layerIds = [
    ...interactivePointLayerIdsForCurrentZoom(),
    ...REGION_HOVER_PRIORITY_LAYERS.filter((layerId) => map?.getLayer(layerId)),
  ]
  const uniqueLayerIds = [...new Set(layerIds)]
  return uniqueLayerIds.length
    ? (map.queryRenderedFeatures(point, {
        layers: uniqueLayerIds as unknown as string[],
      }) as GeoJsonFeature[])
    : []
}

function sampleUnifiedHover(point: MapMouseEvent['point'], lngLat: MapLayerMouseEvent['lngLat']) {
  if (!map || cameraInteractionActive()) return
  const features = unifiedInteractiveFeaturesAtPoint(point)
  const pointLayerIds = new Set<string>(interactivePointLayerIdsForCurrentZoom())
  const pointFeature = bestPointFeatureFromCandidates(
    features.filter((feature) => pointLayerIds.has(renderedFeatureLayerId(feature))),
  )
  if (pointFeature?.properties) {
    if (setHoveredPoint(pointFeature)) hoverMatchingBoundaryForPoint(pointFeature)
    showFeatureTooltip(pointFeature, lngLat)
    return
  }
  clearHoveredPoint()
  const fallbackRegion = bestRegionFeatureFromCandidates(features)
  if (
    fallbackRegion &&
    Boolean((fallbackRegion.properties as Record<string, unknown>).fallbackDisplayOnly)
  ) {
    setHoveredRegion(fallbackRegion)
    showFeatureTooltip(fallbackRegion, lngLat)
  } else {
    setHoveredRegion(null)
    hideTooltip()
  }
}

function enrichRenderedRegionFeature(feature: GeoJsonFeature) {
  const props = feature.properties
  const rawLevel = normalizeMapLevel(props.boundaryLevel ?? props.level ?? props.sourceLevel)
  const rawGeoKey = String(props.geoKey ?? props.geo_key ?? props.sourceGeoKey ?? '')
  const rawRegionId =
    rawLevel && rawGeoKey ? `${rawLevel}|${rawGeoKey}` : regionIdFromProperties(props)
  const stat =
    statFromFeatureProperties(props) ?? (rawRegionId ? dataRegionStatById(rawRegionId) : undefined)
  const level = stat?.level ?? rawLevel
  const geoKey = stat?.geoKey ?? rawGeoKey
  const regionId = stat ? regionIdForStat(stat) : rawRegionId
  const fallbackDisplayName = localizedPropertyName(props, geoKey)
  const displayName = stat
    ? localizedStatDisplayName(stat) || fallbackDisplayName
    : level
      ? localizedBoundaryName(feature, level) || fallbackDisplayName
      : fallbackDisplayName
  return {
    ...feature,
    properties: {
      ...props,
      ...(stat ? statProperties(stat) : {}),
      region_id: regionId || (level && geoKey ? `${level}|${geoKey}` : ''),
      boundaryLevel: rawLevel || level,
      sourceLevel: rawLevel || level,
      sourceGeoKey: rawGeoKey || geoKey,
      boundaryGeoKey: rawGeoKey || geoKey,
      level,
      geoKey,
      geo_key: geoKey,
      displayName,
    },
  }
}

function setHoveredPoint(feature: GeoJsonFeature | null) {
  const nextId = feature ? pointFeatureStateId(feature) : null
  const nextSourceId = feature ? pointFeatureSourceId(feature) : ''
  if (hoveredPointId === nextId && hoveredPointSourceId === nextSourceId) return false
  clearHoveredPoint()
  hoveredPointId = nextId
  hoveredPointSourceId = nextId != null ? nextSourceId : ''
  if (nextId != null && hoveredPointSourceId) {
    map?.setFeatureState({ source: hoveredPointSourceId, id: nextId }, { hover: true })
  }
  return true
}

function clearHoveredPoint() {
  if (hoveredPointId != null && hoveredPointSourceId) {
    map?.setFeatureState({ source: hoveredPointSourceId, id: hoveredPointId }, { hover: false })
  }
  hoveredPointId = null
  hoveredPointSourceId = ''
}

function setSelectedPoint(feature: GeoJsonFeature | null) {
  const nextId = feature ? pointFeatureStateId(feature) : null
  const nextSourceId = feature ? pointFeatureSourceId(feature) : ''
  if (
    selectedPointId != null &&
    selectedPointSourceId &&
    (selectedPointId !== nextId || selectedPointSourceId !== nextSourceId)
  ) {
    map?.setFeatureState(
      { source: selectedPointSourceId, id: selectedPointId },
      { selected: false },
    )
  }
  selectedPointId = nextId
  selectedPointSourceId = nextId != null ? nextSourceId : ''
  selectedPointKey.value = feature ? regionFeatureKey(feature) : ''
  if (nextId != null && selectedPointSourceId) {
    map?.setFeatureState({ source: selectedPointSourceId, id: nextId }, { selected: true })
  }
}

function clearSelectedPoint() {
  setSelectedPoint(null)
}

function clearSelectedPointVisualState() {
  if (selectedPointId != null && selectedPointSourceId) {
    map?.setFeatureState(
      { source: selectedPointSourceId, id: selectedPointId },
      { selected: false },
    )
  }
  selectedPointId = null
  selectedPointSourceId = ''
}

function resetPreviewRegionFeatureStateTracking() {
  previewHoveredRegionId = ''
  previewSelectedRegionId = ''
}

function pointFeatureStateId(feature: GeoJsonFeature) {
  const id = feature.id ?? feature.properties.featureId
  if (typeof id === 'string' || typeof id === 'number') return id
  return null
}

function pointFeatureSourceId(feature: GeoJsonFeature) {
  const sourceId = String(feature.properties.pointSourceId ?? '').trim()
  if (sourceId) return sourceId
  const displayLevel = normalizeMapLevel(feature.properties.displayLevel)
  const featureLevel = normalizeMapLevel(feature.properties.level)
  const level: MapDisplayLevel = displayLevel || featureLevel || activeMapLevel.value
  return pointSourceId(level)
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

function setSelectedRegion(feature: GeoJsonFeature | null, identity?: RegionIdentity | null) {
  const nextIdentity = identity ?? regionIdentityFromFeature(feature)
  const previousIdentity = selectedRegionIdentity.value
  selectedRegionIdentity.value = nextIdentity
  if (regionFeatureKey(selectedRegionFeature.value) === regionFeatureKey(feature)) {
    if (
      previousIdentity?.level !== nextIdentity?.level ||
      previousIdentity?.geoKey !== nextIdentity?.geoKey ||
      previousIdentity?.displayLevel !== nextIdentity?.displayLevel
    ) {
      updateRegionHighlightSources()
    }
    return
  }
  selectedRegionFeature.value = feature
    ? {
        ...cloneHighlightFeature(feature),
        properties: { ...feature.properties, selected: true },
      }
    : null
  if (regionSourceMode === 'geojson') updateRegionDataSource()
  updateRegionHighlightSources()
}

function regionIdentityFromFeature(feature: GeoJsonFeature | null): RegionIdentity | null {
  if (!feature?.properties) return null
  const level = normalizeMapLevel(
    feature.properties.level ?? feature.properties.boundaryLevel ?? feature.properties.sourceLevel,
  )
  const geoKey = String(
    feature.properties.geoKey ??
      feature.properties.geo_key ??
      feature.properties.sourceGeoKey ??
      '',
  )
  const displayLevel = normalizeMapLevel(feature.properties.displayLevel) || level || undefined
  return level && geoKey ? { level, geoKey, displayLevel } : null
}

function refreshSelectedRegionFromIdentity() {
  const identity = selectedRegionIdentity.value
  if (!identity) return
  const feature =
    boundaryFeatureForLevelGeoKey(identity.level, identity.geoKey) ??
    regionReferenceFeatureFromProperties({ level: identity.level, geoKey: identity.geoKey })
  if (!feature) return
  selectedRegionFeature.value = {
    ...cloneHighlightFeature(feature),
    properties: { ...feature.properties, selected: true },
  }
}

function selectMatchingBoundaryForPoint(feature: GeoJsonFeature) {
  const props = feature.properties
  const referenceFeature = regionReferenceFeatureFromProperties(props)
  const identity = regionIdentityFromFeature(referenceFeature)
  if (regionSourceMode === 'vector') {
    setSelectedRegion(referenceFeature, identity)
    return
  }
  const boundaryFeature = boundaryFeatureForProperties(props) ?? referenceFeature
  setSelectedRegion(boundaryFeature, identity)
}

function boundaryFeatureForStat(stat: MapRegionStat) {
  return boundaryFeatureForLevelGeoKey(stat.level, stat.geoKey, stat)
}

function boundaryFeatureForProperties(props: Record<string, unknown>) {
  const stat = statFromFeatureProperties(props)
  const level = String(stat?.level ?? props.level ?? props.sourceLevel ?? '')
  const geoKey = String(stat?.geoKey ?? props.geoKey ?? props.sourceGeoKey ?? '')
  if (!level || !geoKey) return null
  return boundaryFeatureForLevelGeoKey(
    level,
    geoKey,
    stat ?? statLikeFromProperties(props, level, geoKey),
  )
}

function statLikeFromProperties(
  props: Record<string, unknown>,
  level: string,
  geoKey: string,
): MapRegionStat | undefined {
  const stat = findStatByLevelGeoKey(level, geoKey, props)
  if (stat) return stat
  if (level !== 'country' && props.parentGeoKey) {
    return findStatByLevelGeoKey(level, String(props.parentGeoKey), props)
  }
  return undefined
}

function regionReferenceFeatureFromProperties(props: Record<string, unknown>) {
  const rawLevel = normalizeMapLevel(props.boundaryLevel ?? props.level ?? props.sourceLevel)
  const rawGeoKey = String(props.geoKey ?? props.sourceGeoKey ?? props.geo_key ?? '')
  const stat = statFromFeatureProperties(props)
  const level = stat?.level ?? rawLevel
  const geoKey = stat?.geoKey ?? rawGeoKey
  if (!level || !geoKey) return null
  const regionId = `${level}|${geoKey}`
  return {
    type: 'Feature',
    properties: {
      ...(stat ? statProperties(stat) : {}),
      region_id: regionId,
      boundaryLevel: rawLevel || level,
      sourceLevel: rawLevel || level,
      sourceGeoKey: rawGeoKey || geoKey,
      boundaryGeoKey: rawGeoKey || geoKey,
      level,
      geoKey,
      geo_key: geoKey,
      displayLevel:
        normalizeMapLevel(props.displayLevel) || normalizeMapLevel(props.boundaryLevel) || level,
      displayName: stat ? localizedStatDisplayName(stat) : localizedPropertyName(props, geoKey),
      selected: true,
    },
    geometry: null,
  } as GeoJsonFeature
}

function boundaryFeatureForLevelGeoKey(
  level: string,
  geoKey: string,
  stat?: MapRegionStat,
): GeoJsonFeature | null {
  if (!level || !geoKey) return null
  const names =
    level === 'country'
      ? (['countries'] as BoundaryName[])
      : level === 'city'
        ? (['chinaCities'] as BoundaryName[])
        : geoKey.startsWith('china|') || isChinaRegion(stat)
          ? (['chinaProvinces', 'admin1'] as BoundaryName[])
          : (['admin1'] as BoundaryName[])
  for (const name of names) {
    const boundaryLevelValue = boundaryLevel(name)
    const feature = lookupBoundaryFeature(name, boundaryLevelValue, geoKey, stat)
    if (feature) return enrichSingleBoundaryFeature(feature, boundaryLevelValue, stat)
  }
  return null
}

function enrichSingleBoundaryFeature(
  feature: GeoJsonFeature,
  level: MapRegionStat['level'],
  sourceStat?: MapRegionStat,
): GeoJsonFeature {
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
    const locationCount = formatNumber(Number(props.point_count ?? 0))
    const pointTotal = formatNumber(Number(props.clusterPointTotal ?? 0))
    const doiTotal = formatNumber(Number(props.clusterDoiTotal ?? 0))
    return `
      <div class="map-tooltip-card">
        <div class="map-tooltip-title">${escapeHtml(ui.value.clusterTitle)}</div>
        <div class="map-tooltip-sub">${escapeHtml(ui.value.points)} ${pointTotal} · ${escapeHtml(ui.value.clusterCount)} ${locationCount}</div>
        <div class="map-tooltip-grid single">
          <div class="map-tooltip-metric"><span>${escapeHtml(ui.value.literature)}</span><b>${doiTotal}</b></div>
        </div>
        <div class="map-tooltip-hint">${escapeHtml(ui.value.clusterClickHint)}</div>
      </div>
    `
  }
  const title = escapeHtml(
    singleLanguageLabel(String(props.displayName ?? ''), locale.value) ||
      String(props.displayName ?? ui.value.unnamedRegion),
  )
  const precision = escapeHtml(String(props.locationPrecision ?? ui.value.locationPrecision))
  const biomarkerLabel = escapeHtml(
    displayOptionLabel(String(props.biomarkerLabel ?? selectedBiomarkerLabel.value)),
  )
  const biomarkerCount = Number(props.biomarkerCount ?? 0)
  const biomarker =
    biomarkerCount > 0 ? `${biomarkerLabel}（${formatNumber(biomarkerCount)}）` : biomarkerLabel
  const median = formatCompact(Number(props.pndlMedian))
  const doi = formatNumber(Number(props.doiCount ?? 0))
  const records = formatNumber(Number(props.recordCount ?? 0))
  const points = formatNumber(Number(props.pointCount ?? 1))
  const heatLine =
    props.pndlMedian == null
      ? ''
      : `<div class="map-tooltip-heat"><span>${escapeHtml(ui.value.pndlMedian)}</span><b>${median} mg/day/1000 inh</b></div>`
  const spatialNote = props.fallbackDisplayOnly ? ui.value.inheritedBoundaryWarning : ''
  return `
    <div class="map-tooltip-card">
      <div class="map-tooltip-title">${title}</div>
      <div class="map-tooltip-sub">${precision} · ${escapeHtml(displayOptionLabel(String(props.yearLabel ?? selection.year)))}</div>
      <div class="map-tooltip-grid">
        <div class="map-tooltip-metric"><span>${escapeHtml(ui.value.points)}</span><b>${points}</b></div>
        <div class="map-tooltip-metric"><span>${escapeHtml(ui.value.literature)}</span><b>${doi}</b></div>
        <div class="map-tooltip-metric"><span>${escapeHtml(ui.value.records)}</span><b>${records}</b></div>
      </div>
      <div class="map-tooltip-extra">
        <div>${escapeHtml(ui.value.biomarker)}：<b>${biomarker}</b></div>
      </div>
      ${heatLine}
      ${spatialNote ? `<div class="map-tooltip-centroid">${escapeHtml(spatialNote)}</div>` : ''}
      <div class="map-tooltip-hint">${escapeHtml(ui.value.clickExploreHint)}</div>
    </div>
  `
}

function closeDetail(options: { clearSelection?: boolean } = {}) {
  const { clearSelection = true } = options
  if (clickTimer) {
    window.clearTimeout(clickTimer)
    clickTimer = undefined
  }
  detailController?.abort()
  detailRequestId += 1
  detailController = null
  isLoadingDetail.value = false
  selectedDetail.value = null
  detailError.value = ''
  detailMode.value = 'none'
  detailOrigin.value = 'none'
  fullDetailShouldRestoreCompact.value = false
  if (clearSelection) {
    clearSelectedPoint()
    setSelectedRegion(null)
  }
}

function openFullDetail() {
  if (!selectedDetail.value || isLoadingDetail.value) return
  fullDetailShouldRestoreCompact.value = true
  detailMode.value = 'full'
}

function closeFullDetail() {
  if (fullDetailShouldRestoreCompact.value && selectedDetail.value) {
    fullDetailShouldRestoreCompact.value = false
    detailMode.value = 'compact'
    return
  }
  closeDetail()
}

function canApplyDetailBiomarker(item: MapTopBiomarker) {
  return canExploreBiomarker(item)
}

function detailBiomarkerPill(item: MapTopBiomarker) {
  return item.hasPndl ? ui.value.pndlRegionAvailable : ui.value.pndlRegionUnavailable
}

function detailBiomarkerMeta(item: MapTopBiomarker) {
  const path = [
    displayOptionLabel(item.targetClass),
    displayOptionLabel(item.category),
    displayOptionLabel(item.subcategory),
  ]
    .filter(Boolean)
    .join(' / ')
  const metricLabels = {
    records: ui.value.records,
    literature: ui.value.literature,
    points: ui.value.points,
  }
  const metricValues = {
    records: item.recordCount,
    literature: item.doiCount,
    points: item.pointCount,
  }
  const counts = biomarkerExplorerMetricKeys(hasSpecificBiomarker.value)
    .map((metric) => `${metricLabels[metric]} ${formatNumber(metricValues[metric])}`)
    .join(' · ')
  return path ? `${path} · ${counts}` : counts
}

function pndlRankingKey(item: MapPndlRankingItem) {
  return `${item.level}|${item.geoKey}`
}

function filteredPndlComparisonRows(
  comparison: MapPndlComparison | null | undefined,
  rows: MapPndlRankingItem[],
) {
  if (!shouldFilterToDetailAdmin(comparison)) return rows
  void boundaryVersion.value
  const selectedAdminKey = detailAdminComparisonKey()
  if (!selectedAdminKey) return rows
  const filteredRows = rows.filter(
    (item) => item.level === 'city' && adminComparisonKeyForPndlItem(item) === selectedAdminKey,
  )
  return filteredRows.length ? rerankPndlRows(filteredRows) : rows
}

function shouldFilterToDetailAdmin(comparison: MapPndlComparison | null | undefined) {
  if (!comparison || detailRegion.value?.level !== 'city') return false
  const key = String(comparison.key ?? '').toLowerCase()
  const label = `${comparison.label ?? ''} ${comparison.note ?? ''}`.toLowerCase()
  return (
    key === 'parent-city' || (/省|州|province|state|admin/.test(label) && /城市|city/.test(label))
  )
}

function rerankPndlRows(rows: MapPndlRankingItem[]) {
  return rows.map((item, index) => ({ ...item, rank: index + 1 }))
}

function detailAdminComparisonKey() {
  const region = detailRegion.value
  if (!region) return ''
  return (
    adminComparisonKeyForRegion(region) ||
    adminGeoKeyFromCountryProvince(
      region.country || detailSourceCountry(),
      region.province || detailSourceProvince(),
    )
  )
}

function detailSourceCountry() {
  return (
    selectedDetail.value?.sourceRecords?.find((record) => record.country)?.country ||
    selectedDetail.value?.sources?.find((record) => record.country)?.country ||
    ''
  )
}

function detailSourceProvince() {
  return (
    selectedDetail.value?.sourceRecords?.find((record) => record.province)?.province ||
    selectedDetail.value?.sources?.find((record) => record.province)?.province ||
    ''
  )
}

function adminComparisonKeyForPndlItem(item: MapPndlRankingItem) {
  const stat = findStatByLevelGeoKey(item.level, item.geoKey, {
    display_name: item.displayName,
    name: item.displayName,
  })
  return adminComparisonKeyForRegion(stat ?? pndlItemStatLike(item))
}

function pndlItemStatLike(item: MapPndlRankingItem) {
  return {
    level: item.level,
    geoKey: item.geoKey,
    parentGeoKey: null,
    displayName: item.displayName,
    country: item.geoKey.split('|')[0] || null,
    province: null,
    city: item.level === 'city' ? item.displayName : null,
    category: selection.category,
    subcategory: selection.subcategory,
    biomarkerKey: selection.biomarkerKey,
    biomarkerLabel: selectedBiomarkerLabel.value,
    yearLabel: selection.year,
    pndlMedianMgD1000inh: item.pndlMedianMgD1000inh,
    recordCount: item.recordCount,
    doiCount: item.doiCount,
    pointCount: item.pointCount,
    yearCount: item.yearCount,
    pndlSources: item.pndlSources,
  } as MapRegionStat
}

function adminComparisonKeyForRegion(row: MapRegionStat) {
  if (row.level === 'admin1') return row.geoKey
  if (row.level !== 'city') return ''
  if (row.parentGeoKey?.includes('|')) return row.parentGeoKey
  return (
    inferredChinaCityAdminKey(row) ||
    adminGeoKeyFromCountryProvince(row.country || countryGroupKey(row), row.province)
  )
}

function adminGeoKeyFromCountryProvince(
  country: string | null | undefined,
  province: string | null | undefined,
) {
  const countryKey = normalizeCountryComparisonKey(country)
  const provinceAlias = normalizeGeoAlias(String(province ?? ''))
  if (!countryKey || !provinceAlias) return ''
  const collections = [
    getCleanBoundaryCollection('chinaProvinces'),
    getCleanBoundaryCollection('admin1'),
  ]
  for (const collection of collections) {
    const match = collection?.features.find((feature) => {
      const props = feature.properties
      const featureCountry = normalizeCountryComparisonKey(
        String(props.country_key ?? props.country_display ?? ''),
      )
      if (featureCountry && featureCountry !== countryKey) return false
      return [featureGeoKey(feature, 'admin1'), props.region_key, props.display_name, props.name]
        .filter(Boolean)
        .map((value) => normalizeGeoAlias(String(value)))
        .some((alias) => alias === provinceAlias)
    })
    if (match) return featureGeoKey(match, 'admin1')
  }
  return countryKey === 'china' ? `china|${provinceAlias}` : ''
}

function normalizeCountryComparisonKey(value: string | null | undefined) {
  const alias = normalizeGeoAlias(String(value ?? ''))
  if (!alias) return ''
  if (alias === 'china' || alias === '中国') return 'china'
  return alias
}

function inferredChinaCityAdminKey(row: MapRegionStat) {
  if (row.level !== 'city' || countryGroupKey(row) !== 'china') return ''
  if (cityAdminKeyCacheVersion !== boundaryVersion.value) {
    cityAdminKeyCache.clear()
    cityAdminKeyCacheVersion = boundaryVersion.value
  }
  const cacheKey = `${row.geoKey}|${normalizeGeoAlias(row.displayName)}|${normalizeGeoAlias(row.city ?? '')}`
  if (cityAdminKeyCache.has(cacheKey)) return cityAdminKeyCache.get(cacheKey) ?? ''
  const cityFeature = boundaryFeatureForLevelGeoKey(row.level, row.geoKey, row)
  const candidatePoints = uniqueCoordinateCandidates([
    row.longitude != null && row.latitude != null
      ? ([Number(row.longitude), Number(row.latitude)] as [number, number])
      : null,
    cityFeature ? labelPointForGeometry(cityFeature.geometry) : null,
    cityFeature ? bboxCenter(featureBbox(cityFeature.geometry)) : null,
  ])
  const provinces = getCleanBoundaryCollection('chinaProvinces')
  const provinceFeature = provinces
    ? candidatePoints
        .map((point) =>
          provinces.features.find((feature) => {
            const bbox = geometryBbox(feature.geometry)
            return bbox && pointWithinBbox(point, bbox) && pointInGeometry(point, feature.geometry)
          }),
        )
        .find(Boolean)
    : null
  const adminKey = provinceFeature ? featureGeoKey(provinceFeature, 'admin1') : ''
  cityAdminKeyCache.set(cacheKey, adminKey)
  return adminKey
}

function uniqueCoordinateCandidates(points: Array<[number, number] | null>) {
  const seen = new Set<string>()
  return points.filter((point): point is [number, number] => {
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return false
    const key = `${point[0].toFixed(5)}|${point[1].toFixed(5)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function ensureSelectedPndlChartRow(rows: MapPndlRankingItem[]) {
  if (!hasSpecificBiomarker.value || activePndlComparison.value?.highlightSelected === false) {
    return rows
  }
  const comparisonSelectedId = activePndlComparison.value?.selectedRegionId ?? ''
  const region = detailRegion.value
  const regionId = region ? `${region.level}|${region.geoKey}` : ''
  const selectedId =
    comparisonSelectedId || regionId || selectedRegionId() || selectedPointKey.value
  if (!selectedId || rows.some((item) => pndlRankingKey(item) === selectedId || item.selected)) {
    return rows
  }
  if (!region || selectedId !== regionId) return rows
  const value = Number(region.pndlMedianMgD1000inh ?? 0)
  return [
    ...rows,
    {
      rank: rows.length + 1,
      level: region.level,
      geoKey: region.geoKey,
      displayName: localizedStatDisplayName(region),
      pndlMedianMgD1000inh: Number.isFinite(value) && value > 0 ? value : null,
      recordCount: region.recordCount,
      doiCount: region.doiCount,
      pointCount: region.pointCount,
      yearCount: region.yearCount,
      pndlRecordCount: region.pndlRecordCount,
      pndlDoiCount: region.pndlDoiCount,
      pndlPointCount: region.pndlPointCount,
      pndlYearCount: region.pndlYearCount,
      selected: true,
    },
  ]
}

function selectPndlChartDisplayRows(rows: MapPndlRankingItem[]) {
  if (rows.length <= 15) return rows
  if (activePndlComparison.value?.highlightSelected === false) return rows.slice(0, 15)
  const selectedIndex = rows.findIndex((item) => isPndlChartItemSelected(item))
  const selectedWindow =
    selectedIndex >= 0
      ? rows.slice(Math.max(0, selectedIndex - 3), Math.min(rows.length, selectedIndex + 4))
      : []
  const byKey = new Map<string, MapPndlRankingItem>()
  ;[...rows.slice(0, selectedIndex >= 15 ? 9 : 15), ...selectedWindow].forEach((item) => {
    byKey.set(pndlRankingKey(item), item)
  })
  return Array.from(byKey.values()).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
}

function isPndlChartItemSelected(item: MapPndlRankingItem) {
  if (activePndlComparison.value?.highlightSelected === false) return false
  if (item.selected) return true
  const region = detailRegion.value
  if (region && item.level === region.level && item.geoKey === region.geoKey) return true
  const selectedKey = selectedRegionId() || selectedPointKey.value
  return selectedKey === pndlRankingKey(item)
}

function pndlColumnTooltip(item: MapPndlRankingItem) {
  const hasPndl = hasPositivePndlValue(item.pndlMedianMgD1000inh)
  return {
    title: localizedPndlItemDisplayName(item),
    label: ui.value.pndlMedian,
    value: hasPndl
      ? `${formatCompact(item.pndlMedianMgD1000inh)} mg/day/1000 inh`
      : ui.value.pndlRegionUnavailable,
    metrics: [
      {
        label: ui.value.records,
        value: formatNumber(
          hasPndl ? (item.pndlRecordCount ?? item.recordCount ?? 0) : (item.recordCount ?? 0),
        ),
      },
      {
        label: ui.value.literature,
        value: formatNumber(
          hasPndl ? (item.pndlDoiCount ?? item.doiCount ?? 0) : (item.doiCount ?? 0),
        ),
      },
      {
        label: ui.value.points,
        value: formatNumber(
          hasPndl ? (item.pndlPointCount ?? item.pointCount ?? 0) : (item.pointCount ?? 0),
        ),
      },
      {
        label: ui.value.year,
        value: formatNumber(
          hasPndl ? (item.pndlYearCount ?? item.yearCount ?? 0) : (item.yearCount ?? 0),
        ),
      },
    ],
  }
}

function hasPositivePndlValue(value?: number | null) {
  const numericValue = Number(value ?? 0)
  return Number.isFinite(numericValue) && numericValue > 0
}

function pndlChartValueLabel(value?: number | null) {
  return hasPositivePndlValue(value) ? formatCompact(value) : ui.value.pndlRegionUnavailable
}

function sourceRecordLocation(record: MapSourceRecord) {
  return (
    [record.country, record.province, record.city].filter(Boolean).join(' / ') || ui.value.noData
  )
}

function sourceRecordSample(record: MapSourceRecord) {
  return [record.samplePeriod, record.plantName].filter(Boolean).join(' · ') || ui.value.noData
}

function sourceRecordMetric(record: MapSourceRecord) {
  if (hasPositivePndlValue(record.pndlMgD1000inh)) {
    return `PNDL ${formatCompact(record.pndlMgD1000inh)} mg/day/1000 inh`
  }
  const concentration = Number(record.concentrationValue ?? 0)
  if (Number.isFinite(concentration) && concentration > 0) {
    return `${formatCompact(concentration)} ${record.concentrationUnit || ''}`.trim()
  }
  const dailyLoad = Number(record.dailyLoadValue ?? 0)
  if (Number.isFinite(dailyLoad) && dailyLoad > 0) {
    return `${formatCompact(dailyLoad)} ${record.dailyLoadUnit || ''}`.trim()
  }
  return ui.value.sourcePending
}

function sourceRecordReference(record: MapSourceRecord) {
  if (record.doi) return record.doi
  const workbook = record.sourceWorkbook || ''
  const row = record.originalRowNumber ? `#${record.originalRowNumber}` : ''
  return [workbook, row].filter(Boolean).join(' ') || ui.value.sourcePending
}

function reportedSiteName(site: MapReportedSite) {
  return site.canonicalPlantName || site.rawPlantName || ui.value.noData
}

function reportedSiteIdentity(site: MapReportedSite) {
  return [site.literatureCode, site.reportedSiteKey].filter(Boolean).join(' · ')
}

function reportedSiteLocation(site: MapReportedSite) {
  return [site.country, site.province, site.city].filter(Boolean).join(' / ') || ui.value.noData
}

function showPndlColumnTooltip(item: MapPndlRankingItem, event: MouseEvent) {
  const container = pndlChartScrollRef.value
  const content = pndlColumnTooltip(item)
  pndlColumnTooltipState.value = {
    visible: true,
    key: pndlRankingKey(item),
    ...content,
    ...chartTooltipPosition(event, container, 270, 148),
  }
}

function chartTooltipPosition(
  event: MouseEvent,
  container: HTMLElement | null | undefined,
  tooltipWidth: number,
  tooltipHeight: number,
) {
  const containerRect = container?.getBoundingClientRect()
  const scrollLeft = container?.scrollLeft ?? 0
  const rawX = containerRect ? event.clientX - containerRect.left + scrollLeft : event.offsetX
  const rawY = containerRect ? event.clientY - containerRect.top : event.offsetY
  const width = containerRect?.width ?? 320
  const height = containerRect?.height ?? 300
  const minX = scrollLeft + tooltipWidth / 2 + 8
  const maxX = Math.max(minX, scrollLeft + width - tooltipWidth / 2 - 8)
  const maxY = Math.max(tooltipHeight + 12, height - 10)
  return {
    x: Math.min(Math.max(rawX, minX), maxX),
    y: Math.min(Math.max(rawY - 16, tooltipHeight + 12), maxY),
  }
}

function hidePndlColumnTooltip() {
  if (!pndlColumnTooltipState.value.visible) return
  pndlColumnTooltipState.value = {
    ...pndlColumnTooltipState.value,
    visible: false,
  }
}

function scrollSelectedPndlColumnIntoView() {
  if (!isFullDetailOpen.value || activePndlComparison.value?.highlightSelected === false) return
  const container = pndlChartScrollRef.value
  if (!container) return
  const selectedColumn = container.querySelector<HTMLElement>('.pndl-column-item.selected')
  if (!selectedColumn) return
  const containerRect = container.getBoundingClientRect()
  const selectedRect = selectedColumn.getBoundingClientRect()
  const edgePadding = 8
  const leftOverflow = selectedRect.left - containerRect.left - edgePadding
  const rightOverflow = selectedRect.right - containerRect.right + edgePadding
  if (leftOverflow >= 0 && rightOverflow <= 0) return
  const delta = leftOverflow < 0 ? leftOverflow : rightOverflow
  container.scrollTo({
    left: Math.max(0, container.scrollLeft + delta),
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  })
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function pndlChartPercent(value?: number | null) {
  return pndlChartScalePercent(
    value,
    pndlChartMax.value,
    pndlChartMin.value,
    pndlChartUsesLogScale.value,
  )
}

async function applyDetailBiomarker(item: MapTopBiomarker) {
  if (!canApplyDetailBiomarker(item)) return
  const nextTargetClass = item.targetClass || selection.targetClass || DEFAULT_SELECTION.targetClass
  const nextCategory = item.category || selection.category || ALL_CATEGORY_LABEL
  const nextSubcategory = item.subcategory || ALL_SUBCATEGORY_LABEL
  pinnedBiomarkerOption.value = {
    key: item.biomarkerKey,
    label: item.biomarkerLabel || item.biomarkerKey,
    cas: item.biomarkerCas,
  }
  programmaticSelectionUpdateInProgress = true
  preserveSelectionOnNextSelectionChange = true
  closeDetail({ clearSelection: false })
  Object.assign(selection, {
    targetClass: nextTargetClass,
    category: nextCategory,
    subcategory: nextSubcategory,
    biomarkerKey: item.biomarkerKey,
    year: ALL_YEAR_LABEL,
  })
  await nextTick()
  programmaticSelectionUpdateInProgress = false
  preserveSelectionOnNextSelectionChange = false
  scheduleStatsFetch(0)
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
  const targetZoom =
    mapMode.value === 'globe'
      ? Math.max(GLOBE_INITIAL_ZOOM, getGlobeSafeZoom())
      : Math.max(FLAT_INITIAL_ZOOM, FLAT_MIN_ZOOM + 0.2)
  map.easeTo({
    center: FLAT_CENTER,
    zoom: clampZoom(targetZoom),
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

function scheduleUnifiedHoverAtCursor() {
  if (!map || !pendingCursorPixel || cameraInteractionActive() || unifiedHoverFrame != null) return
  unifiedHoverFrame = window.requestAnimationFrame(() => {
    unifiedHoverFrame = undefined
    if (!map || !pendingCursorPixel || cameraInteractionActive()) return
    // queryRenderedFeatures requires MapLibre's Point instance (or an array).
    // Recreating it as a plain {x, y} object makes the API interpret the value
    // as a malformed query box and can hit a feature thousands of kilometres away.
    const point = map.project(map.unproject(pendingCursorPixel)) as MapMouseEvent['point']
    sampleUnifiedHover(point, map.unproject(pendingCursorPixel))
  })
}

function handleMapMouseMove(event: MapMouseEvent) {
  pendingCursorPoint = [event.lngLat.lng, event.lngLat.lat]
  pendingCursorPixel = [event.point.x, event.point.y]
  scheduleLiveMapStatusUpdate()
  scheduleUnifiedHoverAtCursor()
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
  scheduleUnifiedHoverAtCursor()
}

function handleMapMouseLeave() {
  if (unifiedHoverFrame != null) {
    window.cancelAnimationFrame(unifiedHoverFrame)
    unifiedHoverFrame = undefined
  }
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
  const feature = getBoundaryHitIndex('countries').find(
    (item) => pointWithinBbox(point, item.bbox) && pointInGeometry(point, item.feature.geometry),
  )?.feature
  if (!feature) return null
  const name = localizedBoundaryName(feature, 'country').trim()
  return name || null
}

function getBoundaryHitIndex(name: BoundaryName) {
  const cached = boundaryHitIndexCache.get(name)
  if (cached?.boundaryVersion === boundaryVersion.value) return cached.items
  const collection = getCleanBoundaryCollection(name)
  const items =
    collection?.features.flatMap((feature) => {
      const bbox = geometryBbox(feature.geometry)
      return bbox ? [{ feature, bbox }] : []
    }) ?? []
  boundaryHitIndexCache.set(name, { boundaryVersion: boundaryVersion.value, items })
  return items
}

function pointWithinBbox(
  [lng, lat]: [number, number],
  [minLng, minLat, maxLng, maxLat]: [number, number, number, number],
) {
  return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat
}

function pointInGeometry(point: [number, number], geometry: unknown) {
  if (!geometry || typeof geometry !== 'object') return false
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
  const safeMinZoom = mode === 'globe' ? getGlobeSafeZoom() : currentMapMinZoom()
  map.setMinZoom(safeMinZoom)
  const currentCenter = map.getCenter()
  const currentZoom = map.getZoom()
  resetPreviewRegionFeatureStateTracking()
  map.setStyle(buildMapStyle(mode, activeBasemapConfig) as never)
  const nextZoom = clampZoom(
    mode === 'globe'
      ? Math.max(currentZoom, safeMinZoom, GLOBE_INITIAL_ZOOM)
      : Math.max(currentZoom, safeMinZoom),
  )
  const restore = () => {
    if (!projectionSwitchInProgress || !map) return
    if (!map.isStyleLoaded()) {
      map.once('idle', restore)
      return
    }
    mapReady.value = true
    addMapSourcesAndLayers()
    bindLayerEvents()
    applyFlatWorldWrapConstraints()
    syncActiveMapLevel(nextZoom)
    void ensureBoundary('countries', true)
    ensureFallbackBoundaries(true)
    updateMapData()
    syncAtmosphereStyle()
    map.setMaxZoom(currentMapMaxZoom())
    map.setMinZoom(mode === 'globe' ? safeMinZoom : currentMapMinZoom())
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
    applyFlatWorldWrapConstraints()
    pointCollectionCache.clear()
    schedulePointSourceRefresh(0)
    enforceGlobeSafeZoom()
  }, 120)
}

function applyViewLayerVisibility() {
  if (!map) return
  const hierarchyReady = activeHierarchyBoundariesReady()
  // Point coordinates are available independently of the staged boundary files.
  // Keeping these layers visible avoids a blank marker interval while a newly
  // entered hierarchy level is still loading its outlines.
  const pndlVisible = viewLayers.pndl
  setLayerVisibility([...PNDL_LAYER_IDS], false)
  if (pndlVisible) {
    setLayerVisibility(pndlLayerIdsForLevel(activeMapLevel.value), true)
  }
  setLayerVisibility(layerIdsForViewGroup('labels'), viewLayers.labels)
  setLayerVisibility([...PREVIEW_LABEL_LAYER_IDS], basemapMode === 'vector' && viewLayers.labels)
  // A business name and its bubble are one visual unit. Keep the rest of the
  // static administrative names visible and exclude only exact geo_key matches.
  applyPreviewBusinessLabelExclusions(pndlVisible)
  setLayerVisibility([...REGION_FILL_LAYER_IDS], hierarchyReady)
  if (basemapMode === 'vector') {
    setLayerVisibility([...PREVIEW_BOUNDARY_LAYER_IDS], viewLayers.boundaries)
    setLayerVisibility([...BOUNDARY_LAYER_IDS], false)
    setLayerVisibility(['boundaries_country', 'boundaries'], false)
    setLayerVisibility(
      ['wbe-country-boundary-hit', 'wbe-admin1-boundary-hit', 'wbe-city-boundary-hit'],
      true,
    )
  } else if (regionSourceMode === 'vector') {
    setLayerVisibility(
      ['wbe-country-boundary', 'wbe-admin1-boundary', 'wbe-city-boundary'],
      viewLayers.boundaries,
    )
    setLayerVisibility(
      ['wbe-country-boundary-hit', 'wbe-admin1-boundary-hit', 'wbe-city-boundary-hit'],
      true,
    )
    setLayerVisibility(
      BOUNDARY_LAYER_IDS.filter((id) => !id.startsWith('wbe-')),
      false,
    )
  } else {
    setLayerVisibility(['country-line'], viewLayers.boundaries)
    setLayerVisibility(
      ['admin1-line', 'china-province-line'],
      viewLayers.boundaries && activeMapLevel.value !== 'country',
    )
    setLayerVisibility(
      ['china-active-province-line', 'china-city-line'],
      viewLayers.boundaries && activeMapLevel.value === 'city',
    )
    setLayerVisibility(
      ['china-special-admin-line'],
      viewLayers.boundaries && activeMapLevel.value !== 'country',
    )
  }
  setLayerVisibility([...REGION_LINE_LAYER_IDS], basemapMode === 'geojson' && viewLayers.boundaries)
  setLayerVisibility(
    [...PREVIEW_REGION_OUTLINE_LAYER_IDS],
    basemapMode === 'vector' && viewLayers.boundaries,
  )
  setLayerVisibility(['region-data-line', 'region-city-data-line'], false)
  applyHierarchyBoundaryWidths()
  syncAtmosphereStyle()
}

function pndlLayerIdsForLevel(level: MapDisplayLevel) {
  const ids = [
    `pndl-${level}-heat-footprint`,
    `pndl-${level}-bubble-icons`,
    `pndl-${level}-selected-ring`,
    `pndl-${level}-bubble-count`,
    `pndl-${level}-point-labels`,
  ]
  if (level === 'city') {
    ids.push(
      'pndl-special-admin-bubble-icons',
      'pndl-special-admin-selected-ring',
      'pndl-special-admin-bubble-count',
      'pndl-special-admin-point-labels',
    )
  }
  return ids
}

function applyPreviewBusinessLabelExclusions(pndlVisible: boolean) {
  const vectorConfig = activeBasemapConfig
  if (!map || basemapMode !== 'vector' || vectorConfig.mode !== 'vector') return
  const range = pndlLayerZoomRange(activeMapLevel.value)
  const zoom = map.getZoom()
  const pointLayerVisibleAtZoom =
    (range.minzoom == null || zoom >= range.minzoom) &&
    (range.maxzoom == null || zoom < range.maxzoom)
  const bubbleLayerId = pndlLayerId(activeMapLevel.value, 'bubble-icons')
  const pointLayerEnabled =
    pndlVisible &&
    pointLayerVisibleAtZoom &&
    Boolean(map.getLayer(bubbleLayerId)) &&
    map.getLayoutProperty(bubbleLayerId, 'visibility') !== 'none'
  const excludedGeoKeys = pointLayerEnabled
    ? buildPointCollection(activeMapLevel.value).features
        .map((feature) => String(feature.properties?.geoKey ?? ''))
        .filter(
          (geoKey) => geoKey && !isUnassignedGeoKey(activeMapLevel.value, geoKey),
        )
    : []
  const excluded = [...new Set(excludedGeoKeys)]
  ;(
    Object.entries(PREVIEW_LABEL_LAYER_IDS_BY_LEVEL) as Array<[MapDisplayLevel, readonly string[]]>
  ).forEach(([level, layerIds]) => {
    layerIds.forEach((layerId) => {
      if (!map?.getLayer(layerId)) return
      const configuredLayer = vectorConfig.layers.find(
        (layer) => isStyleLayer(layer) && layer.id === layerId,
      )
      const baseFilter = isStyleLayer(configuredLayer) ? configuredLayer.filter : undefined
      const shouldExclude = level === activeMapLevel.value && excluded.length > 0
      const filter = shouldExclude
        ? [
            'all',
            ...(baseFilter ? [baseFilter] : []),
            ['!', ['in', ['get', 'geo_key'], ['literal', excluded]]],
          ]
        : (baseFilter ?? null)
      map.setFilter(layerId, filter as never)
    })
  })
}

function activeHierarchyBoundariesReady() {
  void boundaryVersion.value
  if (regionSourceMode === 'vector') return true
  if (!boundaryCache.has('countries')) return false
  if (activeMapLevel.value === 'country') return true
  if (!boundaryCache.has('admin1') || !boundaryCache.has('chinaProvinces')) return false
  return activeMapLevel.value !== 'city' || boundaryCache.has('chinaCities')
}

function applyHierarchyBoundaryWidths() {
  if (!map) return
  const level = activeMapLevel.value
  if (regionSourceMode === 'vector') {
    if (map.getLayer('wbe-country-boundary')) {
      map.setPaintProperty(
        'wbe-country-boundary',
        'line-opacity',
        level === 'country' ? 0.78 : level === 'admin1' ? 0.7 : 0.62,
      )
    }
    return
  }
  setBoundaryLineWidth('country-line', level === 'country' ? 0.76 : level === 'admin1' ? 0.7 : 0.64)
  const adminWidth = level === 'city' ? 0.66 : 0.7
  setBoundaryLineWidth('admin1-line', adminWidth)
  setBoundaryLineWidth('china-province-line', adminWidth)
  setBoundaryLineWidth('china-active-province-line', 0.82)
  setBoundaryLineWidth('china-city-line', 0.46)
  setBoundaryLineWidth('china-special-admin-line', level === 'city' ? 1.18 : 1.05)
  if (map.getLayer('country-line')) {
    map.setPaintProperty(
      'country-line',
      'line-opacity',
      level === 'country' ? 0.78 : level === 'admin1' ? 0.7 : 0.62,
    )
  }
  if (map.getLayer('admin1-line')) {
    map.setPaintProperty('admin1-line', 'line-opacity', level === 'city' ? 0.54 : 0.64)
  }
  if (map.getLayer('china-province-line')) {
    map.setPaintProperty('china-province-line', 'line-opacity', level === 'city' ? 0.58 : 0.68)
  }
}

function setBoundaryLineWidth(layerId: string, width: number) {
  if (!map?.getLayer(layerId)) return
  map.setPaintProperty(layerId, 'line-width', width)
}

function layerIdsForViewGroup(group: 'labels' | 'boundaries') {
  const fallbackIds = group === 'labels' ? [...LABEL_LAYER_IDS] : [...BOUNDARY_LAYER_IDS]
  if (basemapMode === 'geojson') return fallbackIds
  const layers = map?.getStyle().layers ?? []
  const vectorIds = layers.flatMap((layer) => {
    if (!isStyleLayer(layer)) return []
    const id = String(layer.id)
    if (PNDL_LAYER_IDS.includes(id)) return []
    const type = String((layer as { type?: string }).type ?? '')
    if (group === 'labels') return type === 'symbol' ? [id] : []
    return type === 'line' && /admin|boundar|border|country|province|state/i.test(id) ? [id] : []
  })
  return group === 'labels'
    ? [...new Set([...fallbackIds, ...vectorIds])]
    : [...new Set([...fallbackIds, ...vectorIds])]
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

function resetFilters() {
  closeSearch()
  isLayerPanelOpen.value = false
  pinnedBiomarkerOption.value = null
  closeDetail()
  Object.assign(selection, { ...DEFAULT_SELECTION })
  scheduleStatsFetch(0)
}

function updateFilterSelection(key: keyof MapFilterSelection, value: string) {
  selection[key] = value
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
  if (normalized === '全部小类') return ui.value.allSubcategories
  if (normalized === '全部年份') return ui.value.allYears
  if (normalized === 'ALL') return ui.value.allTargetClasses
  return normalized
}

function localizedBackendLabel(value?: string | null) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return ''
  const compact = normalized.replace(/\s+/g, '')
  return (
    BACKEND_LABEL_TRANSLATIONS[locale.value][normalized] ||
    BACKEND_LABEL_TRANSLATIONS[locale.value][compact] ||
    displayOptionLabel(normalized)
  )
}

function localizedPndlComparisonLabel(comparison: MapPndlComparison) {
  return (
    PNDL_COMPARISON_LABELS[locale.value][comparison.key] ||
    localizedBackendLabel(comparison.label) ||
    comparison.key
  )
}

function localizedSummaryCardLabel(card: MapSummaryCard) {
  return localizedBackendLabel(card.label)
}

function compactSummaryCardLabel(card: MapSummaryCard) {
  const label = String(card.label ?? '')
    .replace(/\s+/g, '')
    .toLowerCase()
  if (label.includes('点位')) return locale.value === 'zh' ? '点位' : 'Sites'
  if (label.includes('文献')) return locale.value === 'zh' ? '文献' : 'Literature'
  if (label.includes('biomarker') || label.includes('生物标记物')) return ui.value.biomarker
  return localizedSummaryCardLabel(card)
}

function localizedSummaryCardNote(card: MapSummaryCard) {
  return localizedBackendLabel(card.note)
}

function overviewSummaryCardClass(card: MapSummaryCard) {
  const label = String(card.label ?? '')
    .replace(/\s+/g, '')
    .toLowerCase()
  if (label.includes('点位') || label.includes('位置')) return 'metric-sites'
  if (label.includes('文献')) return 'metric-literature'
  if (label.includes('记录')) return 'metric-records'
  if (label.includes('biomarker') || label.includes('生物标记物')) return 'metric-biomarkers'
  if (label.includes('pndl') || label.includes('年份')) return 'metric-years'
  if (label.includes('城市')) return 'metric-cities'
  return 'metric-default'
}

function localizedPndlItemDisplayName(item: MapPndlRankingItem) {
  const stat = findStatByLevelGeoKey(item.level, item.geoKey, {
    display_name: item.displayName,
    name: item.displayName,
  })
  if (stat) return localizedStatDisplayName(stat) || item.displayName
  const feature = boundaryFeatureForLevelGeoKey(item.level, item.geoKey, pndlItemStatLike(item))
  if (feature) return localizedBoundaryName(feature, item.level) || item.displayName
  return singleLanguageLabel(item.displayName, locale.value) || item.displayName
}

function isClusterFeature(props: Record<string, unknown>) {
  return Boolean(props.cluster || props.point_count)
}

function detailTargetFromFeature(feature: GeoJsonFeature) {
  return canonicalDetailTargetFromFeature(feature)
}

function canonicalDetailTargetFromFeature(feature: GeoJsonFeature) {
  const props = feature.properties ?? {}
  const featureStat = findStatByFeatureId(String(props.featureId ?? ''))
  if (featureStat) {
    return { level: featureStat.level, geoKey: featureStat.geoKey, stat: featureStat }
  }
  const explicitRegionId = String(props.region_id ?? '')
  if (explicitRegionId) {
    const [levelValue, ...geoKeyParts] = explicitRegionId.split('|')
    const level = normalizeMapLevel(levelValue)
    const geoKey = geoKeyParts.join('|')
    const stat = level && geoKey ? buildStatIndex().get(`${level}|${geoKey}`) : undefined
    if (level && geoKey) return { level, geoKey, stat }
  }

  const candidates: Array<[unknown, unknown]> = [
    [props.level, props.geoKey],
    [props.level, props.geo_key],
    [props.sourceLevel, props.sourceGeoKey],
    [props.boundaryLevel, props.geoKey],
    [props.boundaryLevel, props.geo_key],
  ]
  for (const [levelValue, geoKeyValue] of candidates) {
    const level = normalizeMapLevel(levelValue)
    const geoKey = String(geoKeyValue ?? '')
    if (!level || !geoKey) continue
    return { level, geoKey, stat: buildStatIndex().get(`${level}|${geoKey}`) }
  }
  return null
}

function statHasBackendData(stat: MapRegionStat) {
  return (
    Number(stat.recordCount ?? 0) > 0 ||
    Number(stat.pointCount ?? 0) > 0 ||
    Number(stat.doiCount ?? 0) > 0 ||
    Number(stat.pndlMedianMgD1000inh ?? 0) > 0
  )
}

function detailHasBackendData(detail: MapDetailResponse | null) {
  if (!detail) return false
  if (detail.cluster && (detail.locations?.length ?? 0) > 0) return true
  if (detail.topBiomarkers?.length) return true
  const region = detail.region
  if (!region) return false
  return statHasBackendData(region)
}

function normalizeMapLevel(value: unknown): MapRegionStat['level'] | '' {
  if (value === 'country' || value === 'admin1' || value === 'city') return value
  return ''
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

function bboxCenter(bbox: [number, number, number, number] | null): [number, number] | null {
  return bbox ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] : null
}

function geometryBbox(geometry: unknown): [number, number, number, number] | null {
  const points: [number, number][] = []
  const typedGeometry = geometry as { coordinates?: unknown }
  collectCoordinates(typedGeometry?.coordinates, points)
  if (!points.length) return null
  return bboxFromPoints(points)
}

function labelPointForGeometry(
  geometry: unknown,
  preferMaximumClearance = false,
): [number, number] | null {
  const rings = primaryPolygonRings(geometry)
  if (!rings) {
    const bbox = featureBbox(geometry)
    return bbox ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] : null
  }
  const exterior = coordinateRing(rings[0])
  if (exterior.length < 3) return null
  const bbox = bboxFromPoints(exterior)
  const candidates = [
    preferMaximumClearance ? bestInteriorClearancePoint(rings, bbox) : null,
    polygonCentroid(exterior),
    [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] as [number, number],
    bestInteriorGridPoint(rings, bbox),
  ].filter(Boolean) as [number, number][]
  return candidates.find((point) => pointInPolygon(point, rings)) ?? candidates[0] ?? null
}

function primaryPolygonArea(geometry: unknown) {
  const rings = primaryPolygonRings(geometry)
  return rings ? polygonArea(rings) / 2 : 0
}

function bestInteriorClearancePoint(rings: unknown[], bbox: [number, number, number, number]) {
  const exterior = coordinateRing(rings[0])
  const candidates: [number, number][] = []
  const centroidPoint = polygonCentroid(exterior)
  if (centroidPoint) candidates.push(centroidPoint)
  candidates.push([(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2])
  const steps = 10
  for (let x = 1; x < steps; x += 1) {
    for (let y = 1; y < steps; y += 1) {
      candidates.push([
        bbox[0] + ((bbox[2] - bbox[0]) * x) / steps,
        bbox[1] + ((bbox[3] - bbox[1]) * y) / steps,
      ])
    }
  }
  let bestPoint: [number, number] | null = null
  let bestClearance = -1
  for (const point of candidates) {
    if (!pointInPolygon(point, rings)) continue
    const clearance = Math.min(...rings.map((ring) => distanceToRing(point, coordinateRing(ring))))
    if (clearance > bestClearance) {
      bestClearance = clearance
      bestPoint = point
    }
  }
  return bestPoint
}

function distanceToRing(point: [number, number], ring: [number, number][]) {
  let distance = Infinity
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index]
    const end = ring[(index + 1) % ring.length]
    if (!start || !end) continue
    distance = Math.min(distance, distanceToSegment(point, start, end))
  }
  return distance
}

function distanceToSegment(
  point: [number, number],
  start: [number, number],
  end: [number, number],
) {
  const deltaX = end[0] - start[0]
  const deltaY = end[1] - start[1]
  if (deltaX === 0 && deltaY === 0) return Math.hypot(point[0] - start[0], point[1] - start[1])
  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) /
        (deltaX * deltaX + deltaY * deltaY),
    ),
  )
  return Math.hypot(
    point[0] - (start[0] + projection * deltaX),
    point[1] - (start[1] + projection * deltaY),
  )
}

function primaryPolygonRings(geometry: unknown): unknown[] | null {
  if (!geometry || typeof geometry !== 'object') return null
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
  if (!geometry || typeof geometry !== 'object') return []
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
  const direction = axis === 'latitude' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W'
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
    <MapPageHeader
      :ui="ui"
      :search-query="searchQuery"
      :search-focused="isSearchFocused"
      :search-results="searchResults"
      :locale="locale"
      :language-menu-open="isLanguageMenuOpen"
      @update:search-query="searchQuery = $event"
      @update:language-menu-open="isLanguageMenuOpen = $event"
      @open-search="openSearch"
      @close-search-soon="closeSearchSoon"
      @apply-first-result="applyFirstSearchResult"
      @clear-search="clearSearch"
      @select-result="focusSearchResult"
      @set-locale="setLocale"
    />

    <section
      class="map-stage"
      :class="{
        'compact-detail-open': isCompactDetailOpen,
        'full-detail-open': isFullDetailOpen,
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
        </button>

        <button
          class="map-tool-button"
          type="button"
          :disabled="!globeAvailable"
          :aria-label="mapMode === 'globe' ? ui.switchToFlat : ui.switchToGlobe"
          :title="mapMode === 'globe' ? ui.switchToFlat : ui.switchToGlobe"
          @click="setMapMode(mapMode === 'globe' ? 'flat' : 'globe')"
        >
          <svg v-if="mapMode === 'globe'" class="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="5" width="16" height="14" rx="3"></rect>
            <path d="M8 5v14M16 5v14M4 10h16M4 15h16"></path>
          </svg>
          <svg v-else class="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="8"></circle>
            <path d="M4 12h16M12 4a12 12 0 0 1 0 16M12 4a12 12 0 0 0 0 16"></path>
          </svg>
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
          </button>

          <div v-if="isLayerPanelOpen" class="layer-panel" @click.stop>
            <strong>{{ ui.layerPanelTitle }}</strong>
            <label>
              <input v-model="viewLayers.boundaries" type="checkbox" />
              <span>{{ ui.boundariesLayer }}</span>
            </label>
            <label>
              <input v-model="viewLayers.pndl" type="checkbox" />
              <span>{{ ui.pndlLayer }}</span>
            </label>
            <p>{{ ui.coverageNote }}</p>
          </div>
        </div>
      </div>

      <MapFilterPanel
        :ui="ui"
        :open="isFilterOpen"
        :selection="selection"
        :target-class-options="targetClassFilterOptions"
        :category-options="categoryFilterOptions"
        :subcategory-options="subcategoryFilterOptions"
        :biomarker-options="biomarkerFilterOptions"
        :year-options="yearFilterOptions"
        :loading-filters="isLoadingFilters"
        :loading-stats="isLoadingStats"
        :filters-ready="Boolean(filters)"
        @change="updateFilterSelection"
        @refresh="refreshStats"
        @reset="resetFilters"
        @toggle="toggleFilters"
      />

      <p v-if="activeMapMessage" class="map-message" :class="activeMapMessage.type">
        {{ activeMapMessage.text }}
      </p>
      <p v-if="boundaryLoadingMessage" class="boundary-loading-chip">
        {{ boundaryLoadingMessage }}
      </p>

      <aside
        v-if="canShowHeatLegend"
        class="map-heat-legend"
        :style="{ '--heat-gradient': heatLegendGradient }"
        aria-live="polite"
      >
        <div class="heat-legend-heading">
          <strong>{{ ui.heatLegendTitle }}</strong>
          <small v-if="canShowPndlGradient">{{ ui.heatLegendUnit }}</small>
        </div>
        <div v-if="canShowPndlGradient" class="heat-legend-strip" aria-hidden="true"></div>
        <div v-if="canShowPndlGradient" class="heat-legend-scale">
          <span v-for="band in heatLegendBands" :key="band.label">
            <i>{{ band.label }}</i>
            <b>{{ band.value }}</b>
          </span>
        </div>
        <p v-if="canShowPndlGradient">{{ ui.heatLegendNote }}</p>
        <div v-if="hasCoverageWithoutPndl" class="heat-legend-coverage-only">
          <i aria-hidden="true"></i>
          <span>{{ ui.heatLegendCoverageOnly }}</span>
        </div>
      </aside>

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
          <div>
            <span>{{ selectedDetail?.cluster ? ui.clusterTitle : ui.detailExploreTitle }}</span>
            <div v-if="selectedDetail" class="detail-region-title-line">
              <h2>{{ detailTitle }}</h2>
              <small v-if="detailLocationPrecision">{{ detailLocationPrecision }}</small>
            </div>
          </div>
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
            <button type="button" :aria-label="ui.closeDetail" @click.stop="() => closeDetail()">
              ×
            </button>
          </div>
        </header>

        <Transition name="detail-content">
          <div
            v-if="isLoadingDetail"
            key="loading"
            class="detail-loading-state"
            role="status"
            :aria-label="ui.loadingDetail"
          >
            <span class="detail-loading-spinner" aria-hidden="true"></span>
            <span class="visually-hidden">{{ ui.loadingDetail }}</span>
          </div>
          <div v-else-if="selectedDetail" key="content" class="detail-loaded-content">
            <p v-if="compactDetailCallout" class="detail-callout">{{ compactDetailCallout }}</p>
            <div v-if="compactSummaryCards.length" class="detail-summary-grid compact">
              <article v-for="card in compactSummaryCards" :key="card.label">
                <span>{{ compactSummaryCardLabel(card) }}</span>
                <strong>{{ card.value }}</strong>
              </article>
            </div>

            <section class="region-explorer-section">
              <h3>{{ ui.detailExploreTitle }}</h3>
              <div v-if="compactBiomarkers.length" class="region-biomarker-list">
                <button
                  v-for="item in compactBiomarkers"
                  :key="item.biomarkerKey"
                  class="region-biomarker-action"
                  type="button"
                  :disabled="!canApplyDetailBiomarker(item)"
                  @click.stop="applyDetailBiomarker(item)"
                >
                  <span class="region-biomarker-name">
                    <strong>{{ item.biomarkerLabel }}</strong>
                    <i :class="{ muted: !item.hasPndl }">
                      {{ detailBiomarkerPill(item) }}
                    </i>
                  </span>
                  <small>{{ detailBiomarkerMeta(item) }}</small>
                </button>
              </div>
              <p v-else class="drawer-message">{{ ui.detailExploreEmpty }}</p>
              <p class="region-explorer-note">{{ ui.detailExploreNote }}</p>
            </section>
          </div>
          <p v-else-if="detailError" key="error" class="drawer-message error">
            {{ detailError }}
          </p>
          <p v-else key="empty" class="drawer-message">{{ ui.emptyBackendDetail }}</p>
        </Transition>
      </aside>

      <Transition name="full-detail-modal">
        <div
          v-if="isFullDetailOpen"
          class="full-detail-backdrop"
          aria-live="polite"
          @click.self="closeFullDetail"
        >
          <aside class="full-detail-panel" aria-modal="true" role="dialog" @click.stop>
            <header>
              <div>
                <span>{{ ui.fullDetailTitle }}</span>
                <div class="full-detail-title-line">
                  <h2>{{ detailTitle }}</h2>
                  <p v-if="detailLocationPrecision">{{ detailLocationPrecision }}</p>
                </div>
              </div>
              <button type="button" :aria-label="ui.closeFullDetail" @click.stop="closeFullDetail">
                ×
              </button>
            </header>

            <div v-if="selectedDetail" class="full-detail-content">
              <section
                v-if="!canShowPndlComparisonSection && fullDetailCallout"
                class="detail-callout-section"
              >
                <p class="detail-callout">{{ fullDetailCallout }}</p>
              </section>

              <section v-if="canShowPndlComparisonSection" class="pndl-chart-section">
                <div class="section-title-row">
                  <div class="pndl-section-heading">
                    <h3>{{ ui.pndlComparison }}</h3>
                    <span v-if="effectiveFilterContext" class="pndl-context-inline">
                      {{ effectiveFilterContext }}
                    </span>
                  </div>
                  <div v-if="pndlComparisons.length > 1" class="pndl-modebar">
                    <button
                      v-for="mode in pndlComparisons"
                      :key="mode.key"
                      type="button"
                      :class="{ active: activePndlComparison?.key === mode.key }"
                      @click="activePndlComparisonKey = mode.key"
                    >
                      {{ localizedPndlComparisonLabel(mode) }}
                    </button>
                  </div>
                </div>
                <p v-if="detailCoverageWithoutPndl" class="pndl-coverage-note">
                  {{ ui.coverageWithoutPndl }}
                </p>
                <div v-if="canRenderPndlChart" class="pndl-column-wrap">
                  <div class="pndl-column-axis">
                    <div class="pndl-column-axis-title">
                      <i>PNDL</i>
                      <small>{{ ui.heatLegendUnit }}</small>
                      <em v-if="pndlChartUsesLogScale">{{ ui.pndlLogScale }}</em>
                    </div>
                    <span
                      v-for="tick in pndlChartTicks"
                      :key="`axis-${tick.ratio}`"
                      :style="{ bottom: `${tick.ratio * 100}%` }"
                    >
                      {{ formatCompact(tick.value) }}
                    </span>
                  </div>
                  <div class="pndl-column-plot">
                    <div class="pndl-column-grid" aria-hidden="true">
                      <i
                        v-for="tick in pndlChartTicks"
                        :key="`grid-${tick.ratio}`"
                        :style="{ bottom: `${tick.ratio * 100}%` }"
                      ></i>
                    </div>
                    <div
                      ref="pndlChartScrollRef"
                      class="pndl-column-chart"
                      :style="pndlChartColumnStyle"
                      @scroll="hidePndlColumnTooltip"
                    >
                      <article
                        v-for="item in pndlChartDisplayRows"
                        :key="`${item.level}-${item.geoKey}`"
                        class="pndl-column-item"
                        :class="{
                          selected: isPndlChartItemSelected(item),
                          'no-pndl': !hasPositivePndlValue(item.pndlMedianMgD1000inh),
                        }"
                        :data-chart-key="pndlRankingKey(item)"
                        @mouseenter="showPndlColumnTooltip(item, $event)"
                        @mousemove="showPndlColumnTooltip(item, $event)"
                        @mouseleave="hidePndlColumnTooltip"
                      >
                        <div class="pndl-column-barbox">
                          <span
                            class="pndl-column-value"
                            :style="{
                              bottom: `calc(${pndlChartPercent(item.pndlMedianMgD1000inh)}% + 7px)`,
                            }"
                          >
                            {{ pndlChartValueLabel(item.pndlMedianMgD1000inh) }}
                          </span>
                          <i
                            class="pndl-column-bar"
                            :style="{ height: `${pndlChartPercent(item.pndlMedianMgD1000inh)}%` }"
                          ></i>
                        </div>
                        <strong>{{ localizedPndlItemDisplayName(item) }}</strong>
                      </article>
                      <div
                        v-if="pndlColumnTooltipState.visible"
                        class="detail-chart-tooltip pndl-column-tooltip"
                        :style="{
                          left: `${pndlColumnTooltipState.x}px`,
                          top: `${pndlColumnTooltipState.y}px`,
                        }"
                      >
                        <strong>{{ pndlColumnTooltipState.title }}</strong>
                        <div class="detail-chart-tooltip-primary">
                          <span>{{ pndlColumnTooltipState.label }}</span>
                          <b>{{ pndlColumnTooltipState.value }}</b>
                        </div>
                        <div class="detail-chart-tooltip-metrics">
                          <span
                            v-for="metric in pndlColumnTooltipState.metrics"
                            :key="metric.label"
                          >
                            <small>{{ metric.label }}</small>
                            <b>{{ metric.value }}</b>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <p v-else class="pndl-status-card">{{ pndlChartStatusText }}</p>
              </section>

              <section
                v-if="!isClusterDetail || !selectedDetail.locations?.length"
                class="overview-summary-section"
              >
                <h3>{{ isClusterDetail ? ui.clusterOverview : ui.summaryOverview }}</h3>
                <div class="detail-summary-grid overview">
                  <article
                    v-for="card in fullDetailSummaryCards"
                    :key="card.label"
                    :class="overviewSummaryCardClass(card)"
                  >
                    <span>{{ localizedSummaryCardLabel(card) }}</span>
                    <strong>{{ card.value }}</strong>
                    <small v-if="card.note">{{ localizedSummaryCardNote(card) }}</small>
                  </article>
                </div>
              </section>

              <section v-if="!isClusterDetail && selectedDetail.biomarkerProperties?.length">
                <h3>{{ ui.physicochemicalProperties }}</h3>
                <div class="physchem-grid">
                  <article
                    v-for="item in selectedDetail.biomarkerProperties"
                    :key="`property-${item.biomarkerKey}`"
                    class="physchem-card"
                  >
                    <div class="physchem-card-head">
                      <strong>{{ item.biomarkerLabel }}</strong>
                      <span>{{ item.biomarkerCas || ui.noData }}</span>
                    </div>
                    <small
                      >{{ displayOptionLabel(item.category) }} /
                      {{ displayOptionLabel(item.subcategory) }}</small
                    >
                    <div class="physchem-values">
                      <span v-for="value in item.values" :key="value.text" :title="value.text">
                        {{ value.text }}
                      </span>
                    </div>
                  </article>
                </div>
              </section>

              <section v-if="canRenderTrendChart" class="trend-chart-section">
                <div class="section-title-row">
                  <div>
                    <h3>{{ ui.annualTrends }}</h3>
                    <span>{{ selectedBiomarkerLabel }}</span>
                  </div>
                </div>
                <div class="trend-chart-grid">
                  <article
                    v-for="series in renderableTrendSeries"
                    :key="series.metricKey"
                    class="trend-chart-card"
                  >
                    <div class="trend-card-head">
                      <strong>{{ localizedBackendLabel(series.label) }}</strong>
                      <span>{{ series.unit }}</span>
                    </div>
                    <svg
                      viewBox="-24 -18 728 258"
                      role="img"
                      :aria-label="localizedBackendLabel(series.label)"
                    >
                      <line x1="0" y1="210" x2="680" y2="210" class="trend-axis"></line>
                      <line x1="0" y1="0" x2="0" y2="210" class="trend-axis"></line>
                      <polyline
                        :points="trendPolylineForSeries(series)"
                        class="trend-line"
                      ></polyline>
                      <g
                        v-for="point in trendChartPointsForSeries(series)"
                        :key="point.year"
                        class="trend-point"
                        @mouseenter="showTrendPointTooltip(series, point, $event)"
                        @mousemove="showTrendPointTooltip(series, point, $event)"
                        @mouseleave="hideTrendPointTooltip"
                      >
                        <circle class="trend-point-hit" :cx="point.x" :cy="point.y" r="11"></circle>
                        <circle :cx="point.x" :cy="point.y" r="3.8"></circle>
                        <text :x="point.x" :y="point.y - 10">{{ point.label }}</text>
                        <text :x="point.x" y="236">{{ point.year }}</text>
                      </g>
                    </svg>
                    <div
                      v-if="
                        trendPointTooltipState.visible &&
                        trendPointTooltipState.key === series.metricKey
                      "
                      class="detail-chart-tooltip trend-point-tooltip"
                      :style="{
                        left: `${trendPointTooltipState.x}px`,
                        top: `${trendPointTooltipState.y}px`,
                      }"
                    >
                      <strong>{{ trendPointTooltipState.title }}</strong>
                      <div class="detail-chart-tooltip-primary">
                        <span>{{ trendPointTooltipState.label }}</span>
                        <b>{{ trendPointTooltipState.value }}</b>
                      </div>
                      <div class="detail-chart-tooltip-metrics">
                        <span v-for="metric in trendPointTooltipState.metrics" :key="metric.label">
                          <small>{{ metric.label }}</small>
                          <b>{{ metric.value }}</b>
                        </span>
                      </div>
                    </div>
                  </article>
                </div>
              </section>

              <section v-if="isClusterDetail && selectedDetail.locations?.length">
                <h3>{{ ui.locationsInCluster }}</h3>
                <div class="location-chip-list">
                  <span
                    v-for="item in selectedDetail.locations.slice(0, 40)"
                    :key="`${item.level}-${item.geoKey}`"
                  >
                    {{ localizedStatDisplayName(item) || item.displayName }}
                  </span>
                </div>
              </section>

              <details v-if="canRenderPndlChart" class="pndl-ranking-section">
                <summary>
                  <div class="pndl-ranking-summary">
                    <h3>{{ ui.pndlRanking }}</h3>
                    <span>{{ pndlChartTitle }}</span>
                  </div>
                </summary>
                <div class="pndl-ranking-table">
                  <div class="pndl-ranking-row head">
                    <span>{{ ui.pndlRanking }}</span>
                    <span>{{ ui.pndlMedian }}</span>
                    <span>{{ ui.records }}</span>
                    <span>{{ ui.literature }}</span>
                    <span>{{ ui.points }}</span>
                    <span>{{ ui.year }}</span>
                  </div>
                  <div
                    v-for="item in pndlRankingRows"
                    :key="`rank-${item.level}-${item.geoKey}`"
                    class="pndl-ranking-row"
                    :class="{ selected: isPndlChartItemSelected(item) }"
                  >
                    <strong>{{ item.rank }}. {{ localizedPndlItemDisplayName(item) }}</strong>
                    <span>{{ pndlChartValueLabel(item.pndlMedianMgD1000inh) }}</span>
                    <span>{{ formatNumber(item.pndlRecordCount ?? item.recordCount) }}</span>
                    <span>{{ formatNumber(item.pndlDoiCount ?? item.doiCount) }}</span>
                    <span>{{ formatNumber(item.pndlPointCount ?? item.pointCount) }}</span>
                    <span>{{ formatNumber(item.pndlYearCount ?? item.yearCount) }}</span>
                  </div>
                </div>
              </details>

              <details v-if="detailSourceRecords.length" class="source-record-section">
                <summary>
                  <div>
                    <h3>{{ ui.sourceRecords }}</h3>
                    <span>{{ formatNumber(detailSourceRecords.length) }}</span>
                  </div>
                </summary>
                <div class="source-record-table">
                  <div class="source-record-row head">
                    <span>{{ ui.sourceLocation }}</span>
                    <span>{{ ui.sourceSample }}</span>
                    <span>{{ ui.sourceMetric }}</span>
                    <span>{{ ui.sourceReference }}</span>
                  </div>
                  <div
                    v-for="record in detailSourceRecords"
                    :key="`source-${record.measurementId}`"
                    class="source-record-row"
                  >
                    <strong>{{ sourceRecordLocation(record) }}</strong>
                    <span>{{ sourceRecordSample(record) }}</span>
                    <span>{{ sourceRecordMetric(record) }}</span>
                    <span :title="sourceRecordReference(record)">{{
                      sourceRecordReference(record)
                    }}</span>
                  </div>
                </div>
              </details>

              <details
                v-if="detailReportedSites.length"
                class="source-record-section reported-site-section"
              >
                <summary>
                  <div>
                    <h3>{{ ui.reportedSites }}</h3>
                    <span>{{ formatNumber(detailReportedSites.length) }}</span>
                  </div>
                </summary>
                <div class="source-record-table reported-site-table">
                  <div class="source-record-row head">
                    <span>{{ ui.siteIdentity }}</span>
                    <span>{{ ui.siteName }}</span>
                    <span>{{ ui.siteLinkStatus }}</span>
                    <span>{{ ui.siteCoverage }}</span>
                  </div>
                  <div
                    v-for="site in detailReportedSites"
                    :key="site.effectiveSiteKey"
                    class="source-record-row"
                  >
                    <strong :title="reportedSiteLocation(site)">{{
                      reportedSiteIdentity(site)
                    }}</strong>
                    <span
                      :title="`${reportedSiteLocation(site)}${site.siteNote ? ` · ${site.siteNote}` : ''}`"
                    >
                      {{ reportedSiteName(site) }}
                    </span>
                    <span>{{ localizedBackendLabel(site.matchStatus) || ui.noData }}</span>
                    <span>{{ formatNumber(site.recordCount ?? 0) }}</span>
                  </div>
                </div>
              </details>

              <details class="detail-note-section">
                <summary>
                  <h3>{{ ui.dataNotes }}</h3>
                </summary>
                <ul>
                  <li v-for="note in detailNoteItems" :key="note">{{ note }}</li>
                </ul>
              </details>
            </div>
          </aside>
        </div>
      </Transition>
    </section>
  </main>
</template>

<style src="../styles/map-visualization.css"></style>
