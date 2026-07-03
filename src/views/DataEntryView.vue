<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import {
  bulkUpdateUserPermissions,
  fetchUsers,
  updateUserPermissions,
  type AdminUserPage,
  type BulkUserPermissionPayload,
  type UserPermissionPayload,
} from '../services/admin'
import { logout as requestLogout, type UserResponse } from '../services/auth'
import {
  downloadUploadFile,
  downloadUploadTemplate,
  fetchUploadRows,
  fetchUploads,
  rejectUpload,
  syncUpload,
  uploadPreview,
  type DataUploadBatch,
  type DataUploadBatchPage,
  type DataUploadPreview,
  type DataUploadRowsPage,
} from '../services/dataUploads'
import { clearSession, getStoredSession, isAdmin, updateStoredUser } from '../services/session'

type WorkspaceSection = 'upload' | 'batches' | 'users'
type PermissionFilter = 'all' | 'true' | 'false'
type BatchStatusFilter = 'all' | 'PENDING_REVIEW' | 'PREVIEWED' | 'VALIDATION_FAILED' | 'SYNCED' | 'REJECTED'
type BatchScopeFilter = 'all' | 'mine' | 'pendingReview'
type BatchUploaderTypeFilter = 'all' | 'viewer' | 'manager'
type RowStatusFilter = 'all' | 'ERROR' | 'WARNING' | 'VALID' | 'SYNCED' | 'SKIPPED'

const PREVIEW_COLUMNS = [
  '文献编号',
  '目标类别',
  '目标物质类别',
  '药物',
  '生物标记物名称',
  '污水厂名称',
  'PNDL_value',
  'PNDL_unit',
  'DOI',
]

const FIELD_GROUPS = [
  { title: '文献与目标物', fields: '文献编号、目标类别、目标物质类别、目标物质子类、药物、生物标记物名称、biomarker、CAS' },
  { title: '方法与地点', fields: '采样方法、分析方法、MDL/MQL/IDL/IQL、污水厂名称、处理规模、汇水区人数、国家/省/市' },
  { title: '浓度与负荷', fields: '做图浓度、进水浓度 min/max/average/median、DLs、PNDL、估算 PNDL、做图 PNDL' },
  { title: '追踪字段', fields: '来源工作簿说明、原表行号说明为可选列，用于重复检查和审计追踪' },
]

const STATUS_LABELS: Record<string, string> = {
  PREVIEWED: '可同步',
  PENDING_REVIEW: '待审核',
  VALIDATION_FAILED: '需修正',
  SYNCED: '已入库',
  SYNC_FAILED: '同步失败',
  REJECTED: '已驳回',
  VALID: '通过',
  WARNING: '有警告',
  ERROR: '错误',
  SKIPPED: '已跳过',
}

const BATCH_STATUS_FILTERS = [
  { value: 'all', label: '全部状态' },
  { value: 'PENDING_REVIEW', label: '待审核' },
  { value: 'PREVIEWED', label: '可同步' },
  { value: 'VALIDATION_FAILED', label: '需修正' },
  { value: 'SYNCED', label: '已入库' },
  { value: 'REJECTED', label: '已驳回' },
]

const BATCH_SCOPE_FILTERS = [
  { value: 'all', label: '全部批次' },
  { value: 'mine', label: '我的上传' },
  { value: 'pendingReview', label: '待审核队列' },
]

const BATCH_UPLOADER_FILTERS = [
  { value: 'all', label: '全部上传人' },
  { value: 'viewer', label: '普通用户上传' },
  { value: 'manager', label: '管理人员上传' },
]

const ROW_STATUS_FILTERS = [
  { value: 'all', label: '全部行' },
  { value: 'ERROR', label: '错误' },
  { value: 'WARNING', label: '警告' },
  { value: 'VALID', label: '通过' },
  { value: 'SYNCED', label: '已同步' },
  { value: 'SKIPPED', label: '已跳过' },
]

const ROLE_LABELS: Record<UserResponse['role'], string> = {
  admin: '系统管理员',
  editor: '管理人员',
  viewer: '普通用户',
}

const ROLE_FILTERS = [
  { value: 'all', label: '全部角色' },
  { value: 'admin', label: '系统管理员' },
  { value: 'editor', label: '管理人员' },
  { value: 'viewer', label: '普通用户' },
]

const PERMISSION_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'true', label: '已开启' },
  { value: 'false', label: '已关闭' },
]

const PAGE_SIZE_OPTIONS = [10, 20, 50]
const PREVIEW_ISSUE_LIMIT = 6

const BULK_ACTIONS = [
  { value: 'role-editor', label: '设为管理人员' },
  { value: 'role-viewer', label: '设为普通用户' },
  { value: 'upload-on', label: '开启上传' },
  { value: 'upload-off', label: '关闭上传' },
  { value: 'review-on', label: '开启审核' },
  { value: 'review-off', label: '关闭审核' },
  { value: 'sync-on', label: '开启同步' },
  { value: 'sync-off', label: '关闭同步' },
  { value: 'download-on', label: '允许下载' },
  { value: 'download-off', label: '禁止下载' },
]

const emptyUserPage: AdminUserPage = {
  items: [],
  page: 1,
  size: 10,
  total: 0,
  totalPages: 0,
}

const emptyBatchPage: DataUploadBatchPage = {
  items: [],
  page: 1,
  size: 20,
  total: 0,
  totalPages: 0,
}

function normalizeBatchPagePayload(payload: unknown, fallbackPage: number, fallbackSize: number): DataUploadBatchPage {
  if (payload && typeof payload === 'object' && Array.isArray((payload as DataUploadBatchPage).items)) {
    const page = payload as DataUploadBatchPage
    return {
      items: page.items,
      page: Number.isFinite(page.page) ? page.page : fallbackPage,
      size: Number.isFinite(page.size) ? page.size : fallbackSize,
      total: Number.isFinite(page.total) ? page.total : page.items.length,
      totalPages: Number.isFinite(page.totalPages) ? page.totalPages : (page.items.length ? 1 : 0),
    }
  }
  if (Array.isArray(payload)) {
    return {
      items: payload as DataUploadBatch[],
      page: fallbackPage,
      size: fallbackSize,
      total: payload.length,
      totalPages: payload.length ? 1 : 0,
    }
  }
  return { ...emptyBatchPage, page: fallbackPage, size: fallbackSize }
}

const session = getStoredSession()
const router = useRouter()
const currentUser = ref<UserResponse | null>(session?.user ?? null)
const activeSection = ref<WorkspaceSection>('upload')
const selectedFile = ref<File | null>(null)
const isDragging = ref(false)
const isUploading = ref(false)
const isSyncing = ref(false)
const isLoadingBatches = ref(false)
const isLoadingRows = ref(false)
const isLoadingUsers = ref(false)
const isSavingUser = ref(false)
const preview = ref<DataUploadPreview | null>(null)
const selectedBatch = ref<DataUploadBatch | null>(null)
const selectedRowsPage = ref<DataUploadRowsPage | null>(null)
const batchPage = ref<DataUploadBatchPage>({ ...emptyBatchPage })
const userPage = ref<AdminUserPage>({ ...emptyUserPage })
const selectedUserIds = ref<Set<number>>(new Set())
const editingUser = ref<UserResponse | null>(null)
const bulkAction = ref('')
const reviewNote = ref('')
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const rowStatusFilter = ref<RowStatusFilter>('all')
const batchFilters = reactive({
  keyword: '',
  status: 'all' as BatchStatusFilter,
  scope: 'all' as BatchScopeFilter,
  uploaderType: 'all' as BatchUploaderTypeFilter,
})
const userFilters = reactive({
  keyword: '',
  role: 'all' as UserResponse['role'] | 'all',
  canUpload: 'all' as PermissionFilter,
  canReviewUploads: 'all' as PermissionFilter,
  canSyncData: 'all' as PermissionFilter,
  canDownload: 'all' as PermissionFilter,
})
const permissionForm = reactive<UserPermissionPayload>({
  role: 'viewer',
  canUpload: false,
  canReviewUploads: false,
  canSyncData: false,
  canDownload: true,
})

