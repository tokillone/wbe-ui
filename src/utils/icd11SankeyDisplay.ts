import type { Icd11SankeyNode, Icd11SankeyPath } from '../types/icd11Sankey'

export type Icd11SankeyDisplayMode = 'smart' | 'all' | 'top20' | 'top50' | 'top100'
export type Level1Scope = 'selected' | 'linked'

export interface RelationShareItem {
  name: string
  value: number
  share: number
  pathIds: string[]
}

export type Level2Level3Share = RelationShareItem

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

export function pathsForLevel1Context(paths: Icd11SankeyPath[], selectedLevel1: string) {
  const primaryPaths = paths.filter((path) => path.level1 === selectedLevel1)
  if (!primaryPaths.length) return []

  const sharedNodeIds = new Set(primaryPaths.flatMap((path) => path.nodeIds.slice(1)))
  return paths.filter(
    (path) =>
      path.level1 === selectedLevel1 || path.nodeIds.slice(1).some((nodeId) => sharedNodeIds.has(nodeId)),
  )
}

export function pathsForLevel1Scope(
  paths: Icd11SankeyPath[],
  selectedLevel1: string,
  scope: Level1Scope,
) {
  if (scope === 'selected') return paths.filter((path) => path.level1 === selectedLevel1)
  return pathsForLevel1Context(paths, selectedLevel1)
}

export function relationShareItems(
  paths: Icd11SankeyPath[],
  groupBy: (path: Icd11SankeyPath) => string | null | undefined,
): RelationShareItem[] {
  const totalWeight = paths.reduce((sum, path) => sum + Number(path.weight || 0), 0)
  const shareMap = new Map<string, { value: number; pathIds: string[] }>()
  for (const path of paths) {
    const name = String(groupBy(path) ?? '').trim()
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

export function level2Level3Shares(paths: Icd11SankeyPath[]): RelationShareItem[] {
  return relationShareItems(paths.filter((path) => path.mappingLevel === 'Level3'), (path) => path.level3)
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
        'level2-mapping-depth',
        '映射深度分布',
        '区分精确到 ICD11_Level3 的路径与正式终止于 ICD11_Level2 的路径。',
        '映射层级',
        'Level2 映射深度分布图',
        '占该 Level2',
        'mapping-depth',
        paths,
        (path) => path.mappingLevel === 'Level3' ? '精确到 Level3' : '止于 Level2',
      ),
      relationPieSection(
        'level2-drug',
        '关联药物构成',
        '同时统计直接终止于 Level2 和继续到 Level3 的路径，按药物汇总。',
        '关联药物',
        'Level2 关联药物构成图',
        '占该 Level2',
        'level2-drug',
        paths,
        (path) => path.drug,
      ),
      relationPieSection(
        'level2-level3',
        'Level3 占比',
        '仅对真实 Level3 路径聚合，正式终止于 Level2 的路径不进入该统计。',
        'Level3',
        'Level2 到 Level3 占比图',
        '占该 Level2',
        'level3',
        paths.filter((path) => path.mappingLevel === 'Level3'),
        (path) => path.level3,
      ),
    ]
  }
  if (nodeKind === 'level3') {
    return [
      relationPieSection(
        'level3-drug',
        '关联药物占比',
        '按当前 ICD11_Level3 关联路径聚合药物，百分比基于该 Level3 的权重合计。',
        '关联药物',
        'Level3 关联药物占比图',
        '占该 Level3',
        'level3-drug',
        paths,
        (path) => path.drug,
      ),
    ]
  }
  if (nodeKind === 'drug') {
    return [
      relationPieSection(
        'drug-mapping-depth',
        '上游映射深度',
        '区分该药物来自真实 Level3 或直接来自 Level2 的路径。',
        '映射层级',
        '药物上游映射深度图',
        '占该药物',
        'drug-mapping-depth',
        paths,
        (path) => path.mappingLevel === 'Level3' ? '来自 Level3' : '直接来自 Level2',
      ),
      relationPieSection(
        'drug-disease-node',
        '关联疾病节点',
        '真实 Level3 与直接连接的 Level2 分开标记，不补造层级。',
        '疾病节点',
        '药物关联疾病节点占比图',
        '占该药物',
        'drug-disease-node',
        paths,
        (path) => path.level3 ?? `Level2 · ${path.level2}`,
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
  return [
    relationPieSection(
      'biomarker-drug',
      '上游药物构成',
      '说明哪些药物通过当前生物标记物被监测，百分比基于该节点的权重合计。',
      '上游药物',
      '生物标记物上游药物占比图',
      '占该生物标记物',
      'biomarker-drug',
      paths,
      (path) => path.drug,
    ),
    relationPieSection(
      'biomarker-disease-node',
      '疾病来源构成',
      '说明当前生物标记物对应的疾病映射来源，真实 Level3 与直接 Level2 分开标记。',
      '疾病节点',
      '生物标记物关联疾病节点占比图',
      '占该生物标记物',
      'biomarker-disease-node',
      paths,
      (path) => path.level3 ?? `Level2 · ${path.level2}`,
    ),
  ]
}

export function sankeyHoverTargetKey(prefix: string, pathIds: Iterable<string>) {
  const normalized = [...new Set(pathIds)].sort()
  return `${prefix}:${normalized.join('|')}`
}

function pathText(path: Icd11SankeyPath) {
  return [path.level1, path.level2, path.level3, path.drug, path.biomarker].filter(Boolean).join(' → ')
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
  groupBy: (path: Icd11SankeyPath) => string | null | undefined,
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
