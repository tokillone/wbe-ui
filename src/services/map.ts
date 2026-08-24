import type {
  MapClusterLocationRequest,
  MapDetailResponse,
  MapFilterResponse,
  MapFilterSelection,
  MapPndlRankingItem,
  MapRegionStat,
  MapStatsResponse,
} from '../types/map'
import { API_BASE_URL } from '../config/api'
import { excludeSpecialAdminCityRows, isSpecialAdminCityGeoKey } from '../utils/mapVisualization'
import { requestApi } from './api'

export function buildMapApiUrl(
  endpoint: string,
  params?: Record<string, string | undefined>,
) {
  if (!endpoint.startsWith('/') || endpoint.startsWith('//')) {
    throw new Error('地图接口必须使用 /api 下的相对路径')
  }
  const searchParams = new URLSearchParams()
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value) searchParams.set(key, value)
  })
  const query = searchParams.toString()
  return `${API_BASE_URL}${endpoint}${query ? `?${query}` : ''}`
}

async function requestMap<T>(
  endpoint: string,
  params?: Record<string, string | undefined>,
  signal?: AbortSignal,
): Promise<T> {
  const url = buildMapApiUrl(endpoint, params)
  return requestApi<T>(url.slice(API_BASE_URL.length), {
    headers: { Accept: 'application/json' },
    signal,
    auth: false,
    redirectOnUnauthorized: false,
  })
}

async function postMap<T>(
  endpoint: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return requestApi<T>(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
    auth: false,
    redirectOnUnauthorized: false,
  })
}

export function buildSelectionKey(...parts: string[]) {
  return parts.join('|||')
}

export function fetchMapFilters(signal?: AbortSignal) {
  return requestMap<MapFilterResponse>('/map/filters', undefined, signal)
}

export function fetchMapStats(
  selection: MapFilterSelection,
  levels: string[],
  signal?: AbortSignal,
) {
  return requestMap<MapStatsResponse>(
    '/map/stats',
    {
      targetClass: selection.targetClass,
      category: selection.category,
      subcategory: selection.subcategory,
      biomarkerKey: selection.biomarkerKey,
      year: selection.year,
      levels: levels.join(','),
    },
    signal,
  ).then(normalizeMapStatsResponse)
}

export function fetchMapDetail(
  level: string,
  geoKey: string,
  selection: MapFilterSelection,
  signal?: AbortSignal,
) {
  return requestMap<MapDetailResponse>(
    '/map/detail',
    {
      level,
      geoKey,
      targetClass: selection.targetClass,
      category: selection.category,
      subcategory: selection.subcategory,
      biomarkerKey: selection.biomarkerKey,
      year: selection.year,
    },
    signal,
  ).then(normalizeMapDetailResponse)
}

export function fetchMapClusterDetail(
  selection: MapFilterSelection,
  locations: MapClusterLocationRequest[],
  signal?: AbortSignal,
) {
  return postMap<MapDetailResponse>(
    '/map/cluster-detail',
    {
      targetClass: selection.targetClass,
      category: selection.category,
      subcategory: selection.subcategory,
      biomarkerKey: selection.biomarkerKey,
      year: selection.year,
      limit: 30,
      locations,
    },
    signal,
  ).then(normalizeMapDetailResponse)
}

type LegacyPndlValue = {
  pndlMedianMgD1000inh?: number | null
  pndlGeomeanMgD1000inh?: number | null
}

function representativePndlValue(row: LegacyPndlValue) {
  const median = Number(row.pndlMedianMgD1000inh)
  if (Number.isFinite(median) && median > 0) return median
  const legacyGeomean = Number(row.pndlGeomeanMgD1000inh)
  return Number.isFinite(legacyGeomean) && legacyGeomean > 0 ? legacyGeomean : null
}

function normalizeRegionStat(row: MapRegionStat): MapRegionStat {
  return {
    ...row,
    pndlMedianMgD1000inh: representativePndlValue(row),
  }
}

function normalizeRankingItem(row: MapPndlRankingItem): MapPndlRankingItem {
  return {
    ...row,
    pndlMedianMgD1000inh: representativePndlValue(row),
  }
}

function normalizeSelectedRankingItem(
  row: MapPndlRankingItem,
  region: MapRegionStat | null,
): MapPndlRankingItem {
  const normalized = normalizeRankingItem(row)
  if (!region || row.level !== region.level || row.geoKey !== region.geoKey) return normalized
  return {
    ...normalized,
    pndlMedianMgD1000inh: region.pndlMedianMgD1000inh,
    recordCount: region.recordCount ?? normalized.recordCount,
    doiCount: region.doiCount ?? normalized.doiCount,
    pointCount: region.pointCount ?? normalized.pointCount,
    yearCount: region.yearCount ?? normalized.yearCount,
  }
}

export function normalizeMapStatsResponse(response: MapStatsResponse): MapStatsResponse {
  const regions = excludeSpecialAdminCityRows(response.regions ?? []).map(normalizeRegionStat)
  const points = excludeSpecialAdminCityRows(response.points ?? []).map(normalizeRegionStat)
  const removedLegacySpecialAdminCities =
    regions.length !== (response.regions ?? []).length || points.length !== (response.points ?? []).length
  return {
    ...response,
    summary: removedLegacySpecialAdminCities
      ? {
          countryCount: regions.filter((row) => row.level === 'country').length,
          admin1Count: regions.filter((row) => row.level === 'admin1').length,
          cityCount: regions.filter((row) => row.level === 'city').length,
          pointCount: points.length,
          recordCount: regions.reduce((sum, row) => sum + Number(row.recordCount ?? 0), 0),
          doiCount: regions.reduce((sum, row) => sum + Number(row.doiCount ?? 0), 0),
        }
      : response.summary,
    regions,
    points,
  }
}

export function normalizeMapDetailResponse(response: MapDetailResponse): MapDetailResponse {
  const region =
    response.region && !isSpecialAdminCityGeoKey(response.region.level, response.region.geoKey)
      ? normalizeRegionStat(response.region)
      : null
  return {
    ...response,
    region,
    locations:
      response.locations == null
        ? response.locations
        : excludeSpecialAdminCityRows(response.locations).map(normalizeRegionStat),
    summaryCards: response.summaryCards?.map((card) =>
      card.label === 'PNDL 几何均值' ? { ...card, label: '当前 PNDL' } : card,
    ) ?? response.summaryCards,
    pndlRanking:
      response.pndlRanking == null
        ? response.pndlRanking
        : excludeSpecialAdminCityRows(response.pndlRanking).map((row) =>
            normalizeSelectedRankingItem(row, region),
          ),
    pndlComparisons: response.pndlComparisons?.map((comparison) => ({
      ...comparison,
      rows: excludeSpecialAdminCityRows(comparison.rows ?? []).map((row) =>
        normalizeSelectedRankingItem(row, region),
      ),
    })) ?? response.pndlComparisons,
  }
}
