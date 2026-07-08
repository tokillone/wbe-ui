import type { Icd11SankeyNode, Icd11SankeyPath } from '../types/icd11Sankey'

export type Icd11SankeyDisplayMode = 'smart' | 'all' | 'top20' | 'top50' | 'top100'

export interface RelationShareItem {
  name: string
  value: number
  share: number
  pathIds: string[]
}

export type Level2DrugShare = RelationShareItem

export interface RelationPieSection {
  id: string
  title: string
  description: string
  centerLabel: string
  ariaLabel: string
  shareLabel: string
  hoverPrefix: string
  items: RelationShareItem[]
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

export function relationShareItems(
  paths: Icd11SankeyPath[],
  groupBy: (path: Icd11SankeyPath) => string,
): RelationShareItem[] {
  const totalWeight = paths.reduce((sum, path) => sum + Number(path.weight || 0), 0)
  const shareMap = new Map<string, { value: number; pathIds: string[] }>()
  for (const path of paths) {
    const name = groupBy(path).trim()
    if (!name) continue
    const current = shareMap.get(name) ?? { value: 0, pathIds: [] }
    current.value += Number(path.weight || 0)
    current.pathIds.push(path.pathId)
    shareMap.set(name, current)
  }
  return [...shareMap.entries()]
    .map(([name, item]) => ({
      name,
      value: item.value,
      share: totalWeight > 0 ? item.value / totalWeight : 0,
      pathIds: item.pathIds,
    }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

export function level2DrugShares(paths: Icd11SankeyPath[]): RelationShareItem[] {
  return relationShareItems(paths, (path) => path.drug)
}

export function relationPieSectionsForNode(
  nodeKind: Icd11SankeyNode['kind'],
  paths: Icd11SankeyPath[],
): RelationPieSection[] {
  if (nodeKind === 'level1') {
    return [
      relationPieSection(
        'level1-level2',
        'Level2 占比',
        '按当前 ICD11_Level1 关联路径聚合 Level2，百分比基于该 Level1 的权重合计。',
        'Level2',
        'Level1 到 Level2 占比图',
        '占该 Level1',
        'level2',
        paths,
        (path) => path.level2,
      ),
    ]
  }
  if (nodeKind === 'level2') {
    return [
      relationPieSection(
        'level2-drug',
        '关联药物占比',
        '按当前 ICD11_Level2 关联路径聚合药物，百分比基于该 Level2 的权重合计。',
        '关联药物',
        'Level2 关联药物占比图',
        '占该 Level2',
        'drug',
        paths,
        (path) => path.drug,
      ),
    ]
  }
  if (nodeKind === 'drug') {
    return [
      relationPieSection(
        'drug-level2',
        '关联 Level2 占比',
        '按当前药物关联路径聚合 ICD11_Level2，百分比基于该药物的权重合计。',
        'Level2',
        '药物关联 Level2 占比图',
        '占该药物',
        'drug-level2',
        paths,
        (path) => path.level2,
      ),
      relationPieSection(
        'drug-biomarker',
        '生物标记物占比',
        '按当前药物关联路径聚合生物标记物，百分比基于该药物的权重合计。',
        '生物标记物',
        '药物到生物标记物占比图',
        '占该药物',
        'biomarker',
        paths,
        (path) => path.biomarker,
      ),
    ]
  }
  return []
}

export function sankeyHoverTargetKey(prefix: string, pathIds: Iterable<string>) {
  const normalized = [...new Set(pathIds)].sort()
  return `${prefix}:${normalized.join('|')}`
}

function pathText(path: Icd11SankeyPath) {
  return `${path.level1} → ${path.level2} → ${path.drug} → ${path.biomarker}`
}

function relationPieSection(
  id: string,
  title: string,
  description: string,
  centerLabel: string,
  ariaLabel: string,
  shareLabel: string,
  hoverPrefix: string,
  paths: Icd11SankeyPath[],
  groupBy: (path: Icd11SankeyPath) => string,
): RelationPieSection {
  return {
    id,
    title,
    description,
    centerLabel,
    ariaLabel,
    shareLabel,
    hoverPrefix,
    items: relationShareItems(paths, groupBy),
  }
}
