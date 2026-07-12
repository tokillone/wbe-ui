import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { UserResponse } from '../services/auth'

const apiMocks = vi.hoisted(() => ({
  fetchCurrentUser: vi.fn(),
  logout: vi.fn(),
  fetchUploads: vi.fn(),
  fetchUploadRows: vi.fn(),
  fetchUsers: vi.fn(),
}))

vi.mock('../services/auth', async () => {
  const actual = await vi.importActual<typeof import('../services/auth')>('../services/auth')
  return {
    ...actual,
    fetchCurrentUser: apiMocks.fetchCurrentUser,
    logout: apiMocks.logout,
  }
})

vi.mock('../services/dataUploads', async () => {
  const actual = await vi.importActual<typeof import('../services/dataUploads')>('../services/dataUploads')
  return {
    ...actual,
    fetchUploads: apiMocks.fetchUploads,
    fetchUploadRows: apiMocks.fetchUploadRows,
  }
})

vi.mock('../services/admin', async () => {
  const actual = await vi.importActual<typeof import('../services/admin')>('../services/admin')
  return {
    ...actual,
    fetchUsers: apiMocks.fetchUsers,
  }
})

import DataEntryView from '../views/DataEntryView.vue'
import { canManageData } from '../services/session'

const emptyBatchPage = { items: [], page: 1, size: 20, total: 0, totalPages: 0 }
const emptyUserPage = { items: [], page: 1, size: 10, total: 0, totalPages: 0 }

function batch(status: string) {
  return {
    uploadId: 10,
    fileName: 'review.xlsx',
    status,
    uploadedBy: 9,
    uploadedByName: 'uploader',
    uploadedByRole: 'viewer',
    totalRows: 1,
    validRows: 1,
    errorRows: 0,
    warningRows: 0,
    syncedRows: 0,
    createdAt: '2025-06-15T10:30:00',
  }
}

function user(overrides: Partial<UserResponse>): UserResponse {
  return {
    userId: 1,
    username: 'test-user',
    email: 'test@example.test',
    role: 'viewer',
    canUpload: false,
    canReviewUploads: false,
    canSyncData: false,
    canDownload: true,
    isActive: true,
    ...overrides,
  }
}

async function mountFor(currentUser: UserResponse) {
  localStorage.setItem(
    'wbe-auth-session',
    JSON.stringify({ token: 'test-token', tokenType: 'Bearer', expiresIn: 3600, user: currentUser }),
  )
  apiMocks.fetchCurrentUser.mockResolvedValue(currentUser)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div>home</div>' } },
      { path: '/map-visualization', component: { template: '<div>map</div>' } },
      { path: '/data-entry', component: DataEntryView },
    ],
  })
  await router.push('/data-entry')
  await router.isReady()
  const wrapper = mount(DataEntryView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

function workspaceModules(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('.workspace-nav button').map((button) => button.find('strong').text())
}

describe('data entry permissions', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    apiMocks.fetchUploads.mockResolvedValue(emptyBatchPage)
    apiMocks.fetchUsers.mockResolvedValue(emptyUserPage)
    apiMocks.logout.mockResolvedValue({ success: true, message: 'ok' })
  })

  it('does not grant the workspace solely from the editor role', () => {
    expect(canManageData(user({ role: 'editor' }))).toBe(false)
    expect(canManageData(user({ canUpload: true }))).toBe(true)
    expect(canManageData(user({ canReviewUploads: true }))).toBe(true)
    expect(canManageData(user({ canSyncData: true }))).toBe(true)
    expect(canManageData(user({ role: 'admin', canDownload: false }))).toBe(true)
  })

  it('shows all modules to admin from the shared data-entry route', async () => {
    const wrapper = await mountFor(user({ role: 'admin', canDownload: false }))

    expect(workspaceModules(wrapper)).toEqual(['上传录入', '上传批次', '用户权限'])
    expect(apiMocks.fetchCurrentUser).toHaveBeenCalledWith('test-token')
    wrapper.unmount()
  })

  it('shows upload and own batch modules to an upload user', async () => {
    const wrapper = await mountFor(user({ canUpload: true }))

    expect(workspaceModules(wrapper)).toEqual(['上传录入', '上传批次'])
    expect(wrapper.text()).not.toContain('账号权限')
    wrapper.unmount()
  })

  it('opens reviewers on the pending review queue', async () => {
    apiMocks.fetchUploads.mockResolvedValue({
      ...emptyBatchPage,
      items: [batch('PENDING_REVIEW')],
      total: 1,
      totalPages: 1,
    })
    const wrapper = await mountFor(user({ canReviewUploads: true }))

    expect(workspaceModules(wrapper)).toEqual(['上传批次'])
    expect(apiMocks.fetchUploads).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'PENDING_REVIEW', scope: 'pendingReview' }),
    )
    expect(wrapper.findAll('.row-actions button').map((button) => button.text())).toEqual([
      '查看/审核',
      '下载',
      '审核通过',
    ])
    wrapper.unmount()
  })

  it('opens sync users on the approved queue', async () => {
    apiMocks.fetchUploads.mockResolvedValue({
      ...emptyBatchPage,
      items: [batch('APPROVED')],
      total: 1,
      totalPages: 1,
    })
    const wrapper = await mountFor(user({ canSyncData: true }))

    expect(workspaceModules(wrapper)).toEqual(['上传批次'])
    expect(apiMocks.fetchUploads).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'APPROVED', scope: 'approved' }),
    )
    expect(wrapper.findAll('.row-actions button').map((button) => button.text())).toEqual([
      '查看',
      '下载',
      '同步',
    ])
    wrapper.unmount()
  })
})
