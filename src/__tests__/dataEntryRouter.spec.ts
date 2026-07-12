import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { UserResponse } from '../services/auth'

const authMocks = vi.hoisted(() => ({
  fetchCurrentUser: vi.fn(),
}))

vi.mock('../services/auth', async () => {
  const actual = await vi.importActual<typeof import('../services/auth')>('../services/auth')
  return {
    ...actual,
    fetchCurrentUser: authMocks.fetchCurrentUser,
  }
})

import router from '../router'

function user(overrides: Partial<UserResponse> = {}): UserResponse {
  return {
    userId: 1,
    username: 'route-user',
    email: 'route@example.test',
    role: 'viewer',
    canUpload: false,
    canReviewUploads: false,
    canSyncData: false,
    canDownload: true,
    isActive: true,
    ...overrides,
  }
}

function storeSession(currentUser: UserResponse) {
  localStorage.setItem(
    'wbe-auth-session',
    JSON.stringify({ token: 'fresh-token', tokenType: 'Bearer', expiresIn: 3600, user: currentUser }),
  )
}

describe('data entry route permission refresh', () => {
  beforeEach(async () => {
    localStorage.clear()
    vi.clearAllMocks()
    await router.replace('/')
  })

  it('uses the refreshed auth/me permissions instead of stale local access', async () => {
    storeSession(user({ role: 'editor', canUpload: true }))
    authMocks.fetchCurrentUser.mockResolvedValue(user({ role: 'editor', canUpload: false }))

    await router.push('/data-entry')

    expect(router.currentRoute.value.path).toBe('/')
    expect(authMocks.fetchCurrentUser).toHaveBeenCalledWith('fresh-token')
    const stored = JSON.parse(localStorage.getItem('wbe-auth-session') ?? '{}')
    expect(stored.user.canUpload).toBe(false)
  })

  it('allows any refreshed functional permission through the shared route', async () => {
    const syncUser = user({ canSyncData: true })
    storeSession(user())
    authMocks.fetchCurrentUser.mockResolvedValue(syncUser)

    await router.push('/data-entry')

    expect(router.currentRoute.value.path).toBe('/data-entry')
  })

  it('clears an invalid session when auth/me fails', async () => {
    storeSession(user({ canUpload: true }))
    authMocks.fetchCurrentUser.mockRejectedValue(new Error('expired'))

    await router.push('/data-entry')

    expect(router.currentRoute.value.path).toBe('/')
    expect(localStorage.getItem('wbe-auth-session')).toBeNull()
  })
})
