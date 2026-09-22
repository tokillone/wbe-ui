<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

import PlatformHeader from '../components/PlatformHeader.vue'
import { fetchUsers, updateUserPermissions, type AdminUserPage } from '../services/admin'
import type { UserResponse } from '../services/auth'
import {
  completeUploadReview,
  cancelUploadSubmission,
  downloadUploadIssues,
  downloadUploadTemplate,
  fetchRefreshJobs,
  fetchCanonicalTerms,
  fetchDictionaryChanges,
  fetchReviewRecords,
  fetchUploadBatch,
  fetchUploadProcessing,
  fetchUploads,
  patchReviewRecord,
  publishUpload,
  requestDictionaryChange,
  returnUploadReview,
  reviewDictionaryChange,
  retryRefreshJob,
  submitReadyDoiGroups,
  uploadCorrection,
  uploadSubmission,
  type DataUploadBatch,
  type UploadProcessing,
  type UploadCanonicalTerm,
  type UploadDictionaryChange,
  type UploadRefreshJob,
  type UploadReviewPage,
  type UploadReviewRecord,
} from '../services/dataUploads'
import { getUserErrorMessage } from '../services/errors'
import { getStoredSession, isAdmin } from '../services/session'

type WorkspaceTab = 'workflow' | 'batches' | 'permissions'

const stages = [
  { number: '01', title: '准备文件', detail: '下载 SUBMISSION_V2，一行填一个原始观测值。' },
  { number: '02', title: '校验筛选', detail: '按 DOI 整组拦截错误与库内重复。' },
  { number: '03', title: '规范审核', detail: '并排核对原值、规范值和映射理由。' },
  { number: '04', title: '发布与刷新', detail: '增量入库，地图与优先级后台构建新版本。' },
]

const standardFields = [
  '目标类别', '目标物质类别', '目标物质子类', '目标物质细类',
  '标准药物名称', '标准生物标记物名称', '标准CAS', '标准数值', '标准单位',
]
const siteFields = ['标准点位名称', '标准国家', '标准省州', '标准城市', '已有点位ID', '点位确认依据']
const methodFields = ['标准采样方法', '标准分析方法', '采样主类', '采样对象', '比例方式', '采样部署时长', '被动采样器类型']
const sankeyFields = ['疾病实体', 'ICD11一级编码', 'ICD11二级编码', 'ICD11三级编码', '映射层级', '匹配类型']
const rawDisplayFields = ['DOI', '文献标题', '来源记录编号', '标记物原文', '采样方法', '分析方法', '点位名称', '国家', '采样时间', '指标类型', '原始值', '原始单位', '证据定位']
const dictionaryTypeByField: Record<string, string> = {
  '目标类别': 'TARGET_CATEGORY', '目标物质类别': 'SUBSTANCE_CATEGORY',
  '目标物质子类': 'SUBSTANCE_SUBCLASS', '目标物质细类': 'SUBSTANCE_FINE',
  '标准单位': 'UNIT', '标准国家': 'LOCATION_COUNTRY', '标准省州': 'LOCATION_PROVINCE',
  '标准城市': 'LOCATION_CITY', '已有点位ID': 'CONFIRMED_SITE', 'ICD11一级编码': 'ICD11_LEVEL1',
  'ICD11二级编码': 'ICD11_LEVEL2', 'ICD11三级编码': 'ICD11_LEVEL3',
}
const dictionaryTypes = [...new Set(Object.values(dictionaryTypeByField))]

const user = ref<UserResponse | null>(getStoredSession()?.user ?? null)
const activeTab = ref<WorkspaceTab>('workflow')
const activeStage = ref(1)
const selectedFile = ref<File | null>(null)
const correctionFile = ref<File | null>(null)
const uploadInput = ref<HTMLInputElement | null>(null)
const correctionInput = ref<HTMLInputElement | null>(null)
const selectedUploadId = ref<number | null>(null)
const selectedBatch = ref<DataUploadBatch | null>(null)
const processing = ref<UploadProcessing | null>(null)
const reviewPage = ref<UploadReviewPage | null>(null)
const refreshJobs = ref<UploadRefreshJob[]>([])
const batches = ref<DataUploadBatch[]>([])
const batchPage = ref(1)
const batchTotalPages = ref(0)
const reviewPageNumber = ref(1)
const busy = ref('')
const notice = ref('')
const error = ref('')
const reviewNote = ref('')
const overrideReason = ref('')
const reviewReturnReason = ref('')
const cancellationReason = ref('')
const guideOpen = ref(true)
const permissions = ref<AdminUserPage | null>(null)
const canonicalTerms = reactive<Record<string, UploadCanonicalTerm[]>>({})
const dictionaryRequests = ref<UploadDictionaryChange[]>([])
const recordAuditReasons = reactive<Record<number, string>>({})
const dictionaryDecisionReasons = reactive<Record<number, string>>({})
const dictionaryDraft = reactive({ rowId: '', dictionaryType: 'TARGET_CATEGORY', proposedCode: '', proposedLabel: '', evidence: '' })
let pollTimer: number | undefined

const canUpload = computed(() => user.value?.role === 'admin' || user.value?.canUpload)
const canReview = computed(() => user.value?.role === 'admin' || user.value?.canReviewUploads)
const canPublish = computed(() => user.value?.role === 'admin' || user.value?.canSyncData)
const selfReview = computed(() => selectedBatch.value?.uploadedBy === user.value?.userId)
const canReviewSelected = computed(() => canReview.value && (!selfReview.value || isAdmin(user.value)))
const reviewRecords = computed(() => reviewPage.value?.records ?? [])
const hasAction = (action: string) => processing.value?.availableActions?.includes(action) ?? false

function setFeedback(message = '', failure = '') {
  notice.value = message
  error.value = failure
}

function stageFor(status?: string) {
  if (status === 'PENDING_REVIEW') return 3
  if (['READY_TO_PUBLISH', 'PUBLISHING', 'PUBLISHED', 'PARTIALLY_PUBLISHED', 'PUBLISH_FAILED'].includes(status ?? '')) return 4
  if (status) return 2
  return 1
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    PROCESSING: '校验中', READY_TO_SUBMIT: '待提交', NEEDS_CORRECTION: '需修正',
    PENDING_REVIEW: '审核中', READY_TO_PUBLISH: '待发布', PUBLISHING: '发布中',
    PUBLISHED: '已完成', PARTIALLY_PUBLISHED: '需修正', PUBLISH_FAILED: '待发布',
  }
  return labels[status] ?? status
}

