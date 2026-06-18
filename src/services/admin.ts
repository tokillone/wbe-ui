import type { UserResponse } from './auth'
import { authHeaders } from './session'

export interface AdminUserPage {
  items: UserResponse[]
  page: number
  size: number
  total: number
  totalPages: number
}

export interface UserQueryParams {
  page?: number
  size?: number
  keyword?: string
  role?: UserResponse['role'] | 'all'
  canUpload?: boolean | 'all'
  canReviewUploads?: boolean | 'all'
  canSyncData?: boolean | 'all'
  canDownload?: boolean | 'all'
}

export interface UserPermissionPayload {
  role: UserResponse['role']
  canUpload: boolean
  canReviewUploads: boolean
  canSyncData: boolean
  canDownload: boolean
}

export interface BulkUserPermissionPayload {
  userIds: number[]
  role?: UserResponse['role']
  canUpload?: boolean
  canReviewUploads?: boolean
  canSyncData?: boolean
  canDownload?: boolean
}

export interface BulkUserPermissionResult {
  updatedCount: number
  updatedUsers: UserResponse[]
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'

async function requestAdmin<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options?.headers ?? {}),
    },
  })
  const result = (await response.json().catch(() => null)) as ApiResponse<T> | null

  if (!response.ok || result?.code !== 200) {
    throw new Error(result?.message || '管理员请求失败')
  }

  return result.data
}

function appendParam(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null || value === '' || value === 'all') return
  params.set(key, String(value))
}

export function fetchUsers(query: UserQueryParams = {}) {
  const params = new URLSearchParams()
  appendParam(params, 'page', query.page ?? 1)
  appendParam(params, 'size', query.size ?? 20)
  appendParam(params, 'keyword', query.keyword?.trim())
  appendParam(params, 'role', query.role)
  appendParam(params, 'canUpload', query.canUpload)
  appendParam(params, 'canReviewUploads', query.canReviewUploads)
  appendParam(params, 'canSyncData', query.canSyncData)
  appendParam(params, 'canDownload', query.canDownload)
  return requestAdmin<AdminUserPage>(`/admin/users?${params}`)
}

export function updateUserPermissions(userId: number, payload: UserPermissionPayload) {
  return requestAdmin<UserResponse>(`/admin/users/${userId}/permissions`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function bulkUpdateUserPermissions(payload: BulkUserPermissionPayload) {
  return requestAdmin<BulkUserPermissionResult>('/admin/users/bulk-permissions', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}