const currentUserIsAdmin = computed(() => isAdmin(currentUser.value))
const canUploadData = computed(() => currentUser.value?.role === 'admin' || currentUser.value?.canUpload === true)
const canReviewUploads = computed(
  () => currentUser.value?.role === 'admin' || currentUser.value?.canReviewUploads === true,
)
const canSyncData = computed(() => currentUser.value?.role === 'admin' || currentUser.value?.canSyncData === true)
const currentUserCanDownload = computed(() => currentUser.value?.canDownload !== false)
const canSeeBatchModule = computed(() => canUploadData.value || canReviewUploads.value || canSyncData.value)
const selectedFileLabel = computed(() => selectedFile.value?.name ?? '拖拽或选择 WBE Excel 文件')
const canSyncPreview = computed(
  () =>
    !!preview.value &&
    preview.value.batch.errorRows === 0 &&
    canSyncData.value &&
    ['PREVIEWED', 'PENDING_REVIEW'].includes(preview.value.batch.status),
)
const visibleHeaderErrors = computed(() => preview.value?.headerErrors.slice(0, PREVIEW_ISSUE_LIMIT) ?? [])
const hiddenHeaderErrorCount = computed(() =>
  Math.max(0, (preview.value?.headerErrors.length ?? 0) - PREVIEW_ISSUE_LIMIT),
)
const visibleBatchWarnings = computed(() => preview.value?.batchWarnings.slice(0, PREVIEW_ISSUE_LIMIT) ?? [])
const hiddenBatchWarningCount = computed(() =>
  Math.max(0, (preview.value?.batchWarnings.length ?? 0) - PREVIEW_ISSUE_LIMIT),
)
const previewBlockingMessage = computed(() => {
  if (!preview.value) return ''
  if (preview.value.batch.status === 'VALIDATION_FAILED') {
    return '该文件未通过基础格式校验，不能同步入库。请确认存在“数据表”工作表，并按模板修正前 58 列字段后重新上传。'
  }
  if (preview.value.batch.errorRows > 0) {
    return '存在阻断错误的行，不能同步入库。请查看行预览中的问题字段，修正后重新上传。'
  }
  if (preview.value.batch.status === 'REJECTED') {
    return '该批次已被驳回，不能继续同步；如需入库请重新上传修正后的文件。'
  }
  return ''
})

const workspaceSections = computed(() => {
  const sections: Array<{ key: WorkspaceSection; title: string; caption: string }> = []
  if (canUploadData.value) {
    sections.push({ key: 'upload', title: '上传录入', caption: '模板、校验、预览' })
  }
  if (canSeeBatchModule.value) {
    sections.push({ key: 'batches', title: '上传批次', caption: '历史、审核、行预览' })
  }
  if (currentUserIsAdmin.value) {
    sections.push({ key: 'users', title: '用户权限', caption: '分页、筛选、批量赋权' })
  }
  return sections
})

const activeHeaderLabel = computed(() => {
  if (activeSection.value === 'batches') return '上传记录'
  if (activeSection.value === 'users') return '权限管理'
  return '上传录入'
})

const selectableCurrentPageUsers = computed(() => userPage.value.items.filter((user) => user.role !== 'admin'))
const selectedCount = computed(() => selectedUserIds.value.size)
const currentPageAllSelected = computed(
  () =>
    selectableCurrentPageUsers.value.length > 0 &&
    selectableCurrentPageUsers.value.every((user) => selectedUserIds.value.has(user.userId)),
)
const currentPageSomeSelected = computed(
  () =>
    selectableCurrentPageUsers.value.some((user) => selectedUserIds.value.has(user.userId)) &&
    !currentPageAllSelected.value,
)

watch(workspaceSections, (sections) => {
  if (!sections.some((section) => section.key === activeSection.value)) {
    activeSection.value = sections[0]?.key ?? 'upload'
  }
})

watch(activeSection, (section) => {
  if (section === 'batches') void loadBatches()
  if (section === 'users' && currentUserIsAdmin.value) void loadUsers(1)
})

onMounted(async () => {
  activeSection.value = workspaceSections.value[0]?.key ?? 'upload'
  if (canSeeBatchModule.value) await loadBatches()
  if (currentUserIsAdmin.value) await loadUsers(1)
})

function setMessage(type: 'success' | 'error', text: string) {
  messageType.value = type
  message.value = text
}

function setActiveSection(section: WorkspaceSection) {
  activeSection.value = section
}

function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status
}

function roleLabel(role: UserResponse['role']) {
  return ROLE_LABELS[role]
}

function formatDate(value?: string | null) {
  if (!value) return '未记录'
  return value.replace('T', ' ').slice(0, 16)
}

function formatMaybeDate(value?: string | null) {
  return value ? formatDate(value) : '-'
}

function uploadRoleLabel(role?: string | null) {
  if (role === 'admin') return '系统管理员'
  if (role === 'editor') return '管理人员'
  if (role === 'viewer') return '普通用户'
  return '未知角色'
}

function uploadSourceLabel(batch: DataUploadBatch) {
  if (batch.uploadedBy === currentUser.value?.userId) return '我的上传'
  if (batch.uploadedByRole === 'viewer') return '普通用户上传'
  if (batch.uploadedByRole === 'admin' || batch.uploadedByRole === 'editor') return '管理人员上传'
  return '未知来源'
}

function userCapabilities(user: UserResponse) {
  const caps = []
  if (user.role === 'admin') caps.push('用户管理')
  if (user.role === 'admin' || user.canUpload) caps.push('上传')
  if (user.role === 'admin' || user.canReviewUploads) caps.push('审核')
  if (user.role === 'admin' || user.canSyncData) caps.push('同步')
  if (user.canDownload !== false) caps.push('下载')
  return caps.length ? caps : ['无功能']
}

function permissionFilterValue(value: PermissionFilter) {
  if (value === 'all') return 'all'
  return value === 'true'
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  selectedFile.value = input.files?.[0] ?? null
  message.value = ''
}

function handleDrop(event: DragEvent) {
  isDragging.value = false
  selectedFile.value = event.dataTransfer?.files?.[0] ?? null
  message.value = ''
}

async function handleDownloadTemplate() {
  try {
    await downloadUploadTemplate()
    setMessage('success', 'Excel 模板已开始下载')
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : '模板下载失败')
  }
}

async function handlePreview() {
  if (!selectedFile.value) {
    setMessage('error', '请先选择 .xlsx 文件')
    return
  }
  try {
    isUploading.value = true
    preview.value = await uploadPreview(selectedFile.value)
    selectedBatch.value = null
    selectedRowsPage.value = null
    await loadBatches()
    const { errorRows, warningRows, status } = preview.value.batch
    if (errorRows > 0) {
      setMessage('error', `解析完成，但存在 ${errorRows} 行阻断错误，请修正后重新上传。`)
    } else if (status === 'PENDING_REVIEW') {
      setMessage('success', `解析完成，已进入待审核队列。提示警告 ${warningRows} 行。`)
    } else {
      setMessage('success', `解析完成，可同步入库。提示警告 ${warningRows} 行。`)
    }
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : '上传解析失败')
  } finally {
    isUploading.value = false
  }
}

async function handlePreviewSync() {
  if (!preview.value || !canSyncPreview.value) return
  await handleBatchSync(preview.value.batch)
}

async function loadBatches() {
  await loadBatchPage(batchPage.value.page)
}

async function loadBatchPage(page = batchPage.value.page) {
  try {
    isLoadingBatches.value = true
    const response = await fetchUploads({
      page,
      size: batchPage.value.size,
      keyword: batchFilters.keyword,
      status: batchFilters.status,
      scope: batchFilters.scope,
      uploaderType: batchFilters.uploaderType,
      sort: 'createdAt_desc',
    })
    batchPage.value = normalizeBatchPagePayload(response, page, batchPage.value.size)
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : '上传批次加载失败')
  } finally {
    isLoadingBatches.value = false
  }
}

async function loadRows(batch: DataUploadBatch, page = 1) {
  try {
    isLoadingRows.value = true
    selectedBatch.value = batch
    selectedRowsPage.value = await fetchUploadRows(batch.uploadId, page, 20, rowStatusFilter.value)
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : '行预览加载失败')
  } finally {
    isLoadingRows.value = false
  }
}

async function applyBatchFilters() {
  await loadBatchPage(1)
}

async function changeBatchPageSize(event: Event) {
  const select = event.target as HTMLSelectElement
  batchPage.value = { ...batchPage.value, size: Number(select.value) }
  await loadBatchPage(1)
}

async function changeRowStatusFilter() {
  if (!selectedBatch.value) return
  await loadRows(selectedBatch.value, 1)
}

function closeBatchDrawer() {
  selectedBatch.value = null
  selectedRowsPage.value = null
  reviewNote.value = ''
  rowStatusFilter.value = 'all'
}

function canApproveAndSync(batch: DataUploadBatch) {
  if (batch.status === 'PENDING_REVIEW') {
    return canReviewUploads.value && canSyncData.value
  }
  return batch.status === 'PREVIEWED' && canSyncData.value
}

