import { authHeaders, clearSession } from './session'
import { API_BASE_URL } from '../config/api'

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export class ApiTimeoutError extends Error {
  constructor(message = '请求超时，请检查网络后重试') {
    super(message)
    this.name = 'ApiTimeoutError'
  }
}

export interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number
}

function redirectAfterUnauthorized() {
  clearSession()
  if (window.location.pathname !== '/') {
    window.location.assign('/')
  }
}

export async function requestApi<T>(endpoint: string, options?: ApiRequestOptions): Promise<T> {
  const { timeoutMs, signal: callerSignal, ...fetchOptions } = options ?? {}
  const timeoutController = timeoutMs && timeoutMs > 0 ? new AbortController() : null
  let didTimeout = false
  const abortFromCaller = () => timeoutController?.abort(callerSignal?.reason)
  if (timeoutController && callerSignal) {
    if (callerSignal.aborted) {
      abortFromCaller()
    } else {
      callerSignal.addEventListener('abort', abortFromCaller, { once: true })
    }
  }
  const timeoutId =
    timeoutController && timeoutMs
      ? window.setTimeout(() => {
          didTimeout = true
          timeoutController.abort()
        }, timeoutMs)
      : null

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...fetchOptions,
      signal: timeoutController?.signal ?? callerSignal,
      headers: {
        ...authHeaders(),
        ...(options?.headers ?? {}),
      },
    })
    const result = (await response.json().catch(() => null)) as ApiResponse<T> | null

    if (response.status === 401 || result?.code === 401) {
      redirectAfterUnauthorized()
      throw new Error(result?.message || '登录状态已失效，请重新登录')
    }

    if (!response.ok || result?.code !== 200) {
      throw new Error(result?.message || '请求失败')
    }

    return result.data
  } catch (error) {
    if (didTimeout) {
      throw new ApiTimeoutError()
    }
    throw error
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId)
    callerSignal?.removeEventListener('abort', abortFromCaller)
  }
}

export async function fetchBlob(endpoint: string, fallbackMessage: string) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: authHeaders(),
  })
  const result = response.ok ? null : ((await response.json().catch(() => null)) as ApiResponse<unknown> | null)

  if (response.status === 401 || result?.code === 401) {
    redirectAfterUnauthorized()
    throw new Error(result?.message || '登录状态已失效，请重新登录')
  }

  if (!response.ok) {
    throw new Error(result?.message || fallbackMessage)
  }

  return response.blob()
}
