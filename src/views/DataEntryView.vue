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
  type DataUploadPreview,
  type DataUploadRowsPage,
} from '../services/dataUploads'
import { clearSession, getStoredSession, isAdmin, updateStoredUser } from '../services/session'

type WorkspaceSection = 'upload' | 'batches' | 'users'
type PermissionFilter = 'all' | 'true' | 'false'

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
const selectedRowsPage = ref<DataUploadRowsPage | null>(null)
const batches = ref<DataUploadBatch[]>([])
const userPage = ref<AdminUserPage>({ ...emptyUserPage })
const selectedUserIds = ref<Set<number>>(new Set())
const editingUser = ref<UserResponse | null>(null)
const bulkAction = ref('')
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const batchSearch = ref('')
const batchStatusFilter = ref('all')
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

const filteredBatches = computed(() => {
  const keyword = normalizeKeyword(batchSearch.value)
  return batches.value.filter((batch) => {
    const matchesStatus = batchStatusFilter.value === 'all' || batch.status === batchStatusFilter.value
    const searchable = [
      batch.fileName,
      batch.uploadedByName,
      statusLabel(batch.status),
      batch.duplicateMessage ?? '',
    ]
      .join(' ')
      .toLowerCase()
    return matchesStatus && (!keyword || searchable.includes(keyword))
  })
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

function normalizeKeyword(value: string) {
  return value.trim().toLowerCase()
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
  try {
    isLoadingBatches.value = true
    batches.value = await fetchUploads()
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : '上传批次加载失败')
  } finally {
    isLoadingBatches.value = false
  }
}

async function loadRows(batch: DataUploadBatch, page = 1) {
  try {
    isLoadingRows.value = true
    selectedRowsPage.value = await fetchUploadRows(batch.uploadId, page, 20)
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : '行预览加载失败')
  } finally {
    isLoadingRows.value = false
  }
}

async function handleBatchSync(batch: DataUploadBatch) {
  if (!canSyncData.value) return
  const action = batch.status === 'PENDING_REVIEW' ? '通过审核并同步入库' : '同步入库'
  if (!window.confirm(`确定要${action}「${batch.fileName}」吗？`)) return
  try {
    isSyncing.value = true
    const result = await syncUpload(batch.uploadId)
    if (preview.value?.batch.uploadId === batch.uploadId) {
      preview.value = { ...preview.value, batch: result.batch }
    }
    await loadBatches()
    const warningText = result.warnings.length ? `；${result.warnings.join('；')}` : ''
    setMessage('success', `已同步 ${result.insertedRows} 行，跳过重复 ${result.skippedRows} 行${warningText}`)
  } catch (error) {
    setMessage('error', error instanceof Error ? error.message : '同步失败')
  } finally {
    isSyncing.value = false
  }
}