async function handleBatchSync(batch: DataUploadBatch) {
  if (!canApproveAndSync(batch)) return
  const action = batch.status === 'PENDING_REVIEW' ? '通过审核并同步入库' : '同步入库'
  if (!window.confirm(`确定要${action}「${batch.fileName}」吗？`)) return
  try {
    isSyncing.value = true
    const result = await syncUpload(batch.uploadId)
    if (preview.value?.batch.uploadId === batch.uploadId) {
      preview.value = { ...preview.value, batch: result.batch }
    }
    selectedBatch.value = result.batch
    await loadBatches()
    if (selectedRowsPage.value?.uploadId === batch.uploadId) {
      await loadRows(result.batch, selectedRowsPage.value.page)
    }
    const warningText = result.warnings.length ? `；${result.warnings.join('；')}` : ''
    setMessage('success', `已同步 ${result.insertedRows} 行，跳过重复 ${result.skippedRows} 行${warningText}`)
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : '同步失败')
  } finally {
    isSyncing.value = false
  }
}

async function handleRejectBatch(batch: DataUploadBatch) {
  if (!canReviewUploads.value || batch.status !== 'PENDING_REVIEW') return
  if (!window.confirm(`确定驳回「${batch.fileName}」吗？`)) return
  try {
    const rejectedBatch = await rejectUpload(batch.uploadId, reviewNote.value)
    selectedBatch.value = rejectedBatch
    await loadBatches()
    reviewNote.value = ''
    setMessage('success', '批次已驳回')
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : '驳回失败')
  }
}

async function downloadBatch(batch: DataUploadBatch) {
  if (!currentUserCanDownload.value) {
    setMessage('error', '当前账号已被禁止下载文件，请联系系统管理员调整权限')
    return
  }
  try {
    await downloadUploadFile(batch.uploadId, batch.fileName)
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : '文件下载失败')
  }
}

async function loadUsers(page = userPage.value.page) {
  if (!currentUserIsAdmin.value) return
  try {
    isLoadingUsers.value = true
    userPage.value = await fetchUsers({
      page,
      size: userPage.value.size,
      keyword: userFilters.keyword,
      role: userFilters.role,
      canUpload: permissionFilterValue(userFilters.canUpload),
      canReviewUploads: permissionFilterValue(userFilters.canReviewUploads),
      canSyncData: permissionFilterValue(userFilters.canSyncData),
      canDownload: permissionFilterValue(userFilters.canDownload),
    })
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : '用户列表加载失败')
  } finally {
    isLoadingUsers.value = false
  }
}

async function applyUserFilters() {
  selectedUserIds.value = new Set()
  await loadUsers(1)
}

async function changePageSize(event: Event) {
  const select = event.target as HTMLSelectElement
  userPage.value = { ...userPage.value, size: Number(select.value) }
  selectedUserIds.value = new Set()
  await loadUsers(1)
}

function toggleUserSelection(userId: number, checked: boolean) {
  const next = new Set(selectedUserIds.value)
  if (checked) next.add(userId)
  else next.delete(userId)
  selectedUserIds.value = next
}

function toggleCurrentPageSelection(checked: boolean) {
  const next = new Set(selectedUserIds.value)
  for (const user of selectableCurrentPageUsers.value) {
    if (checked) next.add(user.userId)
    else next.delete(user.userId)
  }
  selectedUserIds.value = next
}

function clearSelectedUsers() {
  selectedUserIds.value = new Set()
  bulkAction.value = ''
}

function openPermissionDrawer(user: UserResponse) {
  if (user.role === 'admin') return
  editingUser.value = user
  permissionForm.role = user.role
  permissionForm.canUpload = user.canUpload
  permissionForm.canReviewUploads = user.canReviewUploads
  permissionForm.canSyncData = user.canSyncData
  permissionForm.canDownload = user.canDownload !== false
}

function closePermissionDrawer() {
  editingUser.value = null
}

function applyRoleDefaults(role: UserResponse['role']) {
  permissionForm.role = role
  if (role === 'editor') {
    permissionForm.canUpload = true
    permissionForm.canReviewUploads = true
    permissionForm.canSyncData = true
    permissionForm.canDownload = true
  } else if (role === 'viewer') {
    permissionForm.canUpload = false
    permissionForm.canReviewUploads = false
    permissionForm.canSyncData = false
    permissionForm.canDownload = true
  }
}

async function savePermissionDrawer() {
  if (!editingUser.value) return
  try {
    isSavingUser.value = true
    const updated = await updateUserPermissions(editingUser.value.userId, { ...permissionForm })
    userPage.value = {
      ...userPage.value,
      items: userPage.value.items.map((user) => (user.userId === updated.userId ? updated : user)),
    }
    if (currentUser.value?.userId === updated.userId) {
      currentUser.value = updated
      updateStoredUser(updated)
    }
    closePermissionDrawer()
    setMessage('success', '用户权限已更新')
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : '权限更新失败')
  } finally {
    isSavingUser.value = false
  }
}

function buildBulkPatch(action: string): BulkUserPermissionPayload | null {
  const userIds = [...selectedUserIds.value]
  if (!userIds.length) return null
  switch (action) {
    case 'role-editor':
      return { userIds, role: 'editor', canUpload: true, canReviewUploads: true, canSyncData: true, canDownload: true }
    case 'role-viewer':
      return { userIds, role: 'viewer', canUpload: false, canReviewUploads: false, canSyncData: false, canDownload: true }
    case 'upload-on':
      return { userIds, canUpload: true }
    case 'upload-off':
      return { userIds, canUpload: false }
    case 'review-on':
      return { userIds, canReviewUploads: true }
    case 'review-off':
      return { userIds, canReviewUploads: false }
    case 'sync-on':
      return { userIds, canSyncData: true }
    case 'sync-off':
      return { userIds, canSyncData: false }
    case 'download-on':
      return { userIds, canDownload: true }
    case 'download-off':
      return { userIds, canDownload: false }
    default:
      return null
  }
}

async function applyBulkAction() {
  const action = BULK_ACTIONS.find((item) => item.value === bulkAction.value)
  const payload = buildBulkPatch(bulkAction.value)
  if (!action || !payload) {
    setMessage('error', '请选择批量操作和用户')
    return
  }
  if (!window.confirm(`确定对 ${selectedCount.value} 个用户执行「${action.label}」吗？`)) return
  try {
    const result = await bulkUpdateUserPermissions(payload)
    setMessage('success', `已更新 ${result.updatedCount} 个用户`)
    clearSelectedUsers()
    await loadUsers(userPage.value.page)
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : '批量更新失败')
  }
}

async function handleLogout() {
  const token = getStoredSession()?.token
  try {
    if (token) await requestLogout(token)
  } finally {
    clearSession()
    currentUser.value = null
    void router.push('/')
  }
}
</script>

