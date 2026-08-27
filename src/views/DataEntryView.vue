<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import PlatformHeader from '../components/PlatformHeader.vue'
import {
  bulkUpdateUserPermissions,
  fetchUsers,
  updateUserPermissions,
  type AdminUserPage,
  type BulkUserPermissionPayload,
  type UserPermissionPayload,
} from '../services/admin'
import { fetchCurrentUser, logout as requestLogout, type UserResponse } from '../services/auth'
import {
  downloadReviewDraft,
  downloadReviewPackageFile,
  downloadUploadFile,
  downloadUploadTemplate,
  fetchUploadBatch,
  fetchReviewPackages,
  fetchUploadRows,
  fetchUploads,
  publishUpload,
  returnUpload,
  uploadPreview,
  uploadReviewPackage,
  uploadSubmissionRevision,
  type DataUploadBatch,
  type DataUploadBatchPage,
  type DataUploadPreview,
  type DataUploadReviewPackage,
  type DataUploadRowsPage,
} from '../services/dataUploads'
import { clearSession, getStoredSession, isAdmin, updateStoredUser } from '../services/session'
import { getUserErrorMessage } from '../services/errors'

type WorkspaceSection = 'upload' | 'batches' | 'users'
type PermissionFilter = 'all' | 'true' | 'false'
type BatchStatusFilter =
  | 'all'
  | 'PENDING_REVIEW'
  | 'REVISION_REQUIRED'
  | 'READY_TO_PUBLISH'
  | 'PUBLISHING'
  | 'PUBLISH_FAILED'
  | 'VALIDATION_FAILED'
  | 'PUBLISHED'
type BatchScopeFilter = 'all' | 'mine' | 'pendingReview' | 'approved'
type BatchUploaderTypeFilter = 'all' | 'viewer' | 'manager'
type RowStatusFilter = 'all' | 'ERROR' | 'WARNING' | 'VALID' | 'SYNCED' | 'SKIPPED'
type RowViewFilter = 'submission' | 'reviewPackage'

const PREVIEW_COLUMNS: Record<string, string[]> = {
  原始数据: ['投稿行ID', '投稿类型', 'DOI', '文献标题', '来源记录编号', '生物标记物名称原文', '指标类型', '原始数值', '原始单位'],
}

const FIELD_GROUPS = [
  { title: '文献来源', fields: '投稿类型、DOI或已有文献编号、标题、年份、期刊/来源、来源文件名或URL' },
  { title: '原始事实', fields: '来源记录编号、标记物原文、采样与分析方法、点位、采样时间' },
  { title: '指标数值', fields: '指标类型、统计量、原始数值和单位；保留ND、<LOD、<LOQ等原文' },
  { title: '证据追踪', fields: '数值来源、计算换算说明、页码/表号/Sheet/图号和原文证据' },
]

const STATUS_LABELS: Record<string, string> = {
  PENDING_REVIEW: '待审核',
  REVISION_REQUIRED: '退回修改',
  READY_TO_PUBLISH: '待确认入库',
  PUBLISHING: '入库中',
  PUBLISH_FAILED: '入库失败',
  VALIDATION_FAILED: '需修正',
  PUBLISHED: '已入库',
  VALID: '通过',
  WARNING: '有警告',
  ERROR: '错误',
  SKIPPED: '已跳过',
}

const BATCH_STATUS_FILTERS = [
  { value: 'all', label: '全部状态' },
  { value: 'PENDING_REVIEW', label: '待审核' },
  { value: 'REVISION_REQUIRED', label: '退回修改' },
  { value: 'READY_TO_PUBLISH', label: '待确认入库' },
  { value: 'PUBLISHING', label: '入库中' },
  { value: 'PUBLISH_FAILED', label: '入库失败待重试' },
  { value: 'VALIDATION_FAILED', label: '需修正' },
  { value: 'PUBLISHED', label: '已入库' },
]