function groupLabel(status: string) {
  return ({ READY: '合格', RESERVED: '已提交', HELD_ERROR: '整组暂缓', DUPLICATE_DATABASE: '重复跳过', RESERVATION_CONFLICT: '并发冲突', PUBLISHED: '已发布' } as Record<string, string>)[status] ?? status
}

function refreshLabel(job: UploadRefreshJob) {
  const name = job.jobType === 'MAP' ? '地图统计' : '核心标记物优先级'
  const status = ({ QUEUED: '排队中', RUNNING: '构建中', SUCCEEDED: '已切换', FAILED: '刷新失败' } as Record<string, string>)[job.status]
  return `${name}·${status}`
}

async function loadBatches() {
  try {
    const page = await fetchUploads({ page: batchPage.value, size: 20, sort: 'createdAt_desc' })
    batches.value = page.items
    batchTotalPages.value = page.totalPages
  } catch (cause) {
    setFeedback('', getUserErrorMessage(cause, '批次列表加载失败'))
  }
}

async function loadReview(page = reviewPageNumber.value) {
  if (!selectedUploadId.value || !canReview.value) return
  reviewPageNumber.value = page
  reviewPage.value = await fetchReviewRecords(selectedUploadId.value, page, 20)
  await loadDictionaries()
}

async function loadDictionaries() {
  const missing = dictionaryTypes.filter((type) => !canonicalTerms[type])
  if (!missing.length) return
  const values = await Promise.all(missing.map((type) => fetchCanonicalTerms(type)))
  missing.forEach((type, index) => { canonicalTerms[type] = values[index] ?? [] })
}

function dataListId(field: string) {
  return dictionaryTypeByField[field] ? `terms-${dictionaryTypeByField[field]}` : undefined
}

function termValue(type: string, term: UploadCanonicalTerm) {
  return type.startsWith('ICD11_') || type === 'CONFIRMED_SITE' ? term.code : term.label
}

async function loadRefreshJobs() {
  if (!selectedUploadId.value) return
  refreshJobs.value = await fetchRefreshJobs(selectedUploadId.value)
}

async function selectBatch(uploadId: number) {
  selectedUploadId.value = uploadId
  busy.value = 'load'
  setFeedback()
  stopPolling()
  try {
    const [batch, state] = await Promise.all([fetchUploadBatch(uploadId), fetchUploadProcessing(uploadId)])
    selectedBatch.value = batch
    processing.value = state
    activeStage.value = stageFor(state.internalStatus)
    if (activeStage.value >= 3 && canReview.value) await loadReview(1)
    if (activeStage.value === 4) await loadRefreshJobs()
    schedulePolling()
    activeTab.value = 'workflow'
  } catch (cause) {
    setFeedback('', getUserErrorMessage(cause, '批次详情加载失败'))
  } finally {
    busy.value = ''
  }
}

async function refreshCurrent() {
  if (!selectedUploadId.value) return
  processing.value = await fetchUploadProcessing(selectedUploadId.value)
  activeStage.value = stageFor(processing.value.internalStatus)
  if (activeStage.value >= 3 && canReview.value) await loadReview()
  if (activeStage.value === 4) await loadRefreshJobs()
}

function stopPolling() {
  if (pollTimer) window.clearTimeout(pollTimer)
  pollTimer = undefined
}

function schedulePolling() {
  stopPolling()
  const workflowRunning = ['PROCESSING', 'PUBLISHING'].includes(processing.value?.internalStatus ?? '')
  const derivedRunning = refreshJobs.value.some((job) => ['QUEUED', 'RUNNING'].includes(job.status))
  if (!workflowRunning && !derivedRunning) return
  pollTimer = window.setTimeout(async () => {
    try { await refreshCurrent() } finally { schedulePolling() }
  }, 1200)
}

function chooseFile(event: Event, correction = false) {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null
  if (file && (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 50 * 1024 * 1024)) {
    setFeedback('', '请选择 50MB 以内的无宏 .xlsx 文件')
    return
  }
  if (correction) correctionFile.value = file
  else selectedFile.value = file
}

async function startUpload(correction = false) {
  const file = correction ? correctionFile.value : selectedFile.value
  if (!file || !canUpload.value) return
  busy.value = correction ? 'correction' : 'upload'
  setFeedback()
  try {
    const accepted = correction && selectedUploadId.value
      ? await uploadCorrection(selectedUploadId.value, file)
      : await uploadSubmission(file)
    await loadBatches()
    await selectBatch(accepted.uploadId)
    setFeedback(accepted.reusedExistingBatch ? '文件与已有批次相同，已打开原批次。' : '文件已接收，正在后台校验。')
    schedulePolling()
  } catch (cause) {
    setFeedback('', getUserErrorMessage(cause, '上传失败'))
  } finally {
    busy.value = ''
  }
}

async function submitGroups() {
  if (!selectedUploadId.value) return
  busy.value = 'submit'
  try {
    processing.value = await submitReadyDoiGroups(selectedUploadId.value)
    activeStage.value = stageFor(processing.value.internalStatus)
    await loadReview(1)
    await loadBatches()
    setFeedback('合格 DOI 已预约并提交审核；暂缓组保留在原批次。')
  } catch (cause) {
    setFeedback('', getUserErrorMessage(cause, '提交失败'))
  } finally { busy.value = '' }
}

async function saveRecord(record: UploadReviewRecord) {
  if (!selectedUploadId.value) return
  const reason = recordAuditReasons[record.rowId]?.trim()
  if (!reason) {
    setFeedback('', `请先填写第 ${record.excelRowNumber} 行的审核依据。`)
    return
  }
  busy.value = `row-${record.rowId}`
  try {
    const updated = await patchReviewRecord(selectedUploadId.value, record.rowId, {
      standardized: record.standardized,
      coreEligible: record.coreEligible,
      coreExclusionReason: record.coreExclusionReason ?? '',
      mapEligible: record.mapEligible,
      mapExclusionReason: record.mapExclusionReason ?? '',
      sankeyEligible: record.sankeyEligible,
      sankeyExclusionReason: record.sankeyExclusionReason ?? '',
      reason,
    })
    const index = reviewRecords.value.findIndex((item) => item.rowId === updated.rowId)
    if (index >= 0 && reviewPage.value) reviewPage.value.records[index] = updated
    recordAuditReasons[record.rowId] = ''
    setFeedback(`第 ${record.excelRowNumber} 行已保存，审核版本 V${updated.reviewVersion}。`)
  } catch (cause) {
    setFeedback('', getUserErrorMessage(cause, '审核记录保存失败'))
  } finally { busy.value = '' }
}

