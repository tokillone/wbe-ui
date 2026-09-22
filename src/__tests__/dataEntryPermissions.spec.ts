import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { UserResponse } from '../services/auth'

const api = vi.hoisted(() => ({
  fetchUploads: vi.fn(), fetchUploadBatch: vi.fn(), fetchUploadProcessing: vi.fn(),
  fetchReviewRecords: vi.fn(), fetchRefreshJobs: vi.fn(), fetchCanonicalTerms: vi.fn(),
  fetchDictionaryChanges: vi.fn(), fetchUsers: vi.fn(), uploadSubmission: vi.fn(),
}))

vi.mock('../services/dataUploads', () => ({
  fetchUploads: api.fetchUploads,
  fetchUploadBatch: api.fetchUploadBatch,
  fetchUploadProcessing: api.fetchUploadProcessing,
  fetchReviewRecords: api.fetchReviewRecords,
  fetchRefreshJobs: api.fetchRefreshJobs,
  fetchCanonicalTerms: api.fetchCanonicalTerms,
  fetchDictionaryChanges: api.fetchDictionaryChanges,
  uploadSubmission: api.uploadSubmission,
  uploadCorrection: vi.fn(), submitReadyDoiGroups: vi.fn(), patchReviewRecord: vi.fn(),
  completeUploadReview: vi.fn(), publishUpload: vi.fn(), retryRefreshJob: vi.fn(),
  returnUploadReview: vi.fn(), cancelUploadSubmission: vi.fn(),
  requestDictionaryChange: vi.fn(), reviewDictionaryChange: vi.fn(),
  downloadUploadIssues: vi.fn(), downloadUploadTemplate: vi.fn(),
}))

vi.mock('../services/admin', () => ({
  fetchUsers: api.fetchUsers,
  updateUserPermissions: vi.fn(),
}))

import DataEntryView from '../views/DataEntryView.vue'
import { canManageData } from '../services/session'

const emptyBatchPage = { items: [], page: 1, size: 20, total: 0, totalPages: 0 }

function user(overrides: Partial<UserResponse>): UserResponse {
  return {
    userId: 1, username: 'test-user', email: 'test@example.test', role: 'viewer',
    canUpload: false, canReviewUploads: false, canSyncData: false, canDownload: true,
    isActive: true, ...overrides,
  }
}

function batch(status: string) {
  return {
    uploadId: 10, fileName: 'submission-v2.xlsx', status, uploadedBy: 9,
    uploadedByName: 'uploader', totalRows: 6, validRows: 3, errorRows: 2,
    warningRows: 1, syncedRows: 0, createdAt: '2026-09-21T10:30:00',
  }
}

function processing(status: string) {
  return {
    uploadId: 10, internalStatus: status, userStatus: status === 'PENDING_REVIEW' ? '审核中' : '待发布',
    processedRows: 6, totalRows: 6, readyDoiGroups: 1, heldDoiGroups: 1,
    duplicateDoiGroups: 1, reservedDoiGroups: 1, groups: [], availableActions: [],
  }
}

async function mountFor(currentUser: UserResponse) {
  localStorage.setItem('wbe-auth-session', JSON.stringify({ token: 'test-token', user: currentUser }))
  const wrapper = mount(DataEntryView, { global: { stubs: { PlatformHeader: true } } })
  await flushPromises()
  return wrapper
}