<template>
  <main class="entry-shell">
    <header class="entry-header">
      <RouterLink class="brand" to="/" aria-label="返回首页">
        <span class="brand-logo" aria-hidden="true">
          <span class="brand-drop"></span>
          <span class="brand-bars"><i></i><i></i><i></i></span>
          <span class="brand-line"><i></i><i></i></span>
        </span>
        <span>
          <strong>污水信息因子数据库</strong>
          <small>Data Entry Console</small>
        </span>
      </RouterLink>
      <div class="header-title">
        <strong>数据工作台</strong>
        <span>/</span>
        <em>{{ activeHeaderLabel }}</em>
      </div>
      <nav class="entry-nav" aria-label="数据录入导航">
        <RouterLink to="/">首页</RouterLink>
        <RouterLink to="/map-visualization">地图可视化</RouterLink>
      </nav>
      <div class="operator-chip">
        <span>{{ currentUser?.username }}</span>
        <strong>{{ currentUser ? roleLabel(currentUser.role) : '未登录' }}</strong>
      </div>
      <button class="logout-button" type="button" @click="handleLogout">退出</button>
    </header>

    <section class="workspace-layout">
      <aside class="workspace-nav" aria-label="数据工作台模块">
        <button
          v-for="section in workspaceSections"
          :key="section.key"
          type="button"
          :class="[{ active: activeSection === section.key }, `section-${section.key}`]"
          @click="setActiveSection(section.key)"
        >
          <strong>{{ section.title }}</strong>
          <span>{{ section.caption }}</span>
        </button>
      </aside>

      <div class="workspace-main">
        <p v-if="message" class="page-message" :class="messageType">{{ message }}</p>

        <section v-if="activeSection === 'upload' && canUploadData" class="workspace-panel" aria-label="上传录入">
          <header class="section-head">
            <h2>上传文件</h2>
            <p>下载模板或按 WBE 汇总表整理字段，上传后完成字段识别、校验摘要和前 20 行预览。</p>
          </header>

          <div class="import-grid" aria-label="上传与校验">
            <div class="upload-panel">
              <header class="panel-head">
                <div>
                  <span>STEP 1</span>
                  <h3>上传并校验</h3>
                </div>
                <button type="button" class="secondary-action" @click="handleDownloadTemplate">
                  下载模板
                </button>
              </header>
              <label
                class="drop-zone"
                :class="{ dragging: isDragging }"
                @dragover.prevent="isDragging = true"
                @dragleave.prevent="isDragging = false"
                @drop.prevent="handleDrop"
              >
                <input type="file" accept=".xlsx" @change="handleFileChange" />
                <strong>{{ selectedFileLabel }}</strong>
                <span>.xlsx / 数据表 / 58 个规范字段</span>
              </label>
              <button type="button" class="primary-action" :disabled="isUploading" @click="handlePreview">
                {{ isUploading ? '正在解析' : '开始校验' }}
              </button>
            </div>

            <div class="summary-panel">
              <header>
                <span>STEP 2</span>
                <h3>校验摘要</h3>
              </header>
              <div v-if="preview" class="summary-metrics">
                <article>
                  <span>总行数</span>
                  <strong>{{ preview.batch.totalRows }}</strong>
                </article>
                <article>
                  <span>可入库</span>
                  <strong>{{ preview.batch.validRows }}</strong>
                </article>
                <article>
                  <span>错误</span>
                  <strong>{{ preview.batch.errorRows }}</strong>
                </article>
                <article>
                  <span>警告</span>
                  <strong>{{ preview.batch.warningRows }}</strong>
                </article>
              </div>
              <p v-else class="empty-state">上传文件后会显示字段识别、错误和警告摘要。</p>
              <div v-if="previewBlockingMessage" class="issue-list blocker">
                <strong>不能同步</strong>
                <p>{{ previewBlockingMessage }}</p>
              </div>
              <div v-if="visibleHeaderErrors.length" class="issue-list error">
                <strong>表头错误</strong>
                <p v-for="item in visibleHeaderErrors" :key="item">{{ item }}</p>
                <p v-if="hiddenHeaderErrorCount" class="issue-more">还有 {{ hiddenHeaderErrorCount }} 条表头错误未展开。</p>
              </div>
              <div v-if="visibleBatchWarnings.length" class="issue-list warning">
                <strong>批次提示</strong>
                <p v-for="item in visibleBatchWarnings" :key="item">{{ item }}</p>
                <p v-if="hiddenBatchWarningCount" class="issue-more">还有 {{ hiddenBatchWarningCount }} 条提示未展开。</p>
              </div>
              <p v-if="preview?.batch.status === 'PENDING_REVIEW'" class="review-note">
                该批次已进入待审核队列，需由具备审核/同步权限的人员处理。
              </p>
              <button
                v-if="preview && canSyncData"
                type="button"
                class="primary-action"
                :disabled="!canSyncPreview || isSyncing"
                @click="handlePreviewSync"
              >
                {{ preview.batch.status === 'PENDING_REVIEW' ? '通过并同步' : '同步入库' }}
              </button>
            </div>
          </div>

          <div class="requirements-band" aria-label="上传要求">
            <div class="requirements-copy">
              <span>上传要求</span>
              <h3>文件必须匹配 WBE 汇总表格式。</h3>
              <p>
                仅支持 .xlsx 文件；必须包含名为“数据表”的工作表；前 58 列需与 WBE 汇总表字段完全一致。
                普通用户开放上传后，校验通过的批次会进入待审核队列。
              </p>
              <div class="template-actions">
                <button type="button" @click="handleDownloadTemplate">下载 Excel 模板</button>
                <small>模板包含“数据表 / 字段说明 / 上传说明”三个工作表。</small>
              </div>
            </div>
            <div class="requirements-grid">
              <article v-for="group in FIELD_GROUPS" :key="group.title">
                <strong>{{ group.title }}</strong>
                <p>{{ group.fields }}</p>
              </article>
            </div>
          </div>

          <section v-if="preview" class="preview-section" aria-label="上传预览">
            <header class="section-head compact">
              <span>PREVIEW</span>
              <h3>前 {{ preview.previewRows.length }} 行预览</h3>
            </header>
            <p v-if="!preview.previewRows.length" class="empty-state">
              当前批次没有可预览行；通常是工作表缺失、表头不匹配或文件解析失败，请按模板修正后重新上传。
            </p>
            <div v-else class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>行号</th>
                    <th>状态</th>
                    <th v-for="column in PREVIEW_COLUMNS" :key="column">{{ column }}</th>
                    <th>问题</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in preview.previewRows" :key="row.rowId">
                    <td>{{ row.excelRowNumber }}</td>
                    <td>
                      <span class="status-pill" :class="row.status.toLowerCase()">
                        {{ statusLabel(row.status) }}
                      </span>
                    </td>
                    <td v-for="column in PREVIEW_COLUMNS" :key="column">{{ row.data[column] || 'NA' }}</td>
                    <td>
                      <span v-if="row.errors.length">{{ row.errors.join('；') }}</span>
                      <span v-else-if="row.warnings.length">{{ row.warnings.join('；') }}</span>
                      <span v-else>通过</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <section v-if="activeSection === 'batches' && canSeeBatchModule" class="workspace-panel" aria-label="上传批次">
          <div class="module-toolbar compact-toolbar">
            <header class="section-head">
              <h2>上传记录</h2>
              <p>按时间倒序查看上传记录。审核者可看全部批次，普通上传者只看自己的批次。</p>
            </header>
            <div class="list-toolbar batch-toolbar" aria-label="批次筛选">
              <label>
                <span>搜索</span>
                <input v-model.trim="batchFilters.keyword" type="search" placeholder="文件名 / 上传人 / 状态" />
              </label>
              <label>
                <span>状态</span>
                <select v-model="batchFilters.status">
                  <option v-for="item in BATCH_STATUS_FILTERS" :key="item.value" :value="item.value">
                    {{ item.label }}
                  </option>
                </select>
              </label>
              <label>
                <span>范围</span>
                <select v-model="batchFilters.scope">
                  <option v-for="item in BATCH_SCOPE_FILTERS" :key="item.value" :value="item.value">
                    {{ item.label }}
                  </option>
                </select>
              </label>
              <label>
                <span>上传人</span>
                <select v-model="batchFilters.uploaderType">
                  <option v-for="item in BATCH_UPLOADER_FILTERS" :key="item.value" :value="item.value">
                    {{ item.label }}
                  </option>
                </select>
              </label>
              <button type="button" @click="applyBatchFilters">查询</button>
              <button type="button" class="secondary-action compact" @click="loadBatches">刷新</button>
            </div>
          </div>

          <p v-if="isLoadingBatches" class="empty-state">正在加载上传批次。</p>
          <p v-else-if="!batchPage.items.length" class="empty-state">没有匹配的上传批次。</p>
          <div v-else class="table-scroll batch-table">
            <table class="batch-list-table">
              <thead>
                <tr>
                  <th>状态</th>
                  <th>文件</th>
                  <th>上传人</th>
                  <th>行数 / 问题</th>
                  <th>上传时间</th>
                  <th>审核 / 同步</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="batch in batchPage.items" :key="batch.uploadId">
                  <td>
                    <span class="status-pill" :class="batch.status.toLowerCase()">
                      {{ statusLabel(batch.status) }}
                    </span>
                  </td>
                  <td class="batch-file-cell">
                    <strong>{{ batch.fileName }}</strong>
                    <span v-if="batch.duplicateMessage">{{ batch.duplicateMessage }}</span>
                  </td>
                  <td>
                    <strong>{{ batch.uploadedByName }}</strong>
                    <span class="muted">{{ uploadSourceLabel(batch) }} / {{ uploadRoleLabel(batch.uploadedByRole) }}</span>
                  </td>
                  <td class="batch-counts">
                    <span>{{ batch.totalRows }} 行</span>
                    <span>错 {{ batch.errorRows }}</span>
                    <span>警 {{ batch.warningRows }}</span>
                    <span>入库 {{ batch.syncedRows }}</span>
                  </td>
                  <td>{{ formatDate(batch.createdAt) }}</td>
                  <td>
                    <span class="audit-line">审：{{ batch.reviewedByName || '-' }} / {{ formatMaybeDate(batch.reviewedAt) }}</span>
                    <span class="audit-line">同：{{ batch.syncedByName || '-' }} / {{ formatMaybeDate(batch.syncedAt) }}</span>
                  </td>
                  <td>
                    <div class="row-actions compact-actions">
                      <button type="button" @click="loadRows(batch)">
                        {{ batch.status === 'PENDING_REVIEW' ? '查看/审核' : '查看' }}
                      </button>
                      <button type="button" :disabled="!currentUserCanDownload" @click="downloadBatch(batch)">下载</button>
                      <button v-if="canApproveAndSync(batch)" type="button" @click="handleBatchSync(batch)">
                        {{ batch.status === 'PENDING_REVIEW' ? '通过同步' : '同步' }}
                      </button>
                      <button
                        v-if="canReviewUploads && batch.status === 'PENDING_REVIEW'"
                        type="button"
                        class="danger-action"
                        @click="loadRows(batch)"
                      >
                        审核
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="pagination-bar" aria-label="批次分页">
            <span>共 {{ batchPage.total }} 条</span>
            <label>
              每页
              <select :value="batchPage.size" @change="changeBatchPageSize">
                <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }}</option>
              </select>
            </label>
            <button type="button" :disabled="batchPage.page <= 1" @click="loadBatchPage(batchPage.page - 1)">
              上一页
            </button>
            <strong>第 {{ batchPage.page }} / {{ Math.max(batchPage.totalPages, 1) }} 页</strong>
            <button
              type="button"
              :disabled="batchPage.totalPages === 0 || batchPage.page >= batchPage.totalPages"
              @click="loadBatchPage(batchPage.page + 1)"
            >
              下一页
            </button>
          </div>

          <Transition name="drawer-fade">
            <div v-if="selectedBatch" class="batch-drawer-shell" role="dialog" aria-modal="true">
              <button class="drawer-scrim" type="button" aria-label="关闭批次详情" @click="closeBatchDrawer"></button>
              <aside class="batch-detail-drawer">
                <header class="drawer-head">
                  <div>
                    <span>{{ statusLabel(selectedBatch.status) }}</span>
                    <h3>{{ selectedBatch.fileName }}</h3>
                    <p>{{ selectedBatch.uploadedByName }} / {{ uploadRoleLabel(selectedBatch.uploadedByRole) }}</p>
                  </div>
                  <button type="button" class="ghost-button" @click="closeBatchDrawer">关闭</button>
                </header>

                <div class="drawer-metrics">
                  <article>
                    <span>总行</span>
                    <strong>{{ selectedBatch.totalRows }}</strong>
                  </article>
                  <article>
                    <span>错误</span>
                    <strong>{{ selectedBatch.errorRows }}</strong>
                  </article>
                  <article>
                    <span>警告</span>
                    <strong>{{ selectedBatch.warningRows }}</strong>
                  </article>
                  <article>
                    <span>已入库</span>
                    <strong>{{ selectedBatch.syncedRows }}</strong>
                  </article>
                </div>

                <div class="drawer-audit">
                  <p>上传时间：{{ formatDate(selectedBatch.createdAt) }}</p>
                  <p>审核人：{{ selectedBatch.reviewedByName || '-' }} / {{ formatMaybeDate(selectedBatch.reviewedAt) }}</p>
                  <p>同步人：{{ selectedBatch.syncedByName || '-' }} / {{ formatMaybeDate(selectedBatch.syncedAt) }}</p>
                  <p v-if="selectedBatch.reviewNote">审核备注：{{ selectedBatch.reviewNote }}</p>
                </div>

                <div class="drawer-row-toolbar">
                  <label>
                    行状态
                    <select v-model="rowStatusFilter" @change="changeRowStatusFilter">
                      <option v-for="item in ROW_STATUS_FILTERS" :key="item.value" :value="item.value">
                        {{ item.label }}
                      </option>
                    </select>
                  </label>
                  <span v-if="selectedRowsPage">{{ selectedRowsPage.total }} 行</span>
                </div>

                <p v-if="isLoadingRows" class="empty-state">正在加载行数据。</p>
                <div v-else-if="selectedRowsPage" class="drawer-row-table">
                  <table>
                    <thead>
                      <tr>
                        <th>行</th>
                        <th>状态</th>
                        <th>目标物</th>
                        <th>问题</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="row in selectedRowsPage.rows" :key="row.rowId">
                        <td>{{ row.excelRowNumber }}</td>
                        <td>
                          <span class="status-pill" :class="row.status.toLowerCase()">
                            {{ statusLabel(row.status) }}
                          </span>
                        </td>
                        <td>{{ row.data['药物'] || row.data['生物标记物名称'] || row.data.biomarker || 'NA' }}</td>
                        <td>{{ [...row.errors, ...row.warnings].join('；') || '通过' }}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div class="pagination-bar drawer-pages">
                    <button
                      type="button"
                      :disabled="selectedRowsPage.page <= 1"
                      @click="selectedBatch && loadRows(selectedBatch, selectedRowsPage.page - 1)"
                    >
                      上一页
                    </button>
                    <strong>第 {{ selectedRowsPage.page }} 页</strong>
                    <button
                      type="button"
                      :disabled="selectedRowsPage.page * selectedRowsPage.size >= selectedRowsPage.total"
                      @click="selectedBatch && loadRows(selectedBatch, selectedRowsPage.page + 1)"
                    >
                      下一页
                    </button>
                  </div>
                </div>

                <footer class="drawer-actions">
                  <textarea
                    v-if="selectedBatch.status === 'PENDING_REVIEW' && canReviewUploads"
                    v-model.trim="reviewNote"
                    maxlength="500"
                    placeholder="驳回原因（可选，最多 500 字）"
                  ></textarea>
                  <div>
                    <button
                      v-if="selectedBatch.status === 'PENDING_REVIEW' && canReviewUploads"
                      type="button"
                      class="danger-action"
                      @click="handleRejectBatch(selectedBatch)"
                    >
                      驳回
                    </button>
                    <button
                      v-if="canApproveAndSync(selectedBatch)"
                      type="button"
                      class="primary-action compact"
                      :disabled="isSyncing"
                      @click="handleBatchSync(selectedBatch)"
                    >
                      {{ selectedBatch.status === 'PENDING_REVIEW' ? '通过并同步' : '同步入库' }}
                    </button>
                  </div>
                </footer>
              </aside>
            </div>
          </Transition>
        </section>

        <section v-if="activeSection === 'users' && currentUserIsAdmin" class="workspace-panel" aria-label="用户权限">
          <header class="section-head">
            <h2>账号权限</h2>
            <p>分页查看所有用户，按角色和功能筛选，支持跨页保留勾选并批量调整普通用户和管理人员权限。</p>
          </header>

          <div class="permission-filters" aria-label="用户筛选">
            <label>
              <span>搜索用户</span>
              <input v-model.trim="userFilters.keyword" type="search" placeholder="用户名 / 邮箱 / 姓名" />
            </label>
            <label>
              <span>角色</span>
              <select v-model="userFilters.role">
                <option v-for="item in ROLE_FILTERS" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </label>
            <label>
              <span>上传</span>
              <select v-model="userFilters.canUpload">
                <option v-for="item in PERMISSION_FILTERS" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </label>
            <label>
              <span>审核</span>
              <select v-model="userFilters.canReviewUploads">
                <option v-for="item in PERMISSION_FILTERS" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </label>
            <label>
              <span>同步</span>
              <select v-model="userFilters.canSyncData">
                <option v-for="item in PERMISSION_FILTERS" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </label>
            <label>
              <span>下载</span>
              <select v-model="userFilters.canDownload">
                <option v-for="item in PERMISSION_FILTERS" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </label>
            <button type="button" @click="applyUserFilters">查询</button>
          </div>

          <Transition name="selection-bar">
            <div v-if="selectedCount" class="bulk-toolbar selection-toolbar">
              <strong>已选择 {{ selectedCount }} 个用户</strong>
              <select v-model="bulkAction">
                <option value="">选择批量操作</option>
                <option v-for="item in BULK_ACTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
              <button type="button" @click="applyBulkAction">应用</button>
              <button type="button" class="ghost-action" @click="clearSelectedUsers">清空选择</button>
            </div>
          </Transition>

          <p v-if="isLoadingUsers" class="empty-state">正在加载用户列表。</p>
          <div v-else class="user-table table-scroll">
            <table class="permission-table" aria-label="用户权限列表">
              <colgroup>
                <col class="select-col" />
                <col class="user-col" />
                <col class="role-col" />
                <col class="cap-col" />
                <col class="state-col" />
                <col class="login-col" />
                <col class="action-col" />
              </colgroup>
              <thead>
                <tr>
                  <th>
                    <label class="check-cell">
                      <input
                        type="checkbox"
                        :checked="currentPageAllSelected"
                        @change="toggleCurrentPageSelection(($event.target as HTMLInputElement).checked)"
                      />
                      <span>{{ currentPageSomeSelected ? '部分' : '本页' }}</span>
                    </label>
                  </th>
                  <th>用户信息</th>
                  <th>角色</th>
                  <th>当前功能</th>
                  <th>状态</th>
                  <th>最近登录</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!userPage.items.length">
                  <td colspan="7" class="table-empty">没有匹配的用户。</td>
                </tr>
                <tr v-for="user in userPage.items" :key="user.userId" :class="{ muted: user.role === 'admin' }">
                  <td>
                    <label class="check-cell">
                      <input
                        type="checkbox"
                        :disabled="user.role === 'admin'"
                        :checked="selectedUserIds.has(user.userId)"
                        @change="toggleUserSelection(user.userId, ($event.target as HTMLInputElement).checked)"
                      />
                    </label>
                  </td>
                  <td class="user-info-cell">
                    <strong>{{ user.username }}</strong>
                    <small :title="user.email">{{ user.email }}</small>
                  </td>
                  <td>{{ roleLabel(user.role) }}</td>
                  <td>
                    <span class="capability-list">
                      <i v-for="cap in userCapabilities(user)" :key="cap">{{ cap }}</i>
                    </span>
                  </td>
                  <td>
                    <span class="account-status" :class="{ active: user.isActive }">
                      {{ user.isActive ? '启用' : '禁用' }}
                    </span>
                  </td>
                  <td>{{ formatDate(user.lastLogin) }}</td>
                  <td>
                    <span v-if="user.role === 'admin'" class="locked-action">系统保留</span>
                    <button
                      v-else
                      type="button"
                      class="table-action"
                      @click="openPermissionDrawer(user)"
                    >
                      编辑
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="pagination-bar">
            <span>共 {{ userPage.total }} 人</span>
            <label>
              每页
              <select :value="userPage.size" @change="changePageSize">
                <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }}</option>
              </select>
            </label>
            <button type="button" :disabled="userPage.page <= 1" @click="loadUsers(userPage.page - 1)">上一页</button>
            <strong>第 {{ userPage.page }} / {{ Math.max(userPage.totalPages, 1) }} 页</strong>
            <button
              type="button"
              :disabled="userPage.totalPages === 0 || userPage.page >= userPage.totalPages"
              @click="loadUsers(userPage.page + 1)"
            >
              下一页
            </button>
          </div>
        </section>
      </div>
    </section>

    <div v-if="editingUser" class="drawer-backdrop" @click.self="closePermissionDrawer">
      <aside class="permission-drawer" aria-label="编辑用户权限">
        <header>
          <span>PERMISSIONS</span>
          <h2>编辑权限</h2>
          <p>{{ editingUser.username }} / {{ editingUser.email }}</p>
        </header>
        <label>
          <span>角色</span>
          <select :value="permissionForm.role" @change="applyRoleDefaults(($event.target as HTMLSelectElement).value as UserResponse['role'])">
            <option value="editor">管理人员</option>
            <option value="viewer">普通用户</option>
          </select>
        </label>
        <div class="switch-list">
          <label>
            <input v-model="permissionForm.canUpload" type="checkbox" />
            <span>允许上传</span>
          </label>
          <label>
            <input v-model="permissionForm.canReviewUploads" type="checkbox" />
            <span>允许审核上传批次</span>
          </label>
          <label>
            <input v-model="permissionForm.canSyncData" type="checkbox" />
            <span>允许同步入库</span>
          </label>
          <label>
            <input v-model="permissionForm.canDownload" type="checkbox" />
            <span>允许下载原文件</span>
          </label>
        </div>
        <footer>
          <button type="button" class="ghost-action" @click="closePermissionDrawer">取消</button>
          <button type="button" class="primary-action" :disabled="isSavingUser" @click="savePermissionDrawer">
            {{ isSavingUser ? '保存中' : '保存权限' }}
          </button>
        </footer>
      </aside>
    </div>
  </main>
