import type {
  MapClusterLocationRequest,
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

  let response: Response
  try {
    response = await fetch(url, { signal })
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
  const url = new URL(`${API_BASE_URL}${endpoint}`, window.location.origin)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      targetClass: selection.targetClass,
      category: selection.category,
      subcategory: selection.subcategory,
      biomarkerKey: selection.biomarkerKey,
      year: selection.year,
    },
    signal,
  )
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
  )
}
