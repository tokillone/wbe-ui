import type { UserResponse } from './auth'
import { requestApi } from './api'

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

function appendParam(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null || value === '' || value === 'all') return
  params.set(key, String(value))
}

export function fetchUsers(query: UserQueryParams = {}) {
  const params = new URLSearchParams()
  appendParam(params, 'page', query.page ?? 1)
  appendParam(params, 'size', query.size ?? 10)
  appendParam(params, 'keyword', query.keyword?.trim())
  appendParam(params, 'role', query.role)
  appendParam(params, 'canUpload', query.canUpload)
  appendParam(params, 'canReviewUploads', query.canReviewUploads)
  appendParam(params, 'canSyncData', query.canSyncData)
  appendParam(params, 'canDownload', query.canDownload)
  return requestApi<AdminUserPage>(`/admin/users?${params}`)
}

export function updateUserPermissions(userId: number, payload: UserPermissionPayload) {
  return requestApi<UserResponse>(`/admin/users/${userId}/permissions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function bulkUpdateUserPermissions(payload: BulkUserPermissionPayload) {
  return requestApi<BulkUserPermissionResult>('/admin/users/bulk-permissions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}