</template>

<style scoped>
:global(*) {
  box-sizing: border-box;
}

:global(body) {
  margin: 0;
  min-width: 320px;
  background: #f4f7f8;
  color: #182d35;
  font-family:
    Inter, 'PingFang SC', 'Microsoft YaHei', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
}

.entry-shell {
  --entry-header-height: 76px;
  min-height: 100vh;
}

.entry-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: grid;
  min-height: var(--entry-header-height);
  grid-template-columns: minmax(220px, 1fr) minmax(180px, auto) auto auto auto;
  gap: 18px;
  align-items: center;
  padding: 12px clamp(18px, 3vw, 42px);
  border-bottom: 1px solid #d8e2e5;
  background: rgba(250, 252, 252, 0.94);
  backdrop-filter: blur(16px);
}

.brand {
  display: inline-flex;
  gap: 12px;
  align-items: center;
  color: inherit;
  text-decoration: none;
}

.brand-logo {
  position: relative;
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 8px;
  background: #0f4f5c;
  overflow: hidden;
}

.brand-drop {
  width: 16px;
  height: 22px;
  border-radius: 14px 14px 14px 4px;
  background: #b8e4e0;
  transform: rotate(42deg);
}

.brand-bars,
.brand-line {
  position: absolute;
  inset: 0;
}