async function handleRejectBatch(batch: DataUploadBatch) {
  if (!canReviewUploads.value) return
  if (!window.confirm(`确定驳回「${batch.fileName}」吗？`)) return
  try {
    await rejectUpload(batch.uploadId)
    await loadBatches()
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

    <section class="entry-title">
      <p>DATA WORKSPACE</p>
      <h1>数据工作台</h1>
      <span>上传录入、上传批次和用户权限已经拆分为独立工作区。</span>
    </section>

    <p v-if="message" class="page-message" :class="messageType">{{ message }}</p>

    <section class="workspace-layout">
      <aside class="workspace-nav" aria-label="数据工作台模块">
        <button
          v-for="section in workspaceSections"
          :key="section.key"
          type="button"
          :class="{ active: activeSection === section.key }"
          @click="setActiveSection(section.key)"
        >
          <strong>{{ section.title }}</strong>
          <span>{{ section.caption }}</span>
        </button>
      </aside>

      <div class="workspace-main">
        <section v-if="activeSection === 'upload' && canUploadData" class="workspace-panel" aria-label="上传录入">
          <header class="section-head">
            <span>UPLOAD</span>
            <h2>上传录入</h2>
            <p>先下载模板或按 WBE 汇总表整理字段，上传后完成字段识别、校验摘要和前 20 行预览。</p>
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
              <div v-if="preview?.headerErrors.length" class="issue-list error">
                <strong>表头错误</strong>
                <p v-for="item in preview.headerErrors" :key="item">{{ item }}</p>
              </div>
              <div v-if="preview?.batchWarnings.length" class="issue-list warning">
                <strong>批次提示</strong>
                <p v-for="item in preview.batchWarnings" :key="item">{{ item }}</p>
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
            <div class="table-scroll">
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
          <div class="module-toolbar">
            <header class="section-head">
              <span>HISTORY</span>
              <h2>上传批次</h2>
              <p>查看上传记录、下载原文件、预览行级问题，并处理待审核批次。</p>
            </header>
            <div class="list-toolbar" aria-label="批次筛选">
              <label>
                <span>搜索批次</span>
                <input v-model.trim="batchSearch" type="search" placeholder="文件名 / 上传人 / 状态" />
              </label>
              <label>
                <span>状态</span>
                <select v-model="batchStatusFilter">
                  <option v-for="item in BATCH_STATUS_FILTERS" :key="item.value" :value="item.value">
                    {{ item.label }}
                  </option>
                </select>
              </label>
              <button type="button" @click="loadBatches">刷新</button>
            </div>
          </div>
          <p v-if="isLoadingBatches" class="empty-state">正在加载上传批次。</p>
          <p v-else-if="!filteredBatches.length" class="empty-state">没有匹配的上传批次。</p>
          <div v-else class="history-list">
            <article v-for="batch in filteredBatches" :key="batch.uploadId">
              <div>
                <strong>{{ batch.fileName }}</strong>
                <span>{{ batch.uploadedByName }} / {{ formatDate(batch.createdAt) }}</span>
              </div>
              <span class="status-pill" :class="batch.status.toLowerCase()">
                {{ statusLabel(batch.status) }}
              </span>
              <p>
                {{ batch.totalRows }} 行，错误 {{ batch.errorRows }}，警告 {{ batch.warningRows }}，已入库
                {{ batch.syncedRows }}
              </p>
              <div class="row-actions">
                <button type="button" @click="loadRows(batch)">查看行</button>
                <button type="button" :disabled="!currentUserCanDownload" @click="downloadBatch(batch)">下载原文件</button>
                <button
                  v-if="canSyncData && ['PREVIEWED', 'PENDING_REVIEW'].includes(batch.status)"
                  type="button"
                  @click="handleBatchSync(batch)"
                >
                  {{ batch.status === 'PENDING_REVIEW' ? '通过并同步' : '同步入库' }}
                </button>
                <button
                  v-if="canReviewUploads && batch.status === 'PENDING_REVIEW'"
                  type="button"
                  class="danger-action"
                  @click="handleRejectBatch(batch)"
                >
                  驳回
                </button>
              </div>
            </article>
          </div>
          <div v-if="selectedRowsPage" class="rows-drawer">
            <header>
              <strong>批次 #{{ selectedRowsPage.uploadId }} 行预览</strong>
              <span>{{ selectedRowsPage.total }} 行</span>
            </header>
            <p v-if="isLoadingRows" class="empty-state">正在加载行数据。</p>
            <div v-else class="compact-rows">
              <article v-for="row in selectedRowsPage.rows" :key="row.rowId">
                <span>第 {{ row.excelRowNumber }} 行</span>
                <strong>{{ row.data['药物'] || row.data['生物标记物名称'] || 'NA' }}</strong>
                <em>{{ statusLabel(row.status) }}</em>
                <p>{{ [...row.errors, ...row.warnings].join('；') || '通过' }}</p>
              </article>
            </div>
          </div>
        </section>

        <section v-if="activeSection === 'users' && currentUserIsAdmin" class="workspace-panel" aria-label="用户权限">
          <header class="section-head">
            <span>ADMIN</span>
            <h2>用户权限</h2>
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

          <div v-if="selectedCount" class="bulk-toolbar">
            <strong>已选择 {{ selectedCount }} 个用户</strong>
            <select v-model="bulkAction">
              <option value="">选择批量操作</option>
              <option v-for="item in BULK_ACTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
            <button type="button" @click="applyBulkAction">应用</button>
            <button type="button" class="ghost-action" @click="clearSelectedUsers">清空选择</button>
          </div>

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
                    <button
                      type="button"
                      class="table-action"
                      :disabled="user.role === 'admin'"
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
  min-height: 100vh;
}

.entry-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto auto auto;
  gap: 24px;
  align-items: center;
  padding: 14px clamp(18px, 4vw, 56px);
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

.entry-title,
.workspace-layout,
.page-message {
  width: min(1120px, calc(100% - 32px));
  margin: 0 auto;
}

.entry-title {
  padding: 24px 0 16px;
}

.entry-title p,
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

.entry-title h1,
.section-head h2,
.section-head h3,
.requirements-copy h3,
.upload-panel h3,
.summary-panel h3,
.permission-drawer h2 {
  margin: 0;
  letter-spacing: 0;
}

.entry-title h1 {
  font-size: clamp(28px, 4vw, 40px);
  line-height: 1.15;
}

.entry-title span,
.section-head p,
.requirements-copy p,
.review-note,
.permission-drawer p {
  color: #5e747b;
  line-height: 1.55;
}

.entry-title span {
  display: block;
  max-width: 680px;
  font-size: 14px;
}

.page-message {
  margin-bottom: 18px;
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
  grid-template-columns: 168px minmax(0, 1fr);
  gap: 16px;
  padding-bottom: 32px;
}

.workspace-nav {
  position: sticky;
  top: 78px;
  display: grid;
  align-self: start;
  gap: 6px;
  padding: 6px;
  border: 1px solid #d5e1e4;
  border-radius: 8px;
  background: #ffffff;
}

.workspace-nav button {
  position: relative;
  display: grid;
  gap: 3px;
  min-height: 48px;
  padding: 8px 10px 8px 14px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #48626a;
  cursor: pointer;
  text-align: left;
}

.workspace-nav button.active {
  background: #eaf5f5;
  color: #0f4f5c;
}

.workspace-nav button.active::before {
  position: absolute;
  top: 9px;
  bottom: 9px;
  left: 5px;
  width: 3px;
  border-radius: 999px;
  background: #0f4f5c;
  content: '';
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
}

.section-head {
  display: grid;
  justify-items: start;
  gap: 4px;
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

button:disabled {
  background: #9fb2b8 !important;
  cursor: not-allowed;
}

.primary-action {
  width: 100%;
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
}

.issue-list.error {
  background: #fff2f0;
  color: #9f3428;
}

.issue-list.warning {
  background: #fff8e6;
  color: #855b11;
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
  width: 82px;
}

.permission-table tr.muted {
  background: #fbfcfc;
}

.check-cell {
  display: inline-flex;
  gap: 8px;
  align-items: center;
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

@media (max-width: 980px) {
  .entry-header,
  .workspace-layout,
  .requirements-band,
  .import-grid,
  .history-list,
  .list-toolbar,
  .permission-filters,
  .module-toolbar {
    grid-template-columns: 1fr;
  }

  .workspace-nav {
    position: static;
    display: flex;
    overflow-x: auto;
    padding: 0;
    border: 0;
    background: transparent;
  }

  .workspace-nav button {
    min-width: 150px;
    background: #ffffff;
  }

  .summary-metrics,
  .requirements-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
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
}
</style>
