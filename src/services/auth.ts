import { API_BASE_URL } from '../config/api'
import { ApiError, apiErrorFromResponse, apiErrorFromUnknown } from './errors'

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

type AuthRequestBody = LoginPayload | RegisterPayload | ResetPasswordPayload | { email: string }

export class AuthRequestError extends ApiError {
  override readonly code?: number

  constructor(message: string, code?: number, status?: number, cause?: unknown) {
    super(message, {
      kind: code === 428 || status === 400 ? 'validation' : 'unknown',
      code,
      status,
      cause,
    })
    this.name = 'AuthRequestError'
    this.code = code
  }
}

async function requestAuth<T = unknown>(
  endpoint: string,
  body: AuthRequestBody,
): Promise<ApiResult<T>> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw apiErrorFromUnknown(error, '网络连接异常，请检查网络后重试')
  }

  const result = (await response.json().catch(() => null)) as ApiResponse<T> | null

  if (!response.ok || result?.code !== 200) {
    const error = apiErrorFromResponse(response.status, result?.code, result?.message)
    throw new AuthRequestError(error.message, result?.code, response.status, error)
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
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/auth/captcha`)
  } catch (error) {
    throw apiErrorFromUnknown(error, '图形验证码获取失败，请稍后重试')
  }
  const result = (await response.json().catch(() => null)) as ApiResponse<CaptchaResponse> | null
  if (!response.ok || result?.code !== 200 || !result.data) {
    const error = apiErrorFromResponse(
      response.status,
      result?.code,
      result?.message,
      '图形验证码获取失败，请稍后重试',
    )
    throw new AuthRequestError(error.message, result?.code, response.status, error)
  }
  return result.data
}

export async function logout(token: string) {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
  } catch (error) {
    throw apiErrorFromUnknown(error, '退出登录失败，请稍后重试')
  }
  const result = (await response.json().catch(() => null)) as ApiResponse | null
  if (!response.ok || result?.code !== 200) {
    throw apiErrorFromResponse(response.status, result?.code, result?.message, '退出登录失败')
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
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
  } catch (error) {
    throw apiErrorFromUnknown(error, '暂时无法验证登录状态，请稍后重试')
  }
  const result = (await response.json().catch(() => null)) as ApiResponse<UserResponse> | null
  if (!response.ok || result?.code !== 200 || !result.data) {
    throw apiErrorFromResponse(
      response.status,
      result?.code,
      result?.message,
      '登录状态已失效，请重新登录',
    )
  }
  return result.data
}