.brand-bars i {
  position: absolute;
  bottom: 8px;
  width: 3px;
  background: #ffffff;
  border-radius: 999px;
}

.brand-bars i:nth-child(1) {
  left: 9px;
  height: 10px;
}

.brand-bars i:nth-child(2) {
  left: 15px;
  height: 15px;
}

.brand-bars i:nth-child(3) {
  left: 21px;
  height: 8px;
}

.brand-line i {
  position: absolute;
  right: 7px;
  width: 9px;
  height: 2px;
  background: #ffffff;
}

.brand-line i:first-child {
  top: 12px;
}

.brand-line i:last-child {
  top: 18px;
}

.brand strong,
.brand small {
  display: block;
}

.brand strong {
  font-size: 15px;
}

.header-title {
  display: inline-flex;
  min-width: 0;
  align-items: baseline;
  justify-content: center;
  gap: 8px;
  padding: 0 4px;
  color: #526a72;
  white-space: nowrap;
}

.header-title strong,
.header-title em {
  color: #173247;
  font-style: normal;
  font-weight: 900;
  line-height: 1.2;
}

.header-title strong {
  font-size: 18px;
}

.header-title em {
  color: #34525b;
  font-size: 16px;
}

.header-title span {
  color: #8aa0a7;
  font-size: 15px;
  font-weight: 800;
}

.brand small,
.operator-chip span {
  color: #61737a;
  font-size: 11px;
}

.entry-nav,
.operator-chip {
  display: inline-flex;
  gap: 10px;
  align-items: center;
}

.entry-nav a {
  color: #34525b;
  font-size: 14px;
  text-decoration: none;
}

.operator-chip {
  padding: 8px 10px;
  border: 1px solid #cad8dc;
  border-radius: 8px;
  background: #ffffff;
}

.operator-chip strong {
  font-size: 12px;
}

.logout-button,
.ghost-action {
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid #cad8dc;
  border-radius: 8px;
  color: #173247;
  background: #ffffff;
  cursor: pointer;
  font-weight: 800;
  white-space: nowrap;
}

.workspace-layout,
.page-message {
  width: 100%;
  margin-left: 0;
  margin-right: auto;
}

.section-head span,
.requirements-copy span,
.upload-panel header span,
.summary-panel header span,
.permission-drawer header span {
  margin: 0 0 8px;
  color: #53727a;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0;
}

.section-head h2,
.section-head h3,
.requirements-copy h3,
.upload-panel h3,
.summary-panel h3,
.permission-drawer h2 {
  margin: 0;
  letter-spacing: 0;
}

.section-head h2 {
  color: #173247;
  font-size: 26px;
  line-height: 1.18;
}

.section-head p,
.requirements-copy p,
.review-note,
.permission-drawer p {
  margin: 0;
  color: #5e747b;
  font-size: 14px;
  line-height: 1.55;
}

.page-message {
  width: min(1280px, calc(100% - 48px));
  margin: 16px auto 0;
  padding: 12px 14px;
  border-radius: 8px;
  font-size: 14px;
}

.page-message.success {
  border: 1px solid #b8d9ca;
  background: #eef8f2;
  color: #276142;
}

.page-message.error {
  border: 1px solid #efc5c0;
  background: #fff2f0;
  color: #9f3428;
}

.workspace-layout {
  display: grid;
  min-height: calc(100vh - var(--entry-header-height));
  grid-template-columns: 196px minmax(0, 1fr);
  gap: 0;
  padding-bottom: 0;
}

.workspace-main {
  min-width: 0;
}

.workspace-nav {
  position: sticky;
  top: var(--entry-header-height);
  display: grid;
  min-height: calc(100vh - var(--entry-header-height));
  align-self: start;
  align-content: start;
  gap: 8px;
  padding: 18px 12px;
  border-right: 1px solid #d5e1e4;
  background: #f8fbfb;
}

.workspace-nav button {
  position: relative;
  display: grid;
  gap: 3px;
  min-height: 52px;
  width: 100%;
  padding: 9px 10px 9px 16px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #48626a;
  cursor: pointer;
  text-align: left;
  transition:
    background-color 160ms ease,
    color 160ms ease,
    transform 160ms ease;
}

