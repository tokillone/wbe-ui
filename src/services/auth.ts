export interface LoginPayload {
  account: string
  password: string
}

export interface RegisterPayload {
  username: string
  email: string
  password: string
  code: string
}

export interface ResetPasswordPayload {
  email: string
  newPassword: string
  code: string
}

export interface ApiResult {
  success: boolean
  message: string
  data?: unknown
}

interface ApiResponse<T = unknown> {
  code: number
  message: string
  data: T
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'

type AuthRequestBody =
  | LoginPayload
  | RegisterPayload
  | ResetPasswordPayload
  | { email: string }

async function requestAuth(endpoint: string, body: AuthRequestBody): Promise<ApiResult> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const result = (await response.json().catch(() => null)) as ApiResponse | null

  if (!response.ok) {
    throw new Error(result?.message || '服务暂时不可用，请稍后再试')
  }

  return {
    success: result?.code === 200,
    message: result?.message || '操作成功',
    data: result?.data,
  }
}

export function sendVerificationCode(email: string, scene: 'register' | 'reset-password') {
  const endpoint = scene === 'register' ? '/auth/register/send-code' : '/auth/password/forgot/send-code'
  return requestAuth(endpoint, { email })
}

export function login(payload: LoginPayload) {
  return requestAuth('/auth/login', payload)
}

export function register(payload: RegisterPayload) {
  return requestAuth('/auth/register', payload)
}

export function resetPassword(payload: ResetPasswordPayload) {
  return requestAuth('/auth/password/reset', payload)
}
