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

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

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

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error('无法连接后端地图接口，请确认后端服务已启动')
  }
  const result = (await response.json().catch(() => null)) as ApiResponse<T> | null

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('地图接口不存在或前端代理未连接')
    }
    if (response.status >= 500) {
      throw new Error(result?.message || '后端地图接口异常，请检查服务日志')
    }
    throw new Error(result?.message || `地图请求失败（${response.status}）`)
  }

  if (result?.code !== 200 || !result.data) {
    throw new Error(result?.message || '地图数据返回异常，请检查接口响应格式')
  }

  return result.data
}

async function postMap<T>(
  endpoint: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const url = buildMapApiUrl(endpoint)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error('无法连接后端地图接口，请确认后端服务已启动')
  }
  const result = (await response.json().catch(() => null)) as ApiResponse<T> | null

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('地图接口不存在或前端代理未连接')
    }
    if (response.status >= 500) {
      throw new Error(result?.message || '后端地图接口异常，请检查服务日志')
    }
    throw new Error(result?.message || `地图请求失败（${response.status}）`)
  }

  if (result?.code !== 200 || !result.data) {
    throw new Error(result?.message || '地图数据返回异常，请检查接口响应格式')
  }

  return result.data
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
  return {
    ...response,
    regions: (response.regions ?? []).map(normalizeRegionStat),
    points: (response.points ?? []).map(normalizeRegionStat),
  }
}

export function normalizeMapDetailResponse(response: MapDetailResponse): MapDetailResponse {
  const region = response.region ? normalizeRegionStat(response.region) : null
  return {
    ...response,
    region,
    locations: response.locations?.map(normalizeRegionStat) ?? response.locations,
    summaryCards: response.summaryCards?.map((card) =>
      card.label === 'PNDL 几何均值' ? { ...card, label: '当前 PNDL' } : card,
    ) ?? response.summaryCards,
    pndlRanking: response.pndlRanking?.map((row) => normalizeSelectedRankingItem(row, region)) ?? response.pndlRanking,
    pndlComparisons: response.pndlComparisons?.map((comparison) => ({
      ...comparison,
      rows: (comparison.rows ?? []).map((row) => normalizeSelectedRankingItem(row, region)),
    })) ?? response.pndlComparisons,
  }
}
