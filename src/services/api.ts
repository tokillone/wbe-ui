import { authHeaders, clearSession } from './session'
import { API_BASE_URL } from '../config/api'
import { ApiError, apiErrorFromResponse, apiErrorFromUnknown } from './errors'

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export class ApiTimeoutError extends ApiError {
  constructor(message = '请求超时，请检查网络后重试') {
    super(message, { kind: 'timeout' })
    this.name = 'ApiTimeoutError'
  }
}

export interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number
  auth?: boolean
  redirectOnUnauthorized?: boolean
}

function redirectAfterUnauthorized() {
  clearSession()
  if (window.location.pathname !== '/') {
    window.location.assign('/')
  }
}

export async function requestApi<T>(endpoint: string, options?: ApiRequestOptions): Promise<T> {
  const {
    timeoutMs,
    auth = true,
    redirectOnUnauthorized = true,
    signal: callerSignal,
    ...fetchOptions
  } = options ?? {}
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
        ...(auth ? authHeaders() : {}),
        ...options?.headers,
      },
    })
    const result = (await response.json().catch(() => null)) as ApiResponse<T> | null

    if (response.status === 401 || result?.code === 401) {
      if (redirectOnUnauthorized) redirectAfterUnauthorized()
      throw apiErrorFromResponse(response.status, result?.code, result?.message)
    }

    if (!response.ok || result?.code !== 200) {
      throw apiErrorFromResponse(
        response.status,
        result?.code,
        result?.message,
        '请求未完成，请稍后重试',
      )
    }

    return result.data
  } catch (error) {
    if (didTimeout) {
      throw new ApiTimeoutError()
    }
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw apiErrorFromUnknown(error, '网络连接异常，请检查网络后重试')
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId)
    callerSignal?.removeEventListener('abort', abortFromCaller)
  }
}

export async function fetchBlob(endpoint: string, fallbackMessage: string) {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, { headers: authHeaders() })
  } catch (error) {
    throw apiErrorFromUnknown(error, '网络连接异常，请检查网络后重试')
  }
  const result = response.ok ? null : ((await response.json().catch(() => null)) as ApiResponse<unknown> | null)

  if (response.status === 401 || result?.code === 401) {
    redirectAfterUnauthorized()
    throw apiErrorFromResponse(response.status, result?.code, result?.message)
  }

  if (!response.ok) {
    throw apiErrorFromResponse(response.status, result?.code, result?.message, fallbackMessage)
  }

  return response.blob()
}