const BATCH_SCOPE_FILTERS = [
  { value: 'all', label: '全部批次' },
  { value: 'mine', label: '我的上传' },
  { value: 'pendingReview', label: '待审核队列' },
  { value: 'approved', label: '待同步队列' },
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
const MAX_UPLOAD_FILE_SIZE = 50 * 1024 * 1024

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
const isUploadingReviewPackage = ref(false)
const isSyncing = ref(false)
const isLoadingBatches = ref(false)
const isLoadingRows = ref(false)
const isLoadingUsers = ref(false)
const isSavingUser = ref(false)
const preview = ref<DataUploadPreview | null>(null)
const activePreviewSheet = ref('原始数据')
const selectedBatch = ref<DataUploadBatch | null>(null)
const selectedRowsPage = ref<DataUploadRowsPage | null>(null)
const reviewPackages = ref<DataUploadReviewPackage[]>([])
const selectedReviewPackageFile = ref<File | null>(null)
const batchPage = ref<DataUploadBatchPage>({ ...emptyBatchPage })
const userPage = ref<AdminUserPage>({ ...emptyUserPage })
const selectedUserIds = ref<Set<number>>(new Set())
const editingUser = ref<UserResponse | null>(null)
const bulkAction = ref('')
const reviewNote = ref('')
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const rowStatusFilter = ref<RowStatusFilter>('all')
const rowViewFilter = ref<RowViewFilter>('submission')
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
const currentUserCanDownload = computed(
  () => currentUser.value?.role === 'admin' || currentUser.value?.canDownload !== false,
)
const canSeeBatchModule = computed(() => canUploadData.value || canReviewUploads.value || canSyncData.value)
const selectedFileLabel = computed(() => selectedFile.value?.name ?? '拖拽或选择 WBE Excel 文件')
const selectedReviewPackageLabel = computed(
  () => selectedReviewPackageFile.value?.name ?? '选择包含五张工作表的审核包',
)
const activePreviewRows = computed(() => preview.value?.previewRowsBySheet?.[activePreviewSheet.value] ?? [])
const activePreviewColumns = computed(() => PREVIEW_COLUMNS[activePreviewSheet.value] ?? [])
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
    return '提交文件未通过校验。请检查“原始数据”的表头和问题行，修正后重新提交。'
  }
  if (preview.value.batch.errorRows > 0) {
    return '存在阻断错误的行，不能进入审核。请查看行预览中的问题字段，修正后提交新版本。'
  }
  if (preview.value.batch.status === 'REVISION_REQUIRED') {
    return '该提交已退回修改，请根据审核原因重新整理后提交新批次。'
  }
  if (preview.value.batch.status === 'PENDING_REVIEW') {
    return '提交已进入人工审核。审核人员可直接下载系统生成的五表草稿。'
  }
  return ''
})

const currentReviewPackage = computed(() => {
  const packageId = selectedBatch.value?.currentPackageId
  return reviewPackages.value.find((item) => item.packageId === packageId) ?? null
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
  await refreshCurrentUser()
  applyDefaultBatchView()
  activeSection.value = workspaceSections.value[0]?.key ?? 'upload'
  if (canSeeBatchModule.value) await loadBatches()
  if (currentUserIsAdmin.value) await loadUsers(1)
})

async function refreshCurrentUser() {
  const token = getStoredSession()?.token
  if (!token) {
    clearSession()
    currentUser.value = null
    await router.push('/')
    return
  }
  try {
    const user = await fetchCurrentUser(token)
    currentUser.value = user
    updateStoredUser(user)
  } catch {
    clearSession()
    currentUser.value = null
    await router.push('/')
  }
}

function applyDefaultBatchView() {
  if (canUploadData.value || batchFilters.status !== 'all') return
  if (canReviewUploads.value) {
    batchFilters.scope = 'pendingReview'
  } else if (canSyncData.value) {
    batchFilters.scope = 'approved'
  }
}

function setMessage(type: 'success' | 'error', text: string) {
  messageType.value = type
  message.value = text
}

function setActiveSection(section: WorkspaceSection) {
  activeSection.value = section
}

function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? '状态待确认'
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

