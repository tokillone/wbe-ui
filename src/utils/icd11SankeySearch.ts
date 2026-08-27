import type { Icd11SankeyGraph, Icd11SankeyNode, Icd11SankeyPath } from '../types/icd11Sankey'
import { icd11SankeyGraphIndex } from './icd11SankeyGraphIndex'
import { sortSankeyPaths } from './icd11SankeyDisplay'

export interface SankeyNodeSearchResult {
  nodeId: string
  name: string
  kind: Icd11SankeyNode['kind']
  depth: number
  weight: number
  pathCount: number
  prefixMatch: boolean
}

export interface SearchPathInjection {
  paths: Icd11SankeyPath[]
  injected: boolean
}

const SEARCH_STAGE_COUNT = 5
const DEFAULT_RESULT_LIMIT = 20

export function searchSankeyNodes(
  graph: Icd11SankeyGraph,
  query: string,
  limit = DEFAULT_RESULT_LIMIT,
): SankeyNodeSearchResult[] {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) return []
  const perStageLimit = Math.max(1, Math.ceil(limit / SEARCH_STAGE_COUNT))
  const index = icd11SankeyGraphIndex(graph)
  const groups = new Map<number, SankeyNodeSearchResult[]>()

  for (const node of graph.nodes) {
    const normalizedName = normalizeSearchText(node.displayName)
    if (!normalizedName.includes(normalizedQuery)) continue
    const result: SankeyNodeSearchResult = {
      nodeId: node.name,
      name: node.displayName,
      kind: node.kind,
      depth: node.depth,
      weight: Number(node.value || 0),
      pathCount: index.pathIdsByNode.get(node.name)?.length ?? 0,
      prefixMatch: normalizedName.startsWith(normalizedQuery),
    }
    const stage = groups.get(node.depth) ?? []
    stage.push(result)
    groups.set(node.depth, stage)
  }

  return [...groups.entries()]
    .sort(([depthA], [depthB]) => depthA - depthB)
    .flatMap(([, items]) =>
      items
        .sort(
          (a, b) =>
            Number(b.prefixMatch) - Number(a.prefixMatch) ||
            b.weight - a.weight ||
            a.name.localeCompare(b.name, 'zh-Hans-CN'),
        )
        .slice(0, perStageLimit),
    )
    .slice(0, limit)
}

export function resolveSearchLevel1(
  graph: Icd11SankeyGraph,
  nodeId: string,
  currentLevel1: string,
) {
  const index = icd11SankeyGraphIndex(graph)
  const node = index.nodeById.get(nodeId)
  if (!node) return currentLevel1
  if (node.kind === 'level1') return node.displayName
  const paths = pathsForSearchNode(graph, nodeId)
  if (paths.some((path) => path.level1 === currentLevel1)) return currentLevel1

  const weights = new Map<string, number>()
  for (const path of paths) {
    weights.set(path.level1, (weights.get(path.level1) ?? 0) + Number(path.weight || 0))
  }
  return (
    [...weights.entries()].sort(
      ([nameA, weightA], [nameB, weightB]) =>
        weightB - weightA || nameA.localeCompare(nameB, 'zh-Hans-CN'),
    )[0]?.[0] ?? currentLevel1
  )
}

export function pathsForSearchNode(graph: Icd11SankeyGraph, nodeId: string, level1?: string) {
  const index = icd11SankeyGraphIndex(graph)
  const paths = [...(index.pathIdsByNode.get(nodeId) ?? [])]
    .map((pathId) => index.pathById.get(pathId))
    .filter((path): path is Icd11SankeyPath => Boolean(path))
    .filter((path) => !level1 || path.level1 === level1)
  return sortSankeyPaths(paths)
}

export function representativeSearchPath(graph: Icd11SankeyGraph, nodeId: string, level1: string) {
  return pathsForSearchNode(graph, nodeId, level1)[0] ?? null
}

export function ensureSearchTargetVisible(
  displayedPaths: Icd11SankeyPath[],
  targetNodeId: string,
  representativePath: Icd11SankeyPath | null,
  limit: number | null,
): SearchPathInjection {
  if (!targetNodeId || !representativePath) return { paths: displayedPaths, injected: false }
  if (displayedPaths.some((path) => path.nodeIds.includes(targetNodeId))) {
    return { paths: displayedPaths, injected: false }
  }
  const withoutDuplicate = displayedPaths.filter(
    (path) => path.pathId !== representativePath.pathId,
  )
  if (limit && withoutDuplicate.length >= limit) {
    return {
      paths: [...withoutDuplicate.slice(0, Math.max(0, limit - 1)), representativePath],
      injected: true,
    }
  }
  return { paths: [...withoutDuplicate, representativePath], injected: true }
}

function normalizeSearchText(value: string) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('zh-Hans-CN')
}
