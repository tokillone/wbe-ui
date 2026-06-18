export interface LoginPayload {
  account: string
  password: string
  captchaId?: string
  captchaCode?: string
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

export interface UserResponse {
  userId: number
  username: string
  email: string
  fullName?: string | null
  role: 'admin' | 'editor' | 'viewer'
  canUpload: boolean
  canReviewUploads: boolean
  canSyncData: boolean
  canDownload: boolean
  isActive: boolean
  lastLogin?: string | null
}

export interface LoginResponse {
  token: string
  tokenType: string
  expiresIn: number
  user: UserResponse
}

export interface CaptchaResponse {
  captchaId: string
  imageBase64: string
  expiresIn: number
}

export interface ApiResult<T = unknown> {
  success: boolean
  message: string
  data?: T
}

interface ApiResponse<T = unknown> {
  code: number
  message: string
  data: T
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'

type AuthRequestBody = LoginPayload | RegisterPayload | ResetPasswordPayload | { email: string }

export class AuthRequestError extends Error {
  code?: number

  constructor(message: string, code?: number) {
    super(message)
    this.name = 'AuthRequestError'
    this.code = code
  }
}

async function requestAuth<T = unknown>(
  endpoint: string,
  body: AuthRequestBody,
): Promise<ApiResult<T>> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const result = (await response.json().catch(() => null)) as ApiResponse<T> | null

  if (!response.ok) {
    throw new AuthRequestError(result?.message || '服务暂时不可用，请稍后再试', result?.code)
  }

  return {
    success: result?.code === 200,
    message: result?.message || '操作成功',
    data: result?.data,
  }
}

export function sendVerificationCode(email: string, scene: 'register' | 'reset-password') {
  const endpoint =
    scene === 'register' ? '/auth/register/send-code' : '/auth/password/forgot/send-code'
  return requestAuth(endpoint, { email })
}

export function login(payload: LoginPayload) {
  return requestAuth<LoginResponse>('/auth/login', payload)
}

export async function fetchCaptcha() {
  const response = await fetch(`${API_BASE_URL}/auth/captcha`)
  const result = (await response.json().catch(() => null)) as ApiResponse<CaptchaResponse> | null
  if (!response.ok || result?.code !== 200 || !result.data) {
    throw new AuthRequestError(result?.message || '图形验证码获取失败', result?.code)
  }
  return result.data
}

export async function logout(token: string) {
  const response = await fetch(`${API_BASE_URL}/auth/logout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
  const result = (await response.json().catch(() => null)) as ApiResponse | null
  if (!response.ok) {
    throw new Error(result?.message || '退出登录失败')
  }
  return {
    success: result?.code === 200,
    message: result?.message || '已退出登录',
  }
}

export function register(payload: RegisterPayload) {
  return requestAuth<UserResponse>('/auth/register', payload)
}

export function resetPassword(payload: ResetPasswordPayload) {
  return requestAuth('/auth/password/reset', payload)
}

export async function fetchCurrentUser(token: string) {
  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
  const result = (await response.json().catch(() => null)) as ApiResponse<UserResponse> | null
  if (!response.ok || result?.code !== 200 || !result.data) {
    throw new Error(result?.message || '登录状态已失效')
  }
  return result.data
}
