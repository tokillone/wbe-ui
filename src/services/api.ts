import { authHeaders, clearSession } from './session'

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'

function redirectAfterUnauthorized() {
  clearSession()
  if (window.location.pathname !== '/') {
    window.location.assign('/')
  }
}

export async function requestApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
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
