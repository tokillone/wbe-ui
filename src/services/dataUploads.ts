import { fetchBlob, requestApi } from './api'

export interface DataUploadBatch {
  uploadId: number
  fileName: string
  status: string
  uploadedBy: number
  uploadedByName: string
  uploadedByRole?: string | null
  totalRows: number
  validRows: number
  errorRows: number
  warningRows: number
  syncedRows: number
  duplicateMessage?: string | null
  createdAt?: string | null
  reviewedBy?: number | null
  reviewedByName?: string | null
  publishedReleaseId?: number | null
}

export interface DataUploadBatchPage {
  items: DataUploadBatch[]
  page: number
  size: number
  total: number
  totalPages: number
}

export interface UploadAccepted {
  uploadId: number
  status: string
  statusUrl: string
  reusedExistingBatch: boolean
}

export interface UploadDoiGroup {
  groupId: number
  normalizedDoi: string
  status: string
  totalRows: number
  validRows: number
  errorRows: number
  duplicateRows: number
  duplicateOfLiteratureCode?: string | null
  issueSummary?: string | null
}

export interface UploadProcessing {
  uploadId: number
  internalStatus: string
  userStatus: '校验中' | '待提交' | '审核中' | '待发布' | '已完成' | '需修正'
  stage?: string | null
  message?: string | null
  processedRows: number
  totalRows: number
  readyDoiGroups: number
  heldDoiGroups: number
  duplicateDoiGroups: number
  reservedDoiGroups: number
  groups: UploadDoiGroup[]
  availableActions: string[]
}

export interface UploadReviewRecord {
  rowId: number
  groupId: number
  excelRowNumber: number
  stableRowId: string
  normalizedDoi: string
  status: string
  raw: Record<string, string>
  standardized: Record<string, string>
  errors: string[]
  warnings: string[]
  coreEligible: boolean
  coreExclusionReason?: string | null
  mapEligible: boolean
  mapExclusionReason?: string | null
  sankeyEligible: boolean
  sankeyExclusionReason?: string | null
  reviewVersion: number
}

export interface UploadReviewPage {
  uploadId: number
  page: number
  size: number
  total: number
  records: UploadReviewRecord[]
}

export interface UploadReviewPatch {
  standardized: Record<string, string>
  coreEligible: boolean
  coreExclusionReason?: string
  mapEligible: boolean
  mapExclusionReason?: string
  sankeyEligible: boolean
  sankeyExclusionReason?: string
  reason: string
}

export interface UploadRefreshJob {
  jobId: number
  jobType: 'MAP' | 'CORE_PRIORITY'
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  versionNo: number
  scoreVersion?: string | null
  attemptCount: number
  errorMessage?: string | null
  startedAt?: string | null
  finishedAt?: string | null
}

export interface UploadCanonicalTerm {
  termId: number
  dictionaryType: string
  code: string
  label: string
  parentCode?: string | null
}

export interface UploadDictionaryChange {
  requestId: number
  uploadId: number
  rowId?: number | null
  dictionaryType: string
  proposedCode?: string | null
  proposedLabel: string
  evidence: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  requestedBy: number
  reviewedBy?: number | null
  reviewReason?: string | null
  createdAt?: string | null
  reviewedAt?: string | null
}

export interface DataUploadSyncResult {
  batch: DataUploadBatch
  insertedRows: number
  skippedRows: number
  insertedRowsBySheet: Record<string, number>
  warnings: string[]
}

export interface FetchUploadsParams {
  page?: number
  size?: number
  keyword?: string
  status?: string
  scope?: string
  uploaderType?: string
  sort?: string
}

export function uploadSubmission(file: File) {
  const body = new FormData()
  body.set('file', file)
  return requestApi<UploadAccepted>('/data-uploads', { method: 'POST', body })
}

export function uploadCorrection(sourceUploadId: number, file: File) {
  const body = new FormData()
  body.set('file', file)
  return requestApi<UploadAccepted>(`/data-uploads/${sourceUploadId}/corrections`, {
    method: 'POST', body,
  })
}