describe('SUBMISSION_V2 data workspace permissions', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    api.fetchUploads.mockResolvedValue(emptyBatchPage)
    api.fetchRefreshJobs.mockResolvedValue([])
    api.fetchCanonicalTerms.mockResolvedValue([])
    api.fetchDictionaryChanges.mockResolvedValue([])
    api.fetchUsers.mockResolvedValue({ items: [], page: 1, size: 50, total: 0, totalPages: 0 })
    api.fetchReviewRecords.mockResolvedValue({ uploadId: 10, page: 1, size: 20, total: 0, records: [] })
  })

  it('grants workspace access only through explicit data permissions or admin role', () => {
    expect(canManageData(user({ role: 'editor' }))).toBe(false)
    expect(canManageData(user({ canUpload: true }))).toBe(true)
    expect(canManageData(user({ canReviewUploads: true }))).toBe(true)
    expect(canManageData(user({ canSyncData: true }))).toBe(true)
    expect(canManageData(user({ role: 'admin' }))).toBe(true)
  })

  it('shows the four-stage uploader flow and no admin permission tab', async () => {
    const wrapper = await mountFor(user({ canUpload: true }))
    expect(wrapper.findAll('.stage-rail button')).toHaveLength(4)
    expect(wrapper.text()).toContain('下载三表模板')
    expect(wrapper.text()).not.toContain('角色与权限')
    wrapper.unmount()
  })

  it('rejects an oversized workbook before calling the upload API', async () => {
    const wrapper = await mountFor(user({ canUpload: true }))
    const oversized = new File(['x'], 'large.xlsx')
    Object.defineProperty(oversized, 'size', { value: 50 * 1024 * 1024 + 1 })
    const input = wrapper.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [oversized] })
    await input.trigger('change')
    expect(wrapper.text()).toContain('50MB 以内')
    expect(api.uploadSubmission).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('opens a reviewer directly on webpage normalization without a five-sheet package', async () => {
    api.fetchUploads.mockResolvedValue({ ...emptyBatchPage, items: [batch('PENDING_REVIEW')], total: 1, totalPages: 1 })
    api.fetchUploadBatch.mockResolvedValue(batch('PENDING_REVIEW'))
    api.fetchUploadProcessing.mockResolvedValue(processing('PENDING_REVIEW'))
    const wrapper = await mountFor(user({ canReviewUploads: true }))
    expect(wrapper.text()).toContain('网页规范化审核')
    expect(wrapper.text()).toContain('上传者不能审核自己的批次')
    expect(wrapper.text()).not.toContain('五表审核包')
    wrapper.unmount()
  })

  it('does not expose review editors when a non-admin reviewer opens their own batch', async () => {
    const ownBatch = { ...batch('PENDING_REVIEW'), uploadedBy: 1 }
    api.fetchUploads.mockResolvedValue({ ...emptyBatchPage, items: [ownBatch], total: 1, totalPages: 1 })
    api.fetchUploadBatch.mockResolvedValue(ownBatch)
    api.fetchUploadProcessing.mockResolvedValue(processing('PENDING_REVIEW'))
    api.fetchReviewRecords.mockResolvedValue({
      uploadId: 10, page: 1, size: 20, total: 1,
      records: [{ rowId: 101, groupId: 1, excelRowNumber: 3, stableRowId: 'R1', normalizedDoi: '10.1/self', status: 'VALID', raw: {}, standardized: {}, errors: [], warnings: [], coreEligible: true, mapEligible: false, sankeyEligible: false, reviewVersion: 1 }],
    })
    const wrapper = await mountFor(user({ canReviewUploads: true }))
    expect(wrapper.text()).toContain('上传者不能审核自己的批次')
    expect(wrapper.text()).not.toContain('保存本条')
    expect(wrapper.text()).not.toContain('规范字典变更申请')
    wrapper.unmount()
  })

  it('only enables the publish action for canSyncData users', async () => {
    api.fetchUploads.mockResolvedValue({ ...emptyBatchPage, items: [batch('READY_TO_PUBLISH')], total: 1, totalPages: 1 })
    api.fetchUploadBatch.mockResolvedValue(batch('READY_TO_PUBLISH'))
    api.fetchUploadProcessing.mockResolvedValue(processing('READY_TO_PUBLISH'))
    const readOnly = await mountFor(user({ canReviewUploads: true }))
    expect(readOnly.get('.publish-panel .button.primary').attributes('disabled')).toBeDefined()
    readOnly.unmount()
    const publisher = await mountFor(user({ canSyncData: true }))
    expect(publisher.get('.publish-panel .button.primary').attributes('disabled')).toBeUndefined()
    publisher.unmount()
  })

  it('shows role and dictionary governance only to administrators', async () => {
    const wrapper = await mountFor(user({ role: 'admin' }))
    expect(wrapper.text()).toContain('角色与权限')
    await wrapper.findAll('.workspace-tabs button')[2]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('待审批字典变更')
    wrapper.unmount()
  })
})
