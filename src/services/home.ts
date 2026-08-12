import { API_BASE_URL } from '../config/api'
import { safeServerMessage } from './errors'

interface ApiResponse<T> {
  code?: number
  message?: string
  data?: T
}

export type HomeOverviewErrorKind = 'failed' | 'timeout' | 'unauthorized' | 'invalid'

export class HomeOverviewRequestError extends Error {
  readonly kind: HomeOverviewErrorKind
  readonly status?: number

  constructor(kind: HomeOverviewErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'HomeOverviewRequestError'
    this.kind = kind
    this.status = status
  }
}

export interface HomeOverviewQuery {
  targetCategory?: string
  targetGroup?: string
  limit?: number
  minFrequency?: number
}

const HOME_OVERVIEW_TIMEOUT_MS = 10_000
const inFlightRequests = new Map<string, Promise<unknown>>()

function buildOverviewUrl(query: HomeOverviewQuery) {
  const params = new URLSearchParams()
  if (query.targetCategory) params.set('targetCategory', query.targetCategory)
  if (query.targetGroup) params.set('targetGroup', query.targetGroup)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.minFrequency !== undefined) params.set('minFrequency', String(query.minFrequency))
  const queryString = params.toString()
  return `${API_BASE_URL}/home/overview${queryString ? `?${queryString}` : ''}`
}

async function requestHomeOverview<T>(url: string, timeoutMs: number): Promise<Partial<T>> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
    const body = (await response.json().catch(() => null)) as ApiResponse<Partial<T>> | null

    if (response.status === 401 || body?.code === 401) {
      throw new HomeOverviewRequestError(
        'unauthorized',
        safeServerMessage(body?.message, 401, '登录状态已失效，请重新登录后重试'),
        401,
      )
    }
    if (!response.ok || (body?.code !== undefined && body.code !== 200)) {
      throw new HomeOverviewRequestError(
        'failed',
        safeServerMessage(
          body?.message,
          response.status,
          '首页数据服务暂时不可用，请稍后重试',
        ),
        response.status,
      )
    }
    if (!body || !body.data || typeof body.data !== 'object') {
      throw new HomeOverviewRequestError('invalid', '首页接口返回了无法识别的数据')
    }
    return body.data
  } catch (error) {
    if (error instanceof HomeOverviewRequestError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new HomeOverviewRequestError('timeout', '首页数据请求超时，请检查网络后重试')
    }
    throw new HomeOverviewRequestError('failed', '首页数据加载失败，请检查网络后重试')
  } finally {
    window.clearTimeout(timeout)
  }
}

export function fetchHomeOverview<T>(
  query: HomeOverviewQuery = {},
  timeoutMs = HOME_OVERVIEW_TIMEOUT_MS,
): Promise<Partial<T>> {
  const url = buildOverviewUrl(query)
  const existing = inFlightRequests.get(url) as Promise<Partial<T>> | undefined
  if (existing) return existing

  const request = requestHomeOverview<T>(url, timeoutMs).finally(() => {
    if (inFlightRequests.get(url) === request) {
      inFlightRequests.delete(url)
    }
  })
  inFlightRequests.set(url, request)
  return request
}

export function clearHomeOverviewRequestsForTest() {
  inFlightRequests.clear()
}