.workspace-nav button.active {
  background: var(--section-bg, #eaf5f5);
  color: var(--section-color, #0f4f5c);
}

.workspace-nav button:hover {
  transform: translateX(1px);
  background: var(--section-bg, #f4f8f9);
}

.workspace-nav button.active::before {
  position: absolute;
  top: 9px;
  bottom: 9px;
  left: 5px;
  width: 3px;
  border-radius: 999px;
  background: var(--section-color, #0f4f5c);
  content: '';
}

.workspace-nav button.section-upload {
  --section-color: #0f6b7c;
  --section-bg: #e6f4f6;
}

.workspace-nav button.section-batches {
  --section-color: #946118;
  --section-bg: #fff4dc;
}

.workspace-nav button.section-users {
  --section-color: #315f68;
  --section-bg: #e8f1f3;
}

.workspace-nav strong {
  font-size: 14px;
}

.workspace-nav span {
  font-size: 11px;
}

.workspace-panel {
  display: grid;
  gap: 14px;
  width: min(1280px, calc(100% - 48px));
  margin: 22px auto 36px;
  animation: panel-enter 180ms ease;
}

.section-head {
  display: grid;
  justify-items: start;
  gap: 6px;
  max-width: 820px;
}

.section-head.compact {
  margin-top: 8px;
}

.requirements-band,
.import-grid {
  display: grid;
  grid-template-columns: minmax(240px, 0.9fr) minmax(0, 1.1fr);
  gap: 12px;
}

.requirements-band {
  padding: 14px;
  border: 1px solid #d8e2e5;
  border-radius: 8px;
  background: #f8fbfb;
}

.requirements-grid,
.summary-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.summary-metrics {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 10px 0;
}

.requirements-grid article,
.upload-panel,
.summary-panel,
.history-list article,
.rows-drawer,
.user-table {
  border: 1px solid #d5e1e4;
  border-radius: 8px;
  background: #ffffff;
}

.requirements-grid article,
.upload-panel,
.summary-panel,
.rows-drawer {
  padding: 14px;
}

.requirements-grid p,
.history-list p,
.compact-rows p {
  margin: 0;
  color: #647981;
  font-size: 13px;
  line-height: 1.6;
}

.template-actions,
.panel-head,
.row-actions,
.bulk-toolbar,
.pagination-bar,
.permission-drawer footer {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.template-actions small {
  color: #61747b;
}

.primary-action,
.secondary-action,
.template-actions button,
.list-toolbar button,
.permission-filters button,
.bulk-toolbar button,
.pagination-bar button,
.row-actions button,
.table-action {
  min-height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: #0f4f5c;
  color: #ffffff;
  cursor: pointer;
  font-weight: 800;
  font-size: 13px;
  white-space: nowrap;
  transition:
    background-color 160ms ease,
    border-color 160ms ease,
    color 160ms ease,
    transform 160ms ease,
    box-shadow 160ms ease;
}

.secondary-action,
.table-action {
  border: 1px solid #c9d8dc;
  background: #ffffff;
  color: #173247;
}

.danger-action {
  background: #a83d31 !important;
}

.primary-action:hover:not(:disabled),
.secondary-action:hover:not(:disabled),
.template-actions button:hover:not(:disabled),
.list-toolbar button:hover:not(:disabled),
.permission-filters button:hover:not(:disabled),
.bulk-toolbar button:hover:not(:disabled),
.pagination-bar button:hover:not(:disabled),
.row-actions button:hover:not(:disabled),
.table-action:hover:not(:disabled),
.logout-button:hover:not(:disabled),
.ghost-action:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 18px rgba(15, 79, 92, 0.12);
}

button:disabled {
  background: #9fb2b8 !important;
  cursor: not-allowed;
}

.primary-action {
  width: 100%;
}

.primary-action.compact,
.secondary-action.compact {
  width: auto;
}

.panel-head {
  justify-content: space-between;
  align-items: flex-start;
}

.drop-zone {
  display: grid;
  min-height: 118px;
  margin: 12px 0;
  place-items: center;
  border: 1px dashed #8eb2bc;
  border-radius: 8px;
  background: #f6fbfb;
  color: #48626a;
  cursor: pointer;
  text-align: center;
}

.drop-zone.dragging {
  border-color: #0f6b7c;
  background: #eaf7f7;
}

.drop-zone input {
  display: none;
}

.drop-zone strong {
  max-width: 90%;
  overflow-wrap: anywhere;
}

.drop-zone span,
.summary-metrics span,
.history-list article > div:first-child span,
.compact-rows span,
.compact-rows em,
.user-info-cell small {
  color: #657980;
  font-size: 12px;
}

.summary-metrics article {
  padding: 10px;
  border-radius: 6px;
  background: #eef4f5;
}

.summary-metrics span,
.summary-metrics strong,
.history-list article > div:first-child strong,
.history-list article > div:first-child span,
.user-info-cell strong,
.user-info-cell small {
  display: block;
}

.summary-metrics strong {
  margin-top: 4px;
  font-size: 20px;
}

.issue-list {
  margin: 8px 0;
  padding: 10px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
}

.issue-list p {
  margin: 4px 0 0;
}

.issue-list.blocker {
  border: 1px solid #efc5c0;
  background: #fff2f0;
  color: #8e2f26;
}

.issue-list.error {
  background: #fff2f0;
  color: #9f3428;
}

.issue-list.warning {
  background: #fff8e6;
  color: #855b11;
}

.issue-more {
  color: inherit;
  opacity: 0.72;
  font-weight: 800;
}

.empty-state {
  color: #687d84;
}

.table-scroll {
  overflow-x: auto;
  border: 1px solid #d5e1e4;
  border-radius: 8px;
  background: #ffffff;
}

table {
  width: 100%;
  min-width: 980px;
  border-collapse: collapse;
}

th,
td {
  padding: 10px 12px;
  border-bottom: 1px solid #e3ecef;
  text-align: left;
  vertical-align: top;
  font-size: 13px;
}

th {
  color: #49646d;
  background: #eef4f5;
  white-space: nowrap;
}

td {
  max-width: 260px;
  overflow-wrap: anywhere;
}

.status-pill {
  display: inline-flex;
  min-width: 64px;
  justify-content: center;
  padding: 4px 8px;
  border-radius: 999px;
  background: #e9f0f2;
  color: #3f5c65;
  font-size: 12px;
  font-weight: 800;
}

.status-pill.previewed,
.status-pill.valid,
.status-pill.synced {
  background: #e5f4ed;
  color: #286344;
}

.status-pill.pending_review,
.status-pill.warning,
.status-pill.skipped {
  background: #fff4d8;
  color: #835d10;
}

.status-pill.validation_failed,
.status-pill.error,
.status-pill.sync_failed,
.status-pill.rejected {
  background: #fff0ee;
  color: #9d3327;
}

.list-toolbar,
.permission-filters {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(180px, 220px) auto;
  gap: 8px;
  align-items: end;
}

.permission-filters {
  grid-template-columns: minmax(210px, 1.2fr) repeat(5, minmax(96px, 0.7fr)) auto;
  padding: 10px;
  border: 1px solid #d5e1e4;
  border-radius: 8px;
  background: #ffffff;
}

.list-toolbar label,
.permission-filters label,
.permission-drawer label {
  display: grid;
  gap: 6px;
}

.list-toolbar label span,
.permission-filters label span,
.permission-drawer label span {
  color: #526a72;
  font-size: 12px;
  font-weight: 800;
}

.list-toolbar input,
.list-toolbar select,
.permission-filters input,
.permission-filters select,
.bulk-toolbar select,
.pagination-bar select,
.permission-drawer select {
  min-height: 34px;
  width: 100%;
  border: 1px solid #c9d8dc;
  border-radius: 6px;
  background: #ffffff;
  color: #173247;
  padding: 0 10px;
}

.module-toolbar {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(420px, 1.4fr);
  gap: 12px;
  align-items: end;
}

.compact-toolbar {
  grid-template-columns: minmax(260px, 0.9fr) minmax(560px, 1.6fr);
}

.batch-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.batch-toolbar label {
  flex: 1 1 128px;
  min-width: 120px;
}

.batch-toolbar label:first-child {
  flex-basis: 220px;
}

.batch-toolbar button {
  flex: 0 0 auto;
}

tbody tr {
  transition:
    background-color 140ms ease,
    box-shadow 140ms ease;
}

tbody tr:hover {
  background: #f7fbfb;
}

.batch-table table {
  min-width: 1120px;
}

.batch-list-table th,
.batch-list-table td {
  vertical-align: middle;
}

.batch-file-cell strong,
.batch-file-cell span,
.muted,
.audit-line {
  display: block;
}

.batch-file-cell strong {
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.batch-file-cell span,
.muted,
.audit-line {
  color: #647981;
  font-size: 12px;
}

.batch-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.batch-counts span {
  padding: 2px 6px;
  border-radius: 999px;
  background: #edf3f4;
  color: #47656e;
  font-size: 11px;
  font-weight: 800;
}

.compact-actions {
  flex-wrap: nowrap;
  gap: 6px;
}

.compact-actions button {
  min-height: 28px;
  padding: 0 9px;
  font-size: 12px;
}

.history-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.history-list article {
  display: grid;
  gap: 8px;
  padding: 12px;
}

.rows-drawer header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
}

.compact-rows {
  display: grid;
  gap: 8px;
}

.compact-rows article {
  display: grid;
  grid-template-columns: 90px minmax(100px, 1fr) 70px minmax(180px, 1.5fr);
  gap: 10px;
  align-items: start;
  padding: 10px;
  border-radius: 8px;
  background: #f5f8f9;
}

.bulk-toolbar {
  justify-content: flex-start;
  padding: 10px;
  border: 1px solid #bed4d9;
  border-radius: 8px;
  background: #edf7f7;
}

.selection-toolbar {
  min-height: 42px;
  margin-top: -2px;
  padding: 7px 10px;
  border-color: #b9d4d8;
  background: #f0f8f8;
}

.selection-bar-enter-active,
.selection-bar-leave-active {
  overflow: hidden;
  transition:
    opacity 160ms ease,
    transform 160ms ease,
    max-height 160ms ease,
    margin 160ms ease,
    padding 160ms ease;
}

.selection-bar-enter-from,
.selection-bar-leave-to {
  max-height: 0;
  margin-top: -8px;
  padding-top: 0;
  padding-bottom: 0;
  opacity: 0;
  transform: translateY(-6px);
}

.selection-bar-enter-to,
.selection-bar-leave-from {
  max-height: 56px;
  opacity: 1;
  transform: translateY(0);
}

.bulk-toolbar select {
  width: min(240px, 100%);
}

.user-table {
  overflow-x: auto;
}

.permission-table {
  min-width: 900px;
  table-layout: fixed;
}

.permission-table th {
  position: sticky;
  top: 0;
  z-index: 1;
}

.permission-table th,
.permission-table td {
  height: 50px;
  padding: 8px 10px;
  vertical-align: middle;
  white-space: nowrap;
}

.permission-table th:nth-child(1),
.permission-table td:nth-child(1),
.permission-table th:nth-child(3),
.permission-table td:nth-child(3),
.permission-table th:nth-child(5),
.permission-table td:nth-child(5),
.permission-table th:nth-child(6),
.permission-table td:nth-child(6),
.permission-table th:nth-child(7),
.permission-table td:nth-child(7) {
  text-align: center;
}

.permission-table .select-col {
  width: 78px;
}

.permission-table .user-col {
  width: 210px;
}

.permission-table .role-col {
  width: 96px;
}

.permission-table .cap-col {
  width: 240px;
}

.permission-table .state-col {
  width: 78px;
}

.permission-table .login-col {
  width: 140px;
}

.permission-table .action-col {
  width: 96px;
}

.permission-table tr.muted {
  background: #fbfcfc;
}

.check-cell {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
}

.user-info-cell strong,
.user-info-cell small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}

.capability-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.capability-list i {
  padding: 2px 6px;
  border-radius: 999px;
  background: #edf3f4;
  color: #426069;
  font-size: 11px;
  font-style: normal;
  font-weight: 800;
}

.account-status {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 999px;
  background: #edf3f4;
  color: #536d75;
  font-size: 12px;
  font-weight: 800;
}

.account-status.active {
  background: #e5f4ed;
  color: #286344;
}

.locked-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  background: #edf3f4;
  color: #5b737b;
  font-size: 12px;
  font-weight: 800;
}

.table-empty {
  padding: 18px !important;
  color: #687d84;
  text-align: center;
}

.pagination-bar {
  justify-content: flex-end;
}

.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  justify-content: flex-end;
  background: rgba(18, 38, 45, 0.28);
}

.permission-drawer {
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  gap: 16px;
  width: min(380px, 100%);
  height: 100%;
  padding: 22px;
  background: #ffffff;
  box-shadow: -20px 0 42px rgba(21, 50, 58, 0.16);
}

.switch-list {
  display: grid;
  align-content: start;
  gap: 12px;
}

.switch-list label {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid #d5e1e4;
  border-radius: 6px;
}

.batch-drawer-shell,
.drawer-backdrop {
  animation: fade-in 160ms ease;
}

.drawer-scrim {
  position: fixed;
  inset: 0;
  z-index: 44;
  border: 0;
  background: rgba(18, 38, 45, 0.28);
  cursor: pointer;
}

.batch-detail-drawer {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 45;
  display: grid;
  grid-template-rows: auto auto auto auto minmax(0, 1fr) auto;
  gap: 12px;
  width: min(720px, 100%);
  height: 100%;
  padding: 18px;
  background: #ffffff;
  box-shadow: -22px 0 42px rgba(21, 50, 58, 0.18);
  animation: drawer-slide 180ms ease;
}

.drawer-head,
.drawer-row-toolbar,
.drawer-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}

