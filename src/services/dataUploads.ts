import { authHeaders } from './session'

export interface DataUploadBatch {
  uploadId: number
  fileName: string
  status: string
  uploadedBy: number
  uploadedByName: string
  totalRows: number
  validRows: number
  errorRows: number
  warningRows: number
  syncedRows: number
  duplicateMessage?: string | null
  createdAt?: string | null
  syncedAt?: string | null
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

export interface DataUploadSyncResult {
  batch: DataUploadBatch
  insertedRows: number
  skippedRows: number
  warnings: string[]
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api'

async function requestDataUpload<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options?.headers ?? {}),
    },
  })
  const result = (await response.json().catch(() => null)) as ApiResponse<T> | null

  if (!response.ok || result?.code !== 200) {
    throw new Error(result?.message || '数据上传请求失败')
  }

  return result.data
}

export function uploadPreview(file: File) {
  const formData = new FormData()
  formData.set('file', file)
  return requestDataUpload<DataUploadPreview>('/data-uploads/preview', {
    method: 'POST',
    body: formData,
  })
}

export function syncUpload(uploadId: number) {
  return requestDataUpload<DataUploadSyncResult>(`/data-uploads/${uploadId}/sync`, {
    method: 'POST',
  })
}

export function rejectUpload(uploadId: number) {
  return requestDataUpload<DataUploadBatch>(`/data-uploads/${uploadId}/reject`, {
    method: 'POST',
  })
}

export function fetchUploads() {
  return requestDataUpload<DataUploadBatch[]>('/data-uploads')
}

export async function downloadUploadTemplate() {
  const response = await fetch(`${API_BASE_URL}/data-uploads/template`, {
    headers: authHeaders(),
  })
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(result?.message || '模板下载失败')
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'WBE数据上传模板.xlsx'
  link.click()
  URL.revokeObjectURL(url)
}

export function fetchUploadRows(uploadId: number, page = 1, size = 20) {
  const params = new URLSearchParams({ page: String(page), size: String(size) })
  return requestDataUpload<DataUploadRowsPage>(`/data-uploads/${uploadId}/rows?${params}`)
}

export async function downloadUploadFile(uploadId: number, fileName: string) {
  const response = await fetch(`${API_BASE_URL}/data-uploads/${uploadId}/file`, {
    headers: authHeaders(),
  })
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(result?.message || '文件下载失败')
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}