async function completeReview() {
  if (!selectedUploadId.value) return
  if (selfReview.value && isAdmin(user.value) && !overrideReason.value.trim()) {
    setFeedback('', '管理员审核自己的批次必须填写覆盖原因。')
    return
  }
  busy.value = 'complete'
  try {
    processing.value = await completeUploadReview(selectedUploadId.value, {
      adminOverride: selfReview.value && isAdmin(user.value),
      overrideReason: overrideReason.value,
      note: reviewNote.value,
    })
    activeStage.value = 4
    await loadBatches()
    setFeedback('审核版本已冻结，等待具有发布权限的账号确认。')
  } catch (cause) {
    setFeedback('', getUserErrorMessage(cause, '完成审核失败'))
  } finally { busy.value = '' }
}

async function returnReview() {
  if (!selectedUploadId.value || !reviewReturnReason.value.trim()) {
    setFeedback('', '退回修正必须填写原因。')
    return
  }
  busy.value = 'return-review'
  try {
    processing.value = await returnUploadReview(selectedUploadId.value, reviewReturnReason.value)
    activeStage.value = 2
    reviewReturnReason.value = ''
    await loadBatches()
    setFeedback('已退回上传者修正，DOI 预约已释放。')
  } catch (cause) { setFeedback('', getUserErrorMessage(cause, '退回失败')) }
  finally { busy.value = '' }
}

async function cancelSubmission() {
  if (!selectedUploadId.value || !cancellationReason.value.trim()) {
    setFeedback('', '撤回提交必须填写原因。')
    return
  }
  busy.value = 'cancel-submission'
  try {
    processing.value = await cancelUploadSubmission(selectedUploadId.value, cancellationReason.value)
    activeStage.value = 2
    cancellationReason.value = ''
    await loadBatches()
    setFeedback('已撤回本次提交，DOI 预约已释放，可重新提交。')
  } catch (cause) { setFeedback('', getUserErrorMessage(cause, '撤回失败')) }
  finally { busy.value = '' }
}

async function publish() {
  if (!selectedUploadId.value) return
  busy.value = 'publish'
  try {
    const result = await publishUpload(selectedUploadId.value)
    await refreshCurrent()
    await loadBatches()
    setFeedback(`核心数据已增量发布 ${result.insertedRows} 条；地图与优先级正在后台刷新。`)
    schedulePolling()
  } catch (cause) {
    setFeedback('', getUserErrorMessage(cause, '发布失败'))
  } finally { busy.value = '' }
}

async function retryJob(job: UploadRefreshJob) {
  if (!selectedUploadId.value) return
  busy.value = `job-${job.jobId}`
  try {
    await retryRefreshJob(selectedUploadId.value, job.jobType)
    await loadRefreshJobs()
    schedulePolling()
  } catch (cause) { setFeedback('', getUserErrorMessage(cause, '重试失败')) }
  finally { busy.value = '' }
}

async function loadPermissions() {
  if (!isAdmin(user.value)) return
  try {
    const [users, requests] = await Promise.all([fetchUsers({ page: 1, size: 50 }), fetchDictionaryChanges()])
    permissions.value = users
    dictionaryRequests.value = requests
  }
  catch (cause) { setFeedback('', getUserErrorMessage(cause, '权限列表加载失败')) }
}