.drawer-head h3 {
  max-width: 520px;
  margin: 3px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-head span {
  color: #53727a;
  font-size: 12px;
  font-weight: 800;
}

.ghost-button {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid #c9d8dc;
  border-radius: 6px;
  background: #ffffff;
  color: #173247;
  cursor: pointer;
  font-weight: 800;
}

.drawer-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.drawer-metrics article,
.drawer-audit,
.drawer-row-toolbar {
  padding: 10px;
  border: 1px solid #d8e2e5;
  border-radius: 8px;
  background: #f8fbfb;
}

.drawer-metrics span,
.drawer-metrics strong {
  display: block;
}

.drawer-metrics span,
.drawer-audit p {
  color: #607780;
  font-size: 12px;
}

.drawer-metrics strong {
  margin-top: 4px;
  font-size: 20px;
}

.drawer-audit {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 12px;
}

.drawer-audit p {
  margin: 0;
}

.drawer-row-toolbar label {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  color: #526a72;
  font-size: 12px;
  font-weight: 800;
}

.drawer-row-toolbar select,
.drawer-actions textarea {
  border: 1px solid #c9d8dc;
  border-radius: 6px;
  background: #ffffff;
  color: #173247;
}

.drawer-row-toolbar select {
  min-height: 32px;
  padding: 0 8px;
}

.drawer-row-table {
  min-height: 0;
  overflow: auto;
  border: 1px solid #d8e2e5;
  border-radius: 8px;
}

.drawer-row-table table {
  min-width: 640px;
}

.drawer-pages {
  position: sticky;
  bottom: 0;
  padding: 8px;
  border-top: 1px solid #d8e2e5;
  background: #ffffff;
}

.drawer-actions {
  align-items: flex-end;
  padding-top: 10px;
  border-top: 1px solid #d8e2e5;
}

.drawer-actions textarea {
  min-height: 64px;
  flex: 1;
  resize: vertical;
  padding: 8px 10px;
}

.drawer-actions > div {
  display: flex;
  gap: 8px;
}

.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity 160ms ease;
}

.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}

.permission-drawer {
  animation: drawer-slide 180ms ease;
}

@keyframes panel-enter {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes drawer-slide {
  from {
    transform: translateX(18px);
  }
  to {
    transform: translateX(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 1ms !important;
    scroll-behavior: auto !important;
    transition-duration: 1ms !important;
  }
}

@media (max-width: 980px) {
  .workspace-layout,
  .page-message {
    width: min(100% - 28px, 100%);
    margin-left: auto;
    margin-right: auto;
  }

  .entry-shell {
    --entry-header-height: auto;
  }

  .entry-header,
  .workspace-layout,
  .requirements-band,
  .import-grid,
  .history-list,
  .list-toolbar,
  .permission-filters,
  .module-toolbar,
  .compact-toolbar,
  .batch-toolbar {
    grid-template-columns: 1fr;
  }

  .entry-header {
    position: sticky;
    gap: 12px;
  }

  .header-title small {
    white-space: normal;
  }

  .workspace-layout {
    min-height: auto;
    padding: 14px 0 28px;
  }

  .workspace-nav {
    position: static;
    display: flex;
    overflow-x: auto;
    padding: 0;
    border: 0;
    background: transparent;
    min-height: auto;
  }

  .workspace-nav button {
    min-width: 150px;
    background: #ffffff;
  }

  .workspace-panel {
    width: 100%;
    margin: 14px 0 0;
  }

  .summary-metrics,
  .requirements-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .batch-detail-drawer {
    width: min(100%, 560px);
  }

  .drawer-audit {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .entry-nav,
  .operator-chip,
  .summary-metrics,
  .requirements-grid {
    grid-template-columns: 1fr;
    flex-wrap: wrap;
  }

  .compact-rows article {
    grid-template-columns: 1fr;
  }

  .drawer-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .drawer-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .drawer-actions > div {
    justify-content: flex-end;
  }
}
</style>
