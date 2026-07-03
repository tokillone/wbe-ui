import type { LoginResponse, UserResponse } from './auth'

const STORAGE_KEY = 'wbe-auth-session'

export type ManagedRole = 'admin' | 'editor'

export function saveSession(session: LoginResponse) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function getStoredSession(): LoginResponse | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as LoginResponse
    if (!parsed.token || !parsed.user) return null
    return parsed
  } catch {
    return null
  }
}

export function updateStoredUser(user: UserResponse) {
  const session = getStoredSession()
  if (!session) return
  saveSession({ ...session, user })
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY)
}

export function getAuthToken() {
  return getStoredSession()?.token ?? ''
}

export function authHeaders(): HeadersInit {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function canManageData(user?: UserResponse | null) {
  return (
    user?.role === 'admin' ||
    user?.role === 'editor' ||
    user?.canUpload === true ||
    user?.canReviewUploads === true ||
    user?.canSyncData === true
  )
}

export function isAdmin(user?: UserResponse | null) {
  return user?.role === 'admin'
}
