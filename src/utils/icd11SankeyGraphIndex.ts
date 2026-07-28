import type { Icd11SankeyGraph, Icd11SankeyPath } from '../types/icd11Sankey'

export interface Icd11SankeyGraphIndex {
  pathById: ReadonlyMap<string, Icd11SankeyPath>
  pathIdsByNode: ReadonlyMap<string, readonly string[]>
}

const graphIndexCache = new WeakMap<Icd11SankeyGraph, Icd11SankeyGraphIndex>()

export function icd11SankeyGraphIndex(graph: Icd11SankeyGraph): Icd11SankeyGraphIndex {
  const cached = graphIndexCache.get(graph)
  if (cached) return cached

  const pathById = new Map<string, Icd11SankeyPath>()
  const mutablePathIdsByNode = new Map<string, string[]>()
  for (const path of graph.paths) {
    pathById.set(path.pathId, path)
    for (const nodeId of path.nodeIds) {
      const pathIds = mutablePathIdsByNode.get(nodeId)
      if (pathIds) {
        pathIds.push(path.pathId)
      } else {
        mutablePathIdsByNode.set(nodeId, [path.pathId])
      }
    }
  }
  const index: Icd11SankeyGraphIndex = {
    pathById,
    pathIdsByNode: mutablePathIdsByNode,
  }
  graphIndexCache.set(graph, index)
  return index
}
