import type {
  MapDetailResponse,
  MapFilterResponse,
  MapFilterSelection,
  MapStatsResponse,
} from '../types/map'

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'

async function requestMap<T>(
  endpoint: string,
  params?: Record<string, string | undefined>,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(`${API_BASE_URL}${endpoint}`, window.location.origin)
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value)
  })

  const response = await fetch(url, { signal })
  const result = (await response.json().catch(() => null)) as ApiResponse<T> | null

  if (!response.ok) {
    throw new Error(result?.message || '地图数据暂时不可用')
  }

  if (result?.code !== 200 || !result.data) {
    throw new Error(result?.message || '地图数据返回异常')
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
      category: selection.category,
      subcategory: selection.subcategory,
      biomarkerKey: selection.biomarkerKey,
      year: selection.year,
      levels: levels.join(','),
    },
    signal,
  )
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
      category: selection.category,
      subcategory: selection.subcategory,
      biomarkerKey: selection.biomarkerKey,
      year: selection.year,
    },
    signal,
  )
}