function validateSelectedFile(file: File) {
  if (!file.name.toLowerCase().endsWith('.xlsx')) return '仅支持 .xlsx 文件'
  if (file.size === 0) return '上传文件不能为空'
  if (file.size > MAX_UPLOAD_FILE_SIZE) return '上传文件不能超过 50MB'
  return ''
}

function selectUploadFile(file: File | null) {
  if (!file) {
    selectedFile.value = null
    message.value = ''
    return
  }
  const validationMessage = validateSelectedFile(file)
  selectedFile.value = validationMessage ? null : file
  if (validationMessage) {
    setMessage('error', validationMessage)
  } else {
    message.value = ''
  }
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  selectUploadFile(input.files?.[0] ?? null)
}

function handleDrop(event: DragEvent) {
  isDragging.value = false
  selectUploadFile(event.dataTransfer?.files?.[0] ?? null)
}

async function handleDownloadTemplate() {
  try {
    await downloadUploadTemplate()
    setMessage('success', 'Excel 模板已开始下载')
  } catch (error) {
    setMessage('error', getUserErrorMessage(error, '模板下载失败，请稍后重试'))
  }
}

async function handleDownloadReviewDraft(batch: DataUploadBatch) {
  try {
    await downloadReviewDraft(batch.uploadId)
    setMessage('success', '五表审核草稿已开始下载')
  } catch (error) {
    setMessage('error', getUserErrorMessage(error, '五表审核草稿下载失败，请稍后重试'))
  }
}

async function handlePreview() {
  if (!selectedFile.value) {
    setMessage('error', '请先选择 .xlsx 文件')
    return
  }
  const validationMessage = validateSelectedFile(selectedFile.value)
  if (validationMessage) {
    setMessage('error', validationMessage)
    return
  }
  try {
    isUploading.value = true
    preview.value = await uploadPreview(selectedFile.value)
    activePreviewSheet.value = preview.value.sheetSummaries?.[0]?.sheetName ?? '原始数据'
    selectedBatch.value = null
    selectedRowsPage.value = null
    await loadBatches()
    const { errorRows, warningRows, status } = preview.value.batch
    if (errorRows > 0) {
      setMessage('error', `解析完成，但存在 ${errorRows} 行阻断错误，请修正后重新上传。`)
    } else if (status === 'PENDING_REVIEW') {
      setMessage('success', `解析完成，已提交审核。提示警告 ${warningRows} 行。`)
    } else {
      setMessage('success', `解析完成，当前状态为「${statusLabel(status)}」。提示警告 ${warningRows} 行。`)
    }
  } catch (error) {
    setMessage('error', getUserErrorMessage(error, '上传解析失败，请检查文件后重试'))
  } finally {
    isUploading.value = false
  }
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
    setMessage('error', getUserErrorMessage(error, '上传记录加载失败，请稍后重试'))
  } finally {
    isLoadingBatches.value = false
  }
}