export function fetchUploadProcessing(uploadId: number) {
  return requestApi<UploadProcessing>(`/data-uploads/${uploadId}/processing`)
}

export function submitReadyDoiGroups(uploadId: number) {
  return requestApi<UploadProcessing>(`/data-uploads/${uploadId}/submit`, { method: 'POST' })
}

export function fetchReviewRecords(uploadId: number, page = 1, size = 20) {
  return requestApi<UploadReviewPage>(`/data-uploads/${uploadId}/review-records?page=${page}&size=${size}`)
}

export function patchReviewRecord(uploadId: number, rowId: number, patch: UploadReviewPatch) {
  return requestApi<UploadReviewRecord>(`/data-uploads/${uploadId}/review-records/${rowId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  })
}

export function completeUploadReview(uploadId: number, payload: { adminOverride?: boolean; overrideReason?: string; note?: string }) {
  return requestApi<UploadProcessing>(`/data-uploads/${uploadId}/review/complete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
}

export function returnUploadReview(uploadId: number, reason: string) {
  return requestApi<UploadProcessing>(`/data-uploads/${uploadId}/review/return`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
  })
}

export function cancelUploadSubmission(uploadId: number, reason: string) {
  return requestApi<UploadProcessing>(`/data-uploads/${uploadId}/submission/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
  })
}

export function publishUpload(uploadId: number) {
  return requestApi<DataUploadSyncResult>(`/data-uploads/${uploadId}/publish`, { method: 'POST' })
}

export function fetchRefreshJobs(uploadId: number) {
  return requestApi<UploadRefreshJob[]>(`/data-uploads/${uploadId}/refresh-jobs`)
}

export function retryRefreshJob(uploadId: number, jobType: UploadRefreshJob['jobType']) {
  return requestApi<void>(`/data-uploads/${uploadId}/refresh-jobs/${jobType}/retry`, { method: 'POST' })
}

export function fetchCanonicalTerms(type: string) {
  return requestApi<UploadCanonicalTerm[]>(`/data-uploads/dictionary-terms?type=${encodeURIComponent(type)}`)
}

export function requestDictionaryChange(uploadId: number, payload: {
  rowId?: number
  dictionaryType: string
  proposedCode?: string
  proposedLabel: string
  evidence: string
}) {
  return requestApi<UploadDictionaryChange>(`/data-uploads/${uploadId}/dictionary-change-requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
}

export function fetchDictionaryChanges(status = 'PENDING') {
  return requestApi<UploadDictionaryChange[]>(`/data-uploads/dictionary-change-requests?status=${encodeURIComponent(status)}`)
}

export function reviewDictionaryChange(requestId: number, approved: boolean, reason: string) {
  return requestApi<UploadDictionaryChange>(`/data-uploads/dictionary-change-requests/${requestId}/review`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved, reason }),
  })
}

export function fetchUploads(params: FetchUploadsParams = {}) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) search.set(key, String(value))
  })
  const query = search.toString()
  return requestApi<DataUploadBatchPage>(`/data-uploads${query ? `?${query}` : ''}`)
}

export function fetchUploadBatch(uploadId: number) {
  return requestApi<DataUploadBatch>(`/data-uploads/${uploadId}`)
}

async function download(endpoint: string, fileName: string, fallback: string) {
  const blob = await fetchBlob(endpoint, fallback)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

export function downloadUploadTemplate() {
  return download('/data-uploads/submission-template', 'WBE数据投稿模板-SUBMISSION_V2.xlsx', '模板下载失败')
}

export function downloadUploadIssues(uploadId: number) {
  return download(`/data-uploads/${uploadId}/issues.xlsx`, `WBE问题组修订-${uploadId}.xlsx`, '问题组下载失败')
}

export function downloadUploadFile(uploadId: number, fileName: string) {
  return download(`/data-uploads/${uploadId}/file`, fileName, '文件下载失败')
}
