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
  syncedAt?: string | null
  reviewedBy?: number | null
  reviewedByName?: string | null
  reviewedAt?: string | null
  reviewAction?: string | null
  reviewNote?: string | null
  syncedBy?: number | null
  syncedByName?: string | null
}

export interface DataUploadRow {
  rowId: number
  excelRowNumber: number
  status: string
  errors: string[]
  warnings: string[]
  syncedMeasurementId?: number | null
  data: Record<string, string>
}

export interface DataUploadPreview {
  batch: DataUploadBatch
  requiredHeaders: string[]
  optionalHeaders: string[]
  headerErrors: string[]
  batchWarnings: string[]
  previewRows: DataUploadRow[]
}

export interface DataUploadRowsPage {
  uploadId: number
  page: number
  size: number
  total: number
  rows: DataUploadRow[]
}

export interface DataUploadBatchPage {
  items: DataUploadBatch[]
  page: number
  size: number
  total: number
  totalPages: number
}

export interface DataUploadSyncResult {
  batch: DataUploadBatch
  insertedRows: number
  skippedRows: number
  warnings: string[]
}

export function uploadPreview(file: File) {
  const formData = new FormData()
  formData.set('file', file)
  return requestApi<DataUploadPreview>('/data-uploads/preview', {
    method: 'POST',
    body: formData,
  })
}

export function syncUpload(uploadId: number) {
  return requestApi<DataUploadSyncResult>(`/data-uploads/${uploadId}/sync`, {
    method: 'POST',
  })
}

export function rejectUpload(uploadId: number, reason?: string) {
  return requestApi<DataUploadBatch>(`/data-uploads/${uploadId}/reject`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason }),
  })
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

export function fetchUploads(params: FetchUploadsParams = {}) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      search.set(key, String(value))
    }
  })
  const query = search.toString()
  return requestApi<DataUploadBatchPage>(`/data-uploads${query ? `?${query}` : ''}`)
}

export async function downloadUploadTemplate() {
  const blob = await fetchBlob('/data-uploads/template', '模板下载失败')
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'WBE数据上传模板.xlsx'
  link.click()
  URL.revokeObjectURL(url)
}

export function fetchUploadRows(uploadId: number, page = 1, size = 20, status = 'all') {
  const params = new URLSearchParams({ page: String(page), size: String(size) })
  if (status !== 'all') {
    params.set('status', status)
  }
  return requestApi<DataUploadRowsPage>(`/data-uploads/${uploadId}/rows?${params}`)
}

export async function downloadUploadFile(uploadId: number, fileName: string) {
  const blob = await fetchBlob(`/data-uploads/${uploadId}/file`, '文件下载失败')
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}
