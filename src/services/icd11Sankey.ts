import { requestApi } from './api'
import type { Icd11SankeyCategoryResponse, Icd11SankeyGraph } from '../types/icd11Sankey'

export function fetchIcd11SankeyCategories() {
  return requestApi<Icd11SankeyCategoryResponse>('/icd11-sankey/categories')
}

export function fetchIcd11SankeyGraph(category?: string, signal?: AbortSignal) {
  const params = new URLSearchParams()
  if (category) params.set('category', category)
  const suffix = params.toString() ? `?${params.toString()}` : ''
  return requestApi<Icd11SankeyGraph>(`/icd11-sankey/graph${suffix}`, { signal })
}