function prepareDictionaryRequest(record: UploadReviewRecord, field?: string) {
  dictionaryDraft.rowId = String(record.rowId)
  dictionaryDraft.dictionaryType = field ? (dictionaryTypeByField[field] ?? 'TARGET_CATEGORY') : 'TARGET_CATEGORY'
  dictionaryDraft.proposedLabel = field ? (record.standardized[field] ?? '') : ''
  document.getElementById('dictionary-request')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

async function submitDictionaryRequest() {
  if (!selectedUploadId.value || !dictionaryDraft.proposedLabel.trim() || !dictionaryDraft.evidence.trim()) return
  busy.value = 'dictionary-request'
  try {
    await requestDictionaryChange(selectedUploadId.value, {
      rowId: dictionaryDraft.rowId ? Number(dictionaryDraft.rowId) : undefined,
      dictionaryType: dictionaryDraft.dictionaryType,
      proposedCode: dictionaryDraft.proposedCode,
      proposedLabel: dictionaryDraft.proposedLabel,
      evidence: dictionaryDraft.evidence,
    })
    dictionaryDraft.proposedCode = ''; dictionaryDraft.proposedLabel = ''; dictionaryDraft.evidence = ''
    setFeedback('字典变更申请已提交，管理员批准前不会成为正式值。')
  } catch (cause) { setFeedback('', getUserErrorMessage(cause, '字典申请提交失败')) }
  finally { busy.value = '' }
}

async function decideDictionaryRequest(item: UploadDictionaryChange, approved: boolean) {
  const reason = dictionaryDecisionReasons[item.requestId]?.trim()
  if (!reason) {
    setFeedback('', '审批字典申请必须填写依据或驳回原因。')
    return
  }
  busy.value = `dictionary-${item.requestId}`
  try {
    await reviewDictionaryChange(item.requestId, approved, reason)
    dictionaryRequests.value = dictionaryRequests.value.filter((request) => request.requestId !== item.requestId)
    delete dictionaryDecisionReasons[item.requestId]
    Object.keys(canonicalTerms).forEach((key) => delete canonicalTerms[key])
    setFeedback(`字典申请已${approved ? '批准' : '驳回'}。`)
  } catch (cause) { setFeedback('', getUserErrorMessage(cause, '字典申请审批失败')) }
  finally { busy.value = '' }
}

async function savePermissions(item: UserResponse) {
  busy.value = `user-${item.userId}`
  try {
    const updated = await updateUserPermissions(item.userId, {
      role: item.role, canUpload: item.canUpload, canReviewUploads: item.canReviewUploads,
      canSyncData: item.canSyncData, canDownload: item.canDownload,
    })
    const index = permissions.value?.items.findIndex((candidate) => candidate.userId === item.userId) ?? -1
    if (index >= 0 && permissions.value) permissions.value.items[index] = updated
    setFeedback(`${updated.username} 的权限已更新。`)
  } catch (cause) { setFeedback('', getUserErrorMessage(cause, '权限更新失败')) }
  finally { busy.value = '' }
}

onMounted(async () => {
  await loadBatches()
  const first = batches.value[0]
  if (first) await selectBatch(first.uploadId)
})
onBeforeUnmount(stopPolling)
</script>

<template>
  <div class="workspace-shell">
    <PlatformHeader active="data" variant="academic" />
    <main id="main-content" class="workspace-main">
      <header class="workspace-heading">
        <div>
          <p class="eyebrow">DATA GOVERNANCE WORKSPACE</p>
          <h1>数据上传与规范审核</h1>
          <p>以 DOI 为审计边界，保留原始证据，分别判断核心库、地图和桑基图准入。</p>
        </div>
        <button class="button secondary" type="button" @click="guideOpen = !guideOpen">
          {{ guideOpen ? '收起操作说明' : '查看操作说明' }}
        </button>
      </header>

      <nav class="workspace-tabs" aria-label="数据工作台">
        <button :class="{ active: activeTab === 'workflow' }" @click="activeTab = 'workflow'">上传工作流</button>
        <button :class="{ active: activeTab === 'batches' }" @click="activeTab = 'batches'">批次记录</button>
        <button v-if="isAdmin(user)" :class="{ active: activeTab === 'permissions' }" @click="activeTab = 'permissions'; loadPermissions()">角色与权限</button>
      </nav>

      <p v-if="notice" class="feedback success" role="status">{{ notice }}</p>
      <p v-if="error" class="feedback failure" role="alert">{{ error }}</p>

      <template v-if="activeTab === 'workflow'">
        <section class="stage-rail" aria-label="四阶段流程">
          <button v-for="(stage, index) in stages" :key="stage.number" :class="{ active: activeStage === index + 1, done: activeStage > index + 1 }" @click="activeStage = index + 1">
            <span>{{ stage.number }}</span><strong>{{ stage.title }}</strong><small>{{ stage.detail }}</small>
          </button>
        </section>

        <aside v-if="guideOpen" class="guide-panel">
          <strong>快速规则</strong>
          <p>DOI 必填且会规范化为小写；正式库已有 DOI 整组跳过；一组中任一行阻断错误会暂缓该组，不影响其他合格组。</p>
          <p>地图只接收已确认点位、正值 PNDL 及可换算单位；桑基图只接收完整 ICD-11 路径与可追溯证据。不合格的映射不会阻止合格核心记录发布。</p>
        </aside>

        <section v-if="activeStage === 1" class="panel preparation-panel">
          <div class="panel-heading"><div><p class="section-kicker">STEP 01</p><h2>准备 SUBMISSION_V2</h2></div><button class="button secondary" :disabled="!canUpload" @click="downloadUploadTemplate">下载三表模板</button></div>
          <div class="instruction-grid">
            <article><strong>1. 仅填“数据”表</strong><p>“填写说明”和受保护的“词典”表不需修改。</p></article>
            <article><strong>2. 一行一个指标值</strong><p>同 DOI 可有多行，不要把多种指标合并在一格。</p></article>
            <article><strong>3. 保留原始表达</strong><p>ND、&lt;LOD、&lt;LOQ 与原单位照实填写，不要自行改成 0。</p></article>
            <article><strong>4. 证据可定位</strong><p>请给出页码、表号、Sheet 或图号及原文证据。</p></article>
          </div>
          <div class="upload-row">
            <input ref="uploadInput" class="sr-only" type="file" accept=".xlsx" @change="chooseFile($event)" />
            <button class="file-picker" type="button" :disabled="!canUpload" @click="uploadInput?.click()">
              <span>{{ selectedFile ? '已选文件' : '选择 .xlsx 文件' }}</span><strong>{{ selectedFile?.name ?? '限 50MB、5,000 数据行、禁止宏与公式' }}</strong>
            </button>
            <button class="button primary" :disabled="!selectedFile || busy === 'upload'" @click="startUpload()">{{ busy === 'upload' ? '正在接收…' : '上传并开始校验' }}</button>
          </div>
        </section>

        <section v-else-if="activeStage === 2" class="panel">
          <div class="panel-heading"><div><p class="section-kicker">STEP 02</p><h2>按 DOI 分组校验</h2><p>{{ processing?.message ?? '请先选择或上传批次' }}</p></div><span v-if="processing" class="status-chip">{{ processing.userStatus }}</span></div>
          <div v-if="processing" class="metric-strip">
            <article><span>已处理</span><strong>{{ processing.processedRows }} / {{ processing.totalRows }}</strong></article>
            <article><span>合格 DOI</span><strong>{{ processing.readyDoiGroups }}</strong></article>
            <article><span>暂缓 DOI</span><strong>{{ processing.heldDoiGroups }}</strong></article>
            <article><span>重复跳过</span><strong>{{ processing.duplicateDoiGroups }}</strong></article>
          </div>
          <div v-if="processing?.internalStatus === 'PROCESSING'" class="progress-track" :aria-label="processing.message ?? '处理进度'"><span :style="{ width: `${processing.totalRows ? Math.max(6, processing.processedRows / processing.totalRows * 100) : 8}%` }"></span></div>
          <div class="table-wrap" v-if="processing?.groups.length">
            <table><thead><tr><th>DOI</th><th>结果</th><th>总行数</th><th>可用</th><th>错误</th><th>组内重复</th><th>说明</th></tr></thead>
              <tbody><tr v-for="group in processing.groups" :key="group.groupId"><td class="mono">{{ group.normalizedDoi }}</td><td><span class="group-state" :data-state="group.status">{{ groupLabel(group.status) }}</span></td><td>{{ group.totalRows }}</td><td>{{ group.validRows }}</td><td>{{ group.errorRows }}</td><td>{{ group.duplicateRows }}</td><td>{{ group.issueSummary || group.duplicateOfLiteratureCode || '—' }}</td></tr></tbody>
            </table>
          </div>
          <div class="action-bar">
            <button v-if="hasAction('DOWNLOAD_ISSUES') && selectedUploadId" class="button secondary" @click="downloadUploadIssues(selectedUploadId)">下载问题与重复组</button>
            <button v-if="hasAction('SUBMIT_READY_GROUPS')" class="button primary" :disabled="busy === 'submit'" @click="submitGroups">{{ processing?.groups.some(group => group.status === 'RESERVATION_CONFLICT') ? '重试 DOI 预约' : '提交合格 DOI 组' }}</button>
          </div>
          <div v-if="hasAction('DOWNLOAD_ISSUES')" class="correction-box">
            <div><strong>修正后不覆盖原批次</strong><p>下载问题文件修正后上传，系统会建立关联新批次。</p></div>
            <input ref="correctionInput" class="sr-only" type="file" accept=".xlsx" @change="chooseFile($event, true)" />
            <button class="button text" @click="correctionInput?.click()">{{ correctionFile?.name ?? '选择修订文件' }}</button>
            <button class="button secondary" :disabled="!correctionFile || busy === 'correction'" @click="startUpload(true)">创建修订批次</button>
          </div>
        </section>

        <section v-else-if="activeStage === 3" class="panel review-panel">
          <div class="panel-heading"><div><p class="section-kicker">STEP 03</p><h2>网页规范化审核</h2><p>上传者不能审核自己的批次；管理员覆盖必须留下原因。</p></div><span class="status-chip">{{ processing?.userStatus }}</span></div>
          <p v-if="!canReviewSelected" class="empty-state">当前账号可查看进度，但没有该批次的规范审核权限；上传者不能审核自己的批次。</p>
          <article v-for="record in canReviewSelected ? reviewRecords : []" :key="record.rowId" class="review-record">
            <header><div><span class="mono">{{ record.normalizedDoi }}</span><strong>第 {{ record.excelRowNumber }} 行 · V{{ record.reviewVersion }}</strong></div><div class="record-actions"><input v-model.trim="recordAuditReasons[record.rowId]" aria-label="审核依据" placeholder="审核依据（必填）" /><button class="button text compact" @click="prepareDictionaryRequest(record)">申请新规范值</button><button class="button secondary compact" :disabled="busy === `row-${record.rowId}`" @click="saveRecord(record)">保存本条</button></div></header>
            <div class="comparison-grid">
              <section class="raw-column"><h3>原值</h3><dl><template v-for="field in rawDisplayFields" :key="field"><dt>{{ field }}</dt><dd>{{ record.raw[field] || '—' }}</dd></template></dl></section>
              <section class="standard-column"><h3>标准值</h3><div class="field-grid"><label v-for="field in standardFields" :key="field"><span>{{ field }}</span><input v-model.trim="record.standardized[field]" :list="dataListId(field)" /></label></div><details><summary>采样与分析方法</summary><div class="field-grid"><label v-for="field in methodFields" :key="field"><span>{{ field }}</span><input v-model.trim="record.standardized[field]" /></label></div></details></section>
            </div>
            <section class="mapping-section"><h3>点位规范化</h3><div class="field-grid"><label v-for="field in siteFields" :key="field"><span>{{ field }}</span><input v-model.trim="record.standardized[field]" :list="dataListId(field)" /></label></div></section>
            <section class="mapping-section"><h3>ICD-11 桑基映射</h3><p class="hint">编码是规范键，名称与映射深度由审核后的层级字典派生。</p><div class="field-grid"><label v-for="field in sankeyFields" :key="field"><span>{{ field }}</span><input v-model.trim="record.standardized[field]" :list="dataListId(field)" /></label></div></section>
            <div class="eligibility-grid">
              <label><span><input v-model="record.coreEligible" type="checkbox" /> 核心库可进入</span><input v-if="!record.coreEligible" v-model.trim="record.coreExclusionReason" placeholder="排除原因（必填）" /></label>
              <label><span><input v-model="record.mapEligible" type="checkbox" /> 地图可进入</span><input v-if="!record.mapEligible" v-model.trim="record.mapExclusionReason" placeholder="待映射 / 不适用 / 排除原因" /></label>
              <label><span><input v-model="record.sankeyEligible" type="checkbox" /> 桑基图可进入</span><input v-if="!record.sankeyEligible" v-model.trim="record.sankeyExclusionReason" placeholder="待映射 / 不适用 / 排除原因" /></label>
            </div>
          </article>
          <form v-if="canReviewSelected" id="dictionary-request" class="dictionary-request" @submit.prevent="submitDictionaryRequest">
            <div><strong>规范字典变更申请</strong><p>新分类、单位、地点别名或 ICD-11 值必须经管理员批准后才可用于发布。</p></div>
            <label><span>关联行 ID</span><input v-model.trim="dictionaryDraft.rowId" inputmode="numeric" /></label>
            <label><span>字典类型</span><select v-model="dictionaryDraft.dictionaryType"><option v-for="type in dictionaryTypes" :key="type" :value="type">{{ type }}</option><option value="LOCATION_ALIAS">LOCATION_ALIAS</option></select></label>
            <label><span>候选编码</span><input v-model.trim="dictionaryDraft.proposedCode" /></label>
            <label><span>候选名称</span><input v-model.trim="dictionaryDraft.proposedLabel" required /></label>
            <label class="evidence-field"><span>证据与申请理由</span><textarea v-model.trim="dictionaryDraft.evidence" rows="2" required></textarea></label>
            <button class="button secondary" :disabled="busy === 'dictionary-request'">提交字典申请</button>
          </form>
          <div v-if="reviewPage && reviewPage.total > reviewPage.size" class="pagination"><button class="button text" :disabled="reviewPage.page <= 1" @click="loadReview(reviewPage.page - 1)">上一页</button><span>{{ reviewPage.page }} / {{ Math.ceil(reviewPage.total / reviewPage.size) }}</span><button class="button text" :disabled="reviewPage.page >= Math.ceil(reviewPage.total / reviewPage.size)" @click="loadReview(reviewPage.page + 1)">下一页</button></div>
          <div v-if="canReviewSelected" class="review-complete"><label><span>审核备注</span><textarea v-model.trim="reviewNote" rows="2" placeholder="记录整体审核结论"></textarea></label><label v-if="selfReview && isAdmin(user)"><span>管理员覆盖原因</span><textarea v-model.trim="overrideReason" rows="2" placeholder="必填：说明为何无法由其他人审核"></textarea></label><button class="button primary" :disabled="busy === 'complete'" @click="completeReview">完成审核并冻结版本</button></div>
          <div class="workflow-secondary-actions">
            <label v-if="canReviewSelected"><span>退回原因</span><input v-model.trim="reviewReturnReason" placeholder="说明需要上传者修正的内容" /></label>
            <button v-if="canReviewSelected" class="button danger" :disabled="busy === 'return-review'" @click="returnReview">退回修正</button>
            <label v-if="selectedBatch?.uploadedBy === user?.userId"><span>撤回原因</span><input v-model.trim="cancellationReason" placeholder="撤回后可重新提交合格组" /></label>
            <button v-if="selectedBatch?.uploadedBy === user?.userId" class="button text" :disabled="busy === 'cancel-submission'" @click="cancelSubmission">撤回本次提交</button>
          </div>
        </section>

        <section v-else class="panel publish-panel">
          <div class="panel-heading"><div><p class="section-kicker">STEP 04</p><h2>增量发布与派生刷新</h2><p>发布只新增已预约 DOI 组，不删除已有事实。</p></div><span v-if="processing" class="status-chip">{{ processing.userStatus }}</span></div>
          <div class="publish-summary"><article><span>待发布 DOI</span><strong>{{ processing?.reservedDoiGroups ?? 0 }}</strong></article><article><span>核心候选行</span><strong>{{ reviewPage?.total ?? selectedBatch?.validRows ?? 0 }}</strong></article><article><span>问题/重复组</span><strong>{{ (processing?.heldDoiGroups ?? 0) + (processing?.duplicateDoiGroups ?? 0) }}</strong></article></div>
          <div class="release-note"><strong>发布边界</strong><p>核心事实在一个事务内写入。地图与优先级在事务后构建新版本；如刷新失败，旧版仍可查询，核心数据不回滚。</p></div>
          <button v-if="processing?.internalStatus === 'READY_TO_PUBLISH'" class="button primary" :disabled="!canPublish || busy === 'publish'" @click="publish">{{ canPublish ? '确认并发布新 DOI 组' : '当前账号没有发布权限' }}</button>
          <div v-if="processing?.internalStatus === 'READY_TO_PUBLISH' && selectedBatch?.uploadedBy === user?.userId" class="workflow-secondary-actions">
            <label><span>撤回原因</span><input v-model.trim="cancellationReason" placeholder="发布前仍可撤回并释放 DOI 预约" /></label>
            <button class="button text" :disabled="busy === 'cancel-submission'" @click="cancelSubmission">撤回本次提交</button>
          </div>
          <div v-if="processing?.internalStatus === 'PARTIALLY_PUBLISHED'" class="correction-box">
            <div><strong>合格组已发布，问题组待修订</strong><p>修正后会创建关联新批次，原批次的审计记录保持不变。</p></div>
            <button class="button secondary" @click="selectedUploadId && downloadUploadIssues(selectedUploadId)">下载问题组</button>
            <input ref="correctionInput" class="sr-only" type="file" accept=".xlsx" @change="chooseFile($event, true)" />
            <button class="button text" @click="correctionInput?.click()">{{ correctionFile?.name ?? '选择修订文件' }}</button>
            <button class="button secondary" :disabled="!correctionFile || busy === 'correction'" @click="startUpload(true)">创建修订批次</button>
          </div>
          <div v-if="refreshJobs.length" class="refresh-list"><article v-for="job in refreshJobs" :key="job.jobId"><div><strong>{{ refreshLabel(job) }}</strong><small>版本 {{ job.versionNo }}<template v-if="job.scoreVersion"> · {{ job.scoreVersion }}</template></small><p v-if="job.errorMessage">{{ job.errorMessage }}</p></div><button v-if="job.status === 'FAILED' && isAdmin(user)" class="button secondary compact" :disabled="busy === `job-${job.jobId}`" @click="retryJob(job)">重试</button></article></div>
        </section>
      </template>

      <section v-else-if="activeTab === 'batches'" class="panel">
        <div class="panel-heading"><div><p class="section-kicker">AUDIT TRAIL</p><h2>批次与审计记录</h2></div><button class="button secondary" @click="loadBatches">刷新</button></div>
        <div class="batch-list"><button v-for="batch in batches" :key="batch.uploadId" @click="selectBatch(batch.uploadId)"><span class="batch-id">#{{ batch.uploadId }}</span><span><strong>{{ batch.fileName }}</strong><small>{{ batch.uploadedByName }} · {{ batch.createdAt?.replace('T', ' ') }}</small></span><span class="status-chip">{{ statusLabel(batch.status) }}</span><span class="batch-count">{{ batch.totalRows }} 行</span></button></div>
        <div class="pagination" v-if="batchTotalPages > 1"><button class="button text" :disabled="batchPage <= 1" @click="batchPage--; loadBatches()">上一页</button><span>{{ batchPage }} / {{ batchTotalPages }}</span><button class="button text" :disabled="batchPage >= batchTotalPages" @click="batchPage++; loadBatches()">下一页</button></div>
      </section>

      <section v-else class="panel">
        <div class="panel-heading"><div><p class="section-kicker">SEPARATION OF DUTIES</p><h2>角色与权限</h2><p>上传、审核、发布分别授权，canSyncData 是发布的唯一入口。</p></div></div>
        <div class="table-wrap"><table><thead><tr><th>用户</th><th>角色</th><th>上传</th><th>审核</th><th>发布</th><th>下载</th><th></th></tr></thead><tbody><tr v-for="item in permissions?.items ?? []" :key="item.userId"><td><strong>{{ item.username }}</strong><small>{{ item.email }}</small></td><td><select v-model="item.role"><option value="viewer">普通用户</option><option value="editor">数据维护员</option><option value="admin">管理员</option></select></td><td><input v-model="item.canUpload" type="checkbox" /></td><td><input v-model="item.canReviewUploads" type="checkbox" /></td><td><input v-model="item.canSyncData" type="checkbox" /></td><td><input v-model="item.canDownload" type="checkbox" /></td><td><button class="button secondary compact" :disabled="busy === `user-${item.userId}`" @click="savePermissions(item)">保存</button></td></tr></tbody></table></div>
        <div class="dictionary-admin"><h3>待审批字典变更</h3><p v-if="!dictionaryRequests.length" class="hint">当前没有待审批申请。</p><article v-for="item in dictionaryRequests" :key="item.requestId"><div><strong>{{ item.dictionaryType }} · {{ item.proposedLabel }}</strong><small>批次 #{{ item.uploadId }}<template v-if="item.rowId"> · 行 {{ item.rowId }}</template></small><p>{{ item.evidence }}</p></div><div class="dictionary-actions"><input v-model.trim="dictionaryDecisionReasons[item.requestId]" placeholder="审批依据 / 驳回原因" /><span><button class="button text" @click="decideDictionaryRequest(item, false)">驳回</button><button class="button secondary compact" @click="decideDictionaryRequest(item, true)">批准</button></span></div></article></div>
      </section>
      <datalist v-for="type in dictionaryTypes" :id="`terms-${type}`" :key="type"><option v-for="term in canonicalTerms[type] ?? []" :key="term.termId" :value="termValue(type, term)">{{ term.label }}</option></datalist>
    </main>
  </div>
</template>

<style scoped>
.workspace-shell { min-height: 100vh; background: #f4f7f9; color: #10283b; }
.workspace-main { width: min(1440px, calc(100% - 48px)); margin: 0 auto; padding: 42px 0 80px; }
.workspace-heading { display: flex; align-items: end; justify-content: space-between; gap: 28px; margin-bottom: 28px; }
.workspace-heading h1 { margin: 5px 0 9px; color: #092d4a; font-size: clamp(30px, 4vw, 46px); line-height: 1.08; letter-spacing: -.035em; }
.workspace-heading p:not(.eyebrow), .panel-heading p, .guide-panel p, .instruction-grid p, .correction-box p, .release-note p { margin: 0; color: #607585; line-height: 1.7; }
.eyebrow, .section-kicker { margin: 0; color: #176e9d; font-size: 11px; font-weight: 800; letter-spacing: .15em; }
.workspace-tabs { display: flex; gap: 24px; border-bottom: 1px solid #cbd8df; margin-bottom: 22px; }
.workspace-tabs button { padding: 13px 2px 11px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #627584; font-weight: 700; cursor: pointer; }
.workspace-tabs button.active { border-color: #0f6591; color: #0b4164; }
.stage-rail { display: grid; grid-template-columns: repeat(4, 1fr); margin-bottom: 18px; border: 1px solid #d6e0e6; background: #fff; }
.stage-rail button { display: grid; grid-template-columns: 34px 1fr; gap: 2px 10px; padding: 17px 18px; border: 0; border-right: 1px solid #e0e7eb; background: #fff; color: #687b88; text-align: left; cursor: pointer; }
.stage-rail button:last-child { border-right: 0; }
.stage-rail button > span { grid-row: span 2; color: #92a1aa; font-size: 12px; font-weight: 800; }
.stage-rail strong { color: #29485d; font-size: 14px; }
.stage-rail small { line-height: 1.45; }
.stage-rail button.active { box-shadow: inset 0 3px #0f6591; background: #f6fafc; }
.stage-rail button.done > span, .stage-rail button.active > span { color: #0f6591; }
.guide-panel { display: grid; grid-template-columns: 130px 1fr 1fr; gap: 22px; margin-bottom: 18px; padding: 16px 20px; border: 1px solid #c8dbe5; border-left: 3px solid #0f6591; background: #eef6fa; }
.panel { padding: 26px; border: 1px solid #d6e0e6; border-radius: 9px; background: #fff; }
.panel-heading { display: flex; justify-content: space-between; align-items: start; gap: 24px; margin-bottom: 22px; }
.panel-heading h2 { margin: 4px 0 6px; color: #0b3654; font-size: 23px; }
.button { min-height: 40px; padding: 0 17px; border: 1px solid transparent; border-radius: 8px; font: inherit; font-size: 13px; font-weight: 750; cursor: pointer; }
.button.primary { background: #0f6591; color: #fff; }
.button.primary:hover { background: #0b5379; }
.button.secondary { border-color: #8fabb9; background: #fff; color: #174d6d; }
.button.text { padding-inline: 4px; background: transparent; color: #0f6591; }
.button.danger { border-color: #a95b4c; background: #a94f40; color: #fff; }
.button.compact { min-height: 34px; padding-inline: 12px; }
.button:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 3px solid rgba(22, 117, 166, .25); outline-offset: 2px; }
.button:disabled, button:disabled { opacity: .5; cursor: not-allowed; }
.instruction-grid { display: grid; grid-template-columns: repeat(4, 1fr); border-block: 1px solid #e1e8ec; }
.instruction-grid article { min-height: 118px; padding: 18px; border-right: 1px solid #e1e8ec; }
.instruction-grid article:last-child { border-right: 0; }
.instruction-grid strong { color: #173d56; }
.instruction-grid p { margin-top: 8px; font-size: 13px; }
.upload-row { display: grid; grid-template-columns: 1fr auto; gap: 12px; margin-top: 22px; }
.file-picker { display: flex; align-items: center; justify-content: space-between; gap: 20px; min-height: 58px; padding: 9px 16px; border: 1px dashed #88a9ba; border-radius: 8px; background: #f8fbfc; color: #31566d; text-align: left; cursor: pointer; }
.file-picker strong { overflow: hidden; color: #758995; font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.metric-strip, .publish-summary { display: grid; grid-template-columns: repeat(4, 1fr); margin-bottom: 20px; border: 1px solid #dce5ea; }
.metric-strip article, .publish-summary article { padding: 16px 18px; border-right: 1px solid #dce5ea; }
.metric-strip article:last-child, .publish-summary article:last-child { border-right: 0; }
.metric-strip span, .publish-summary span { display: block; color: #728590; font-size: 12px; }
.metric-strip strong, .publish-summary strong { display: block; margin-top: 7px; color: #103d5b; font-size: 24px; }
.progress-track { height: 5px; margin: -8px 0 18px; background: #e5edf1; }
.progress-track span { display: block; height: 100%; background: #0f6591; transition: width .25s; }
.table-wrap { overflow-x: auto; border: 1px solid #dce5ea; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { padding: 11px 13px; background: #f3f7f9; color: #496272; text-align: left; white-space: nowrap; }
td { padding: 12px 13px; border-top: 1px solid #e2e8ec; color: #344f60; vertical-align: top; }
td small { display: block; margin-top: 3px; color: #8797a1; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.status-chip, .group-state { display: inline-flex; padding: 5px 9px; border: 1px solid #b9cbd4; border-radius: 999px; background: #f7fafb; color: #365a70; font-size: 11px; font-weight: 750; white-space: nowrap; }
.group-state[data-state='READY'], .group-state[data-state='PUBLISHED'] { border-color: #92bea9; color: #276647; }
.group-state[data-state='HELD_ERROR'] { border-color: #d2aa80; color: #89511e; }
.group-state[data-state='DUPLICATE_DATABASE'] { color: #6e7280; }
.action-bar { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.correction-box { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 16px; margin-top: 20px; padding: 16px; border: 1px solid #dbe4e9; background: #f8fafb; }
.review-record { margin-top: 18px; border: 1px solid #d7e1e6; border-radius: 8px; overflow: hidden; }
.review-record > header { display: flex; justify-content: space-between; align-items: center; padding: 13px 16px; background: #edf4f7; }
.review-record > header div { display: flex; gap: 16px; align-items: center; }
.review-record > header .record-actions { justify-content: flex-end; }
.record-actions > input { width: min(250px, 28vw); }
.comparison-grid { display: grid; grid-template-columns: .8fr 1.2fr; }
.comparison-grid > section { padding: 18px; }
.raw-column { border-right: 1px solid #dfe7eb; background: #fbfcfd; }
.review-record h3 { margin: 0 0 14px; color: #174a69; font-size: 14px; }
dl { display: grid; grid-template-columns: 120px 1fr; gap: 7px 12px; margin: 0; font-size: 12px; }
dt { color: #7b8e99; } dd { margin: 0; color: #294657; overflow-wrap: anywhere; }
.field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
label > span { display: block; margin-bottom: 5px; color: #596f7d; font-size: 12px; font-weight: 700; }
input:not([type='checkbox']), textarea, select { width: 100%; min-height: 38px; padding: 8px 10px; border: 1px solid #bdcdd6; border-radius: 7px; background: #fff; color: #1f3b4d; font: inherit; box-sizing: border-box; }
textarea { resize: vertical; }
details { margin-top: 14px; } summary { margin-bottom: 12px; color: #24617f; cursor: pointer; font-size: 13px; font-weight: 700; }
.mapping-section { padding: 18px; border-top: 1px solid #e0e7eb; }
.hint { margin: -8px 0 12px; color: #758894; font-size: 12px; }
.eligibility-grid { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid #dfe7eb; }
.eligibility-grid > label { padding: 16px; border-right: 1px solid #dfe7eb; }
.eligibility-grid > label:last-child { border-right: 0; }
.eligibility-grid input:not([type='checkbox']) { margin-top: 8px; }
.review-complete { display: grid; grid-template-columns: 1fr 1fr auto; align-items: end; gap: 14px; margin-top: 22px; padding: 18px; border: 1px solid #b9d0dc; background: #f1f7fa; }
.workflow-secondary-actions { display: flex; align-items: end; justify-content: flex-end; gap: 12px; margin-top: 14px; }
.workflow-secondary-actions label { width: min(420px, 100%); }
.dictionary-request { display: grid; grid-template-columns: 1.3fr .55fr 1fr 1fr 1fr auto; align-items: end; gap: 12px; margin-top: 20px; padding: 16px; border: 1px solid #d5e1e7; background: #f8fafb; }
.dictionary-request p { margin: 5px 0 0; color: #718590; font-size: 12px; line-height: 1.5; }
.dictionary-request .evidence-field { grid-column: span 2; }
.dictionary-admin { margin-top: 26px; padding-top: 22px; border-top: 1px solid #dce5ea; }
.dictionary-admin h3 { color: #174a69; font-size: 16px; }
.dictionary-admin article { display: flex; justify-content: space-between; gap: 20px; padding: 14px 0; border-top: 1px solid #e1e8ec; }
.dictionary-actions { display: grid; min-width: min(360px, 40vw); gap: 8px; }
.dictionary-actions > span { display: flex; justify-content: flex-end; gap: 8px; }
.dictionary-admin small { display: block; margin-top: 4px; color: #80919b; }
.dictionary-admin p { margin: 7px 0 0; color: #526b7a; }
.publish-summary { grid-template-columns: repeat(3, 1fr); }
.release-note { margin-bottom: 20px; padding: 16px 18px; border-left: 3px solid #0f6591; background: #f2f7f9; }
.refresh-list { display: grid; gap: 10px; margin-top: 20px; }
.refresh-list article { display: flex; justify-content: space-between; gap: 20px; padding: 14px 16px; border: 1px solid #d9e3e8; }
.refresh-list small { display: block; margin-top: 4px; color: #788c98; }
.refresh-list p { margin: 6px 0 0; color: #9a4e32; }
.batch-list { border: 1px solid #dce5ea; }
.batch-list > button { display: grid; grid-template-columns: 70px 1fr auto 80px; align-items: center; gap: 14px; width: 100%; padding: 14px 16px; border: 0; border-bottom: 1px solid #e1e8ec; background: #fff; color: #2b485a; text-align: left; cursor: pointer; }
.batch-list > button:last-child { border-bottom: 0; }
.batch-list > button:hover { background: #f5f9fb; }
.batch-list small { display: block; margin-top: 4px; color: #81929c; }
.batch-id, .batch-count { color: #6e828f; font-size: 12px; }
.pagination { display: flex; align-items: center; justify-content: center; gap: 18px; margin-top: 18px; color: #667b88; font-size: 12px; }
.feedback { margin: 0 0 16px; padding: 11px 14px; border-left: 3px solid; background: #fff; font-size: 13px; }
.feedback.success { border-color: #3a8b65; color: #256246; } .feedback.failure { border-color: #b75a3b; color: #8e3f27; }
.empty-state { padding: 28px; border: 1px dashed #b9cbd4; color: #6f818c; text-align: center; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

@media (max-width: 1024px) {
  .workspace-main { width: min(100% - 32px, 1100px); }
  .stage-rail { grid-template-columns: repeat(2, 1fr); }
  .stage-rail button:nth-child(2) { border-right: 0; }
  .stage-rail button:nth-child(-n+2) { border-bottom: 1px solid #e0e7eb; }
  .guide-panel { grid-template-columns: 1fr 1fr; } .guide-panel strong { grid-column: 1 / -1; }
  .instruction-grid { grid-template-columns: repeat(2, 1fr); }
  .instruction-grid article:nth-child(2) { border-right: 0; }
  .instruction-grid article:nth-child(-n+2) { border-bottom: 1px solid #e1e8ec; }
  .comparison-grid { grid-template-columns: 1fr; } .raw-column { border-right: 0; border-bottom: 1px solid #dfe7eb; }
  .review-complete { grid-template-columns: 1fr 1fr; } .review-complete .button { grid-column: 1 / -1; }
  .workflow-secondary-actions { flex-wrap: wrap; }
  .dictionary-request { grid-template-columns: repeat(2, 1fr); } .dictionary-request > div, .dictionary-request .evidence-field { grid-column: 1 / -1; }
  .review-record > header { align-items: flex-start; } .review-record > header .record-actions { flex-wrap: wrap; }
}

@media (max-width: 640px) {
  .workspace-main { width: calc(100% - 24px); padding-top: 24px; }
  .workspace-heading { display: block; } .workspace-heading .button { margin-top: 16px; }
  .workspace-tabs { gap: 14px; overflow-x: auto; }
  .stage-rail { display: flex; overflow-x: auto; } .stage-rail button { min-width: 220px; border-bottom: 0 !important; }
  .guide-panel, .instruction-grid, .metric-strip, .publish-summary, .eligibility-grid, .review-complete, .dictionary-request { grid-template-columns: 1fr; }
  .guide-panel strong { grid-column: auto; }
  .instruction-grid article, .metric-strip article, .publish-summary article, .eligibility-grid > label { border-right: 0; border-bottom: 1px solid #e1e8ec; }
  .panel { padding: 18px; } .panel-heading { display: block; } .panel-heading > .button, .panel-heading > .status-chip { margin-top: 14px; }
  .upload-row, .correction-box { grid-template-columns: 1fr; }
  .file-picker { display: grid; }
  .field-grid { grid-template-columns: 1fr; }
  .workflow-secondary-actions { display: grid; justify-content: stretch; } .workflow-secondary-actions label { width: 100%; }
  .review-record > header { display: grid; gap: 12px; } .review-record > header .record-actions { display: grid; gap: 8px; } .record-actions > input { width: 100%; }
  .dictionary-admin article { display: grid; } .dictionary-actions { min-width: 0; }
  .dictionary-request > div, .dictionary-request .evidence-field { grid-column: auto; }
  dl { grid-template-columns: 90px 1fr; }
  .review-record > header { align-items: start; } .review-record > header div { display: grid; gap: 4px; }
  .batch-list > button { grid-template-columns: 52px 1fr; } .batch-list .status-chip, .batch-count { justify-self: start; }
}
</style>
