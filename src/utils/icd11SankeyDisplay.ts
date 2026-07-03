import type { Icd11SankeyPath } from '../types/icd11Sankey'

export type Icd11SankeyDisplayMode = 'smart' | 'all' | 'top20' | 'top50' | 'top100'

export interface Level2DrugShare {
  name: string
  value: number
  share: number
  pathIds: string[]
}

export function smartSankeyLimit(pathCount: number) {
  if (pathCount > 200) return 100
  if (pathCount >= 80) return 50
  return null
}

export function displayModeLimit(mode: Icd11SankeyDisplayMode, pathCount: number) {
  if (mode === 'smart') return smartSankeyLimit(pathCount)
  if (mode === 'top20') return 20
  if (mode === 'top50') return 50
  if (mode === 'top100') return 100
  return null
}

export function sortSankeyPaths(paths: Icd11SankeyPath[]) {
  return [...paths].sort(
    (a, b) => b.weight - a.weight || pathText(a).localeCompare(pathText(b), 'zh-Hans-CN'),
  )
}

export function level2DrugShares(paths: Icd11SankeyPath[]): Level2DrugShare[] {
  const totalWeight = paths.reduce((sum, path) => sum + Number(path.weight || 0), 0)
  const drugMap = new Map<string, { value: number; pathIds: string[] }>()
  for (const path of paths) {
    const current = drugMap.get(path.drug) ?? { value: 0, pathIds: [] }
    current.value += Number(path.weight || 0)
    current.pathIds.push(path.pathId)
    drugMap.set(path.drug, current)
  }
  return [...drugMap.entries()]
    .map(([name, item]) => ({
      name,
      value: item.value,
      share: totalWeight > 0 ? item.value / totalWeight : 0,
      pathIds: item.pathIds,
    }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

export function sankeyHoverTargetKey(prefix: string, pathIds: Iterable<string>) {
  const normalized = [...new Set(pathIds)].sort()
  return `${prefix}:${normalized.join('|')}`
}

function pathText(path: Icd11SankeyPath) {
  return `${path.level1} → ${path.level2} → ${path.drug} → ${path.biomarker}`
}
