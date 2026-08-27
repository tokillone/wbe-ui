import { requestApi } from './api'
import type {
  Icd11SankeyCategoryResponse,
  Icd11SankeyGraph,
} from '../types/icd11Sankey'

export const ICD11_CATEGORY_TIMEOUT_MS = 10_000
export const ICD11_GRAPH_TIMEOUT_MS = 25_000

const normalizedGraphCache = new WeakMap<Icd11SankeyGraph, Icd11SankeyGraph>()

export function fetchIcd11SankeyCategories(signal?: AbortSignal) {
  return requestApi<Icd11SankeyCategoryResponse>('/icd11-sankey/categories?schema=all-level1-v1', {
    signal,
    timeoutMs: ICD11_CATEGORY_TIMEOUT_MS,
  })
}

export async function fetchIcd11SankeyGraph(category?: string, signal?: AbortSignal) {
  const params = new URLSearchParams()
  params.set('schema', 'all-level1-v1')
  if (category) params.set('category', category)
  const suffix = params.toString() ? `?${params.toString()}` : ''
  const graph = await requestApi<Icd11SankeyGraph>(`/icd11-sankey/graph-v2${suffix}`, {
    signal,
    timeoutMs: ICD11_GRAPH_TIMEOUT_MS,
  })
  return normalizeIcd11SankeyGraph(graph)
}

export function normalizeIcd11SankeyGraph(graph: Icd11SankeyGraph): Icd11SankeyGraph {
  const cached = normalizedGraphCache.get(graph)
  if (cached) return cached
  const paths = graph.paths.map((path) => ({
    ...path,
    mappingRows: Math.max(1, Number(path.mappingRows ?? 1)),
    level3: path.level3 || null,
    mappingLevel: path.level3 ? 'Level3' as const : 'Level2' as const,
  }))
  const allNodes = graph.nodes.map((node) => {
    if (node.kind === 'drug' && node.depth === 2) return { ...node, depth: 3 }
    if (node.kind === 'biomarker' && node.depth === 3) return { ...node, depth: 4 }
    return node
  })
  const depthCounts = [0, 1, 2, 3, 4].map(
    (depth) => allNodes.filter((node) => node.depth === depth).length,
  )
  const level2OnlyPaths = paths.filter((path) => path.mappingLevel === 'Level2')
  const level3Paths = paths.filter((path) => path.mappingLevel === 'Level3')

  const normalized = {
    ...graph,
    nodes: allNodes,
    paths,
    stats: {
      ...graph.stats,
      mappingRows: Number(graph.stats.mappingRows ?? graph.stats.relations ?? paths.length),
      level3: allNodes.filter((node) => node.kind === 'level3').length,
      maxNodes: Math.max(1, ...depthCounts),
      level2OnlyPaths: level2OnlyPaths.length,
      level3Paths: level3Paths.length,
      level2OnlyWeight: level2OnlyPaths.reduce((sum, path) => sum + Number(path.weight || 0), 0),
      level3Weight: level3Paths.reduce((sum, path) => sum + Number(path.weight || 0), 0),
    },
  }
  normalizedGraphCache.set(graph, normalized)
  normalizedGraphCache.set(normalized, normalized)
  return normalized
}