async function loadRows(batch: DataUploadBatch, page = 1) {
  try {
    isLoadingRows.value = true
    if (selectedBatch.value?.uploadId !== batch.uploadId) {
      rowStatusFilter.value = 'all'
      rowViewFilter.value = batch.currentPackageId ? 'reviewPackage' : 'submission'
    }
    selectedBatch.value = batch
    const [rows, packages] = await Promise.all([
      fetchUploadRows(batch.uploadId, page, 20, rowStatusFilter.value, rowViewFilter.value),
      fetchReviewPackages(batch.uploadId),
    ])
    selectedRowsPage.value = rows
    reviewPackages.value = packages
  } catch (error) {
    setMessage('error', getUserErrorMessage(error, '数据预览加载失败，请稍后重试'))
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

async function changeRowViewFilter() {
  if (!selectedBatch.value) return
  await loadRows(selectedBatch.value, 1)
}

function closeBatchDrawer() {
  selectedBatch.value = null
  selectedRowsPage.value = null
  reviewPackages.value = []
  selectedReviewPackageFile.value = null
  reviewNote.value = ''
  rowStatusFilter.value = 'all'
  rowViewFilter.value = 'submission'
}

function canSyncBatch(batch: DataUploadBatch) {
  return ['READY_TO_PUBLISH', 'PUBLISH_FAILED'].includes(batch.status) && canReviewUploads.value
}

async function handleBatchSync(batch: DataUploadBatch) {
  if (!canSyncBatch(batch)) return
  if (!window.confirm(`确定将「${batch.fileName}」的当前五表审核包增量写入正式库吗？此操作不会删除已有数据。`)) return
  try {
    isSyncing.value = true
    const result = await publishUpload(batch.uploadId)
    if (preview.value?.batch.uploadId === batch.uploadId) {
      preview.value = { ...preview.value, batch: result.batch }
    }
    selectedBatch.value = result.batch
    await loadBatches()
    if (selectedRowsPage.value?.uploadId === batch.uploadId) {
      await loadRows(result.batch, selectedRowsPage.value.page)
    }
    const sheetText = Object.entries(result.insertedRowsBySheet ?? {})
      .map(([sheet, count]) => `${sheet} ${count} 行`)
      .join('，')
    const warningText = result.warnings.length ? `；${result.warnings.join('；')}` : ''
    setMessage('success', `增量入库完成：新增 ${result.insertedRows} 个记录组，跳过重复 ${result.skippedRows} 个${sheetText ? `（${sheetText}）` : ''}${warningText}`)
  } catch (error) {
    setMessage('error', getUserErrorMessage(error, '增量入库未完成，正式数据未改变，请修复后重试'))
  } finally {
    isSyncing.value = false
  }
}

async function handleRejectBatch(batch: DataUploadBatch) {
  if (
    !canReviewUploads.value ||
    !['PENDING_REVIEW', 'READY_TO_PUBLISH', 'PUBLISH_FAILED'].includes(batch.status)
  ) return
  if (!reviewNote.value.trim()) {
    setMessage('error', '退回修改时必须填写具体原因')
    return
  }
  if (!window.confirm(`确定退回「${batch.fileName}」并要求修改吗？`)) return
  try {
    const rejectedBatch = await returnUpload(batch.uploadId, reviewNote.value)
    selectedBatch.value = rejectedBatch
    await loadBatches()
    reviewNote.value = ''
    setMessage('success', '提交已退回修改')
  } catch (error) {
    setMessage('error', getUserErrorMessage(error, '退回操作未完成，请刷新后重试'))
  }
}

function handleReviewPackageFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  if (!file) {
    selectedReviewPackageFile.value = null
    return
  }
  const validationMessage = validateSelectedFile(file)
  if (validationMessage) {
    selectedReviewPackageFile.value = null
    setMessage('error', validationMessage)
    return
  }
  selectedReviewPackageFile.value = file
}

async function handleUploadReviewPackage(batch: DataUploadBatch) {
  if (!selectedReviewPackageFile.value) {
    setMessage('error', '请先选择五表审核包')
    return
  }
  try {
    isUploadingReviewPackage.value = true
    const result = await uploadReviewPackage(batch.uploadId, selectedReviewPackageFile.value)
    reviewPackages.value = await fetchReviewPackages(batch.uploadId)
    await loadBatches()
    const refreshed = await fetchUploadBatch(batch.uploadId)
    selectedBatch.value = refreshed
    rowViewFilter.value = refreshed.currentPackageId ? 'reviewPackage' : 'submission'
    await loadRows(refreshed, 1)
    selectedReviewPackageFile.value = null
    if (result.status === 'VALID') {
      setMessage('success', `五表审核包 V${result.versionNo} 校验通过，可以确认入库`)
    } else {
      setMessage('error', `五表审核包 V${result.versionNo} 未通过校验，请查看错误摘要`)
    }
  } catch (error) {
    setMessage('error', getUserErrorMessage(error, '五表审核包上传失败，请检查文件后重试'))
  } finally {
    isUploadingReviewPackage.value = false
  }
}

async function handleUploadRevision(batch: DataUploadBatch) {
  if (!selectedReviewPackageFile.value) {
    setMessage('error', '请先选择保留投稿行ID的修订工作簿')
    return
  }
  try {
    isUploadingReviewPackage.value = true
    preview.value = await uploadSubmissionRevision(batch.uploadId, selectedReviewPackageFile.value)
    const refreshed = await fetchUploadBatch(batch.uploadId)
    selectedBatch.value = refreshed
    selectedReviewPackageFile.value = null
    await loadBatches()
    await loadRows(refreshed, 1)
    setMessage(refreshed.status === 'PENDING_REVIEW' ? 'success' : 'error',
      refreshed.status === 'PENDING_REVIEW' ? '修订版本校验通过，已重新进入审核' : '修订版本仍有校验错误，请查看问题行')
  } catch (error) {
    setMessage('error', getUserErrorMessage(error, '修订版本上传失败，请检查投稿行ID和字段'))
  } finally {
    isUploadingReviewPackage.value = false
  }
}

async function downloadPackage(batch: DataUploadBatch, item: DataUploadReviewPackage) {
  try {
    await downloadReviewPackageFile(batch.uploadId, item.packageId, item.fileName)
  } catch (error) {
    setMessage('error', getUserErrorMessage(error, '完整整理包下载失败，请稍后重试'))
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
    setMessage('error', getUserErrorMessage(error, '文件下载失败，请稍后重试'))
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
    setMessage('error', getUserErrorMessage(error, '用户列表加载失败，请稍后重试'))
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
  if (!window.confirm(`确定保存「${editingUser.value.username}」的角色和功能权限吗？`)) return
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
    setMessage('error', getUserErrorMessage(error, '权限更新未完成，请稍后重试'))
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
    setMessage('error', getUserErrorMessage(error, '批量更新未完成，请稍后重试'))
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
    <PlatformHeader
      active="data"
      page-title="数据工作台"
      :page-subtitle="activeHeaderLabel"
      show-context
      @logout="handleLogout"
    />

    <section id="main-content" class="workspace-layout" tabindex="-1">
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
            <h2>提交数据</h2>
            <p>普通用户只填写一张“原始数据”长表。分类、标准单位、点位、ICD11 和派生结果由审核与系统处理。</p>
          </header>

          <div class="import-grid" aria-label="上传与校验">
            <div class="upload-panel">
              <header class="panel-head">
                <div>
                  <span>原始提交</span>
                  <h3>选择原始数据文件</h3>
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
                <span>.xlsx，最大 50MB，必须且只能有一张“原始数据”工作表</span>
              </label>
              <button type="button" class="primary-action" :disabled="isUploading" @click="handlePreview">
                {{ isUploading ? '正在解析' : '开始校验' }}
              </button>
            </div>

            <div class="summary-panel">
              <header>
                <span>校验结果</span>
                <h3>校验摘要</h3>
              </header>
              <div v-if="preview" class="summary-metrics">
                <article>
                  <span>总行数</span>
                  <strong>{{ preview.batch.totalRows }}</strong>
                </article>
                <article>
                  <span>有效行</span>
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
              <div v-if="preview?.sheetSummaries?.length" class="sheet-summary-list">
                <button
                  v-for="sheet in preview.sheetSummaries"
                  :key="sheet.sheetName"
                  type="button"
                  :class="{ active: activePreviewSheet === sheet.sheetName }"
                  @click="activePreviewSheet = sheet.sheetName"
                >
                  <strong>{{ sheet.sheetName }}</strong>
                  <span>{{ sheet.totalRows }} 行 · 错 {{ sheet.errorRows }} · 警 {{ sheet.warningRows }}</span>
                </button>
              </div>
              <p v-else class="empty-state">上传文件后会显示字段识别、错误和警告摘要。</p>
              <div v-if="previewBlockingMessage" class="issue-list blocker">
                <strong>{{ preview && preview.batch.status === 'PENDING_REVIEW' ? '等待审核' : '不能同步' }}</strong>
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
                该提交已进入审核队列。审核人员可以下载系统生成的五表草稿，纠正后上传。
              </p>
            </div>
          </div>

          <div class="requirements-band" aria-label="上传要求">
            <div class="requirements-copy">
              <span>上传要求</span>
              <h3>提交文件只保留普通上传者需要负责的内容。</h3>
              <p>
                仅支持不超过 50MB 的无宏 .xlsx 文件；必须使用系统单表模板。系统会生成稳定投稿行ID，文件校验通过后进入人工审核，不会直接修改正式库。
              </p>
              <div class="template-actions">
                <button type="button" @click="handleDownloadTemplate">下载 Excel 模板</button>
                <small>模板只有“原始数据”一张表；黄色必填、白色可选、灰色为系统字段。</small>
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
              <span>数据预览</span>
              <h3>{{ activePreviewSheet }} · 前 {{ activePreviewRows.length }} 行</h3>
            </header>
            <div v-if="preview.sheetSummaries?.length" class="preview-sheet-tabs" role="tablist" aria-label="工作表预览">
              <button
                v-for="sheet in preview.sheetSummaries"
                :key="sheet.sheetName"
                type="button"
                role="tab"
                :aria-selected="activePreviewSheet === sheet.sheetName"
                :class="{ active: activePreviewSheet === sheet.sheetName }"
                @click="activePreviewSheet = sheet.sheetName"
              >
                {{ sheet.sheetName }}
              </button>
            </div>
            <p v-if="!activePreviewRows.length" class="empty-state">
              当前批次没有可预览行；通常是工作表缺失、表头不匹配或文件解析失败，请按模板修正后重新上传。
            </p>
            <div v-else class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>行号</th>
                    <th>状态</th>
                    <th v-for="column in activePreviewColumns" :key="column">{{ column }}</th>
                    <th>问题</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in activePreviewRows" :key="row.rowId">
                    <td>{{ row.excelRowNumber }}</td>
                    <td>
                      <span class="status-pill" :class="row.status.toLowerCase()">
                        {{ statusLabel(row.status) }}
                      </span>
                    </td>
                    <td v-for="column in activePreviewColumns" :key="column">{{ row.data[column] || 'NA' }}</td>
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
                  <th>审核 / 入库</th>
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
                    <span class="audit-line">库：{{ batch.syncedByName || '-' }} / {{ formatMaybeDate(batch.syncedAt) }}</span>
                  </td>
                  <td>
                    <div class="row-actions compact-actions">
                      <button type="button" @click="loadRows(batch)">
                        {{ batch.status === 'PENDING_REVIEW' ? '查看/审核' : '查看' }}
                      </button>
                      <button type="button" :disabled="!currentUserCanDownload" @click="downloadBatch(batch)">下载</button>
                      <button v-if="canSyncBatch(batch)" type="button" @click="handleBatchSync(batch)">
                        {{ batch.status === 'PUBLISH_FAILED' ? '重试入库' : '确认入库' }}
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
                  <p>入库人：{{ selectedBatch.syncedByName || '-' }} / {{ formatMaybeDate(selectedBatch.syncedAt) }}</p>
                  <p v-if="selectedBatch.reviewNote">审核备注：{{ selectedBatch.reviewNote }}</p>
                  <p v-if="selectedBatch.syncErrorMessage" class="sync-error">
                    增量入库未完成，正式数据未改变；请修复后重试。
                  </p>
                </div>

                <section
                  v-if="canReviewUploads && ['PENDING_REVIEW', 'READY_TO_PUBLISH', 'PUBLISH_FAILED'].includes(selectedBatch.status)"
                  class="review-package-panel"
                >
                  <header>
                    <div>
                      <strong>五表审核包</strong>
                      <p>先下载系统预填草稿，纠正后上传。包含规范数据、文献、点位、采样方法和 ICD11 五张工作表。</p>
                    </div>
                    <button type="button" class="secondary-action" @click="handleDownloadReviewDraft(selectedBatch)">
                      下载预填草稿
                    </button>
                  </header>
                  <label class="package-file-input">
                    <input type="file" accept=".xlsx" @change="handleReviewPackageFileChange" />
                    <span>{{ selectedReviewPackageLabel }}</span>
                  </label>
                  <button
                    type="button"
                    class="primary-action compact"
                    :disabled="isUploadingReviewPackage"
                    @click="handleUploadReviewPackage(selectedBatch)"
                  >
                    {{ isUploadingReviewPackage ? '正在校验' : '上传五表审核包' }}
                  </button>
                </section>

                <section v-if="reviewPackages.length" class="review-package-history">
                  <header>
                    <strong>审核包版本</strong>
                    <span>历史版本只读保留</span>
                  </header>
                  <article v-for="item in reviewPackages" :key="item.packageId">
                    <div>
                      <strong>V{{ item.versionNo }} · {{ item.fileName }}</strong>
                      <span>{{ statusLabel(item.status) }} / {{ item.totalRows }} 行 / {{ formatDate(item.createdAt) }}</span>
                    </div>
                    <button type="button" :disabled="!currentUserCanDownload" @click="downloadPackage(selectedBatch, item)">
                      下载
                    </button>
                    <p v-if="item.validationErrors.length">{{ item.validationErrors.join('；') }}</p>
                  </article>
                </section>

                <section v-if="selectedBatch.status === 'REVISION_REQUIRED' && selectedBatch.uploadedBy === currentUser?.userId" class="review-package-panel">
                  <header>
                    <div>
                      <strong>提交修订版本</strong>
                      <p>下载批次原始文件，在保留投稿行ID的前提下修正；新增行的投稿行ID留空。</p>
                    </div>
                    <button type="button" class="secondary-action" @click="downloadBatch(selectedBatch)">下载当前版本</button>
                  </header>
                  <label class="package-file-input">
                    <input type="file" accept=".xlsx" @change="handleReviewPackageFileChange" />
                    <span>{{ selectedReviewPackageLabel }}</span>
                  </label>
                  <button type="button" class="primary-action compact" :disabled="isUploadingReviewPackage" @click="handleUploadRevision(selectedBatch)">
                    {{ isUploadingReviewPackage ? '正在校验' : '提交修订版本' }}
                  </button>
                </section>

                <section v-if="currentReviewPackage?.diffSummary" class="review-checklist">
                  <header><strong>增量影响预览</strong><span>不会删除已有记录</span></header>
                  <div class="production-diff">
                    <p>投稿行：{{ currentReviewPackage.diffSummary.submissionRows ?? 0 }}</p>
                    <p>拟发布行：{{ currentReviewPackage.diffSummary.publishRows ?? 0 }}</p>
                    <p>排除行：{{ currentReviewPackage.diffSummary.excludedRows ?? 0 }}</p>
                    <p>新增记录组：{{ currentReviewPackage.diffSummary.newRecordGroups ?? 0 }}</p>
                    <p>删除既有记录：{{ currentReviewPackage.diffSummary.existingRowsDeleted ?? 0 }}</p>
                  </div>
                </section>

                <div class="drawer-row-toolbar">
                  <label>
                    数据版本
                    <select v-model="rowViewFilter" @change="changeRowViewFilter">
                      <option value="submission">原始提交</option>
                      <option value="reviewPackage" :disabled="!selectedBatch.currentPackageId">
                        当前审核包
                      </option>
                    </select>
                  </label>
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
                        <th>工作表</th>
                        <th>行</th>
                        <th>状态</th>
                        <th>目标物</th>
                        <th>问题</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="row in selectedRowsPage.rows" :key="row.rowId">
                        <td>{{ row.sheetName }}</td>
                        <td>{{ row.excelRowNumber }}</td>
                        <td>
                          <span class="status-pill" :class="row.status.toLowerCase()">
                            {{ statusLabel(row.status) }}
                          </span>
                        </td>
                        <td>{{ row.data['标准药物名称'] || row.data['标准生物标记物名称'] || row.data['生物标记物名称原文'] || 'NA' }}</td>
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
                    v-if="canReviewUploads && ['PENDING_REVIEW', 'READY_TO_PUBLISH', 'PUBLISH_FAILED'].includes(selectedBatch.status)"
                    v-model.trim="reviewNote"
                    maxlength="500"
                    placeholder="退回修改原因（退回时必填，最多500字）"
                  ></textarea>
                  <div>
                    <button
                      v-if="canReviewUploads && ['PENDING_REVIEW', 'READY_TO_PUBLISH', 'PUBLISH_FAILED'].includes(selectedBatch.status)"
                      type="button"
                      class="danger-action"
                      @click="handleRejectBatch(selectedBatch)"
                    >
                      退回修改
                    </button>
                    <button
                      v-if="canSyncBatch(selectedBatch)"
                      type="button"
                      class="primary-action compact"
                      :disabled="isSyncing"
                      @click="handleBatchSync(selectedBatch)"
                    >
                      {{ selectedBatch.status === 'PUBLISH_FAILED' ? '重试入库' : '确认入库' }}
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
            <p>分页查看并批量调整用户权限。同步权限只能处理已审核通过的批次，不能代替审核权限。</p>
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
  --entry-header-height: 118px;
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

.sheet-summary-list,
.preview-sheet-tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
}

.sheet-summary-list {
  margin: 0 0 10px;
}

.sheet-summary-list button {
  display: grid;
  min-width: 170px;
  gap: 3px;
  padding: 9px 10px;
  border: 1px solid #d5e1e4;
  border-radius: 6px;
  background: #ffffff;
  color: #203942;
  text-align: left;
}

.sheet-summary-list button.active {
  border-color: #287b87;
  background: #edf7f7;
}

.sheet-summary-list span {
  color: #657980;
  font-size: 12px;
}

.preview-sheet-tabs button {
  padding: 7px 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #657980;
}

.preview-sheet-tabs button.active {
  border-bottom-color: #287b87;
  color: #174d57;
  font-weight: 700;
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
.status-pill.enrichment_required,
.status-pill.pending_approval,
.status-pill.warning,
.status-pill.skipped {
  background: #fff4d8;
  color: #835d10;
}

.status-pill.validation_failed,
.status-pill.revision_required,
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
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(720px, 100%);
  height: 100%;
  overflow-y: auto;
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
.drawer-row-toolbar,
.review-package-panel,
.review-package-history,
.review-checklist {
  padding: 10px;
  border: 1px solid #d8e2e5;
  border-radius: 8px;
  background: #ffffff;
}

.review-package-panel,
.review-package-history,
.review-checklist {
  display: grid;
  gap: 10px;
}

.review-package-panel header,
.review-package-history header,
.review-checklist header,
.review-package-history article {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}

.review-package-panel header span,
.review-package-history header span,
.review-checklist header span,
.review-package-history article span {
  color: #607780;
  font-size: 12px;
}

.package-file-input {
  display: block;
  padding: 9px 10px;
  overflow: hidden;
  border: 1px dashed #a8bec4;
  border-radius: 6px;
  color: #405e67;
  cursor: pointer;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.package-file-input input {
  display: none;
}

.review-package-history article {
  padding-top: 9px;
  border-top: 1px solid #e2eaec;
}

.review-package-history article > div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.review-package-history article p {
  grid-column: 1 / -1;
  margin: 0;
  color: #96372e;
  font-size: 12px;
}

.review-checklist > label {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  color: #294952;
  font-size: 13px;
}

.review-checklist textarea {
  min-height: 62px;
  resize: vertical;
  padding: 8px 10px;
  border: 1px solid #c9d8dc;
  border-radius: 6px;
  font: inherit;
}

.production-diff {
  padding: 9px 10px;
  border-left: 3px solid #73959d;
  background: #f5f8f9;
}

.production-diff p {
  margin: 4px 0 0;
  color: #4f6870;
  font-size: 12px;
}

.production-diff p.risk {
  color: #96372e;
  font-weight: 700;
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

.drawer-audit .sync-error {
  grid-column: 1 / -1;
  color: #96372e;
  font-weight: 700;
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
  min-height: 240px;
  max-height: 48vh;
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
