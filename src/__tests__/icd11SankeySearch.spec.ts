import { describe, expect, it } from 'vitest'

import type { Icd11SankeyGraph, Icd11SankeyNode, Icd11SankeyPath } from '../types/icd11Sankey'
import { relationPieColor, RELATION_PIE_OTHER_COLOR } from '../utils/icd11SankeyColors'
import {
  ensureSearchTargetVisible,
  representativeSearchPath,
  resolveSearchLevel1,
  searchSankeyNodes,
} from '../utils/icd11SankeySearch'

describe('ICD11 Sankey node search', () => {
  it('matches display names across all five stages and keeps duplicate labels by layer', () => {
    const graph = searchGraph()
    const results = searchSankeyNodes(graph, '共同')

    expect(results.map((result) => [result.kind, result.name])).toEqual([
      ['level1', '共同节点'],
      ['level2', '共同节点'],
      ['level3', '共同节点'],
      ['drug', '共同药物'],
      ['biomarker', '共同标记物'],
    ])
  })

  it('ranks prefix matches before contained matches and caps each stage', () => {
    const graph = searchGraph([
      node('level2::a', '目标甲', 'level2', 1, 2),
      node('level2::b', '前缀目标', 'level2', 1, 100),
      node('level2::c', '目标乙', 'level2', 1, 4),
      node('level2::d', '目标丙', 'level2', 1, 3),
      node('level2::e', '目标丁', 'level2', 1, 1),
    ])
    const results = searchSankeyNodes(graph, '目标', 20).filter((item) => item.kind === 'level2')

    expect(results).toHaveLength(4)
    expect(results.slice(0, 3).map((item) => item.name)).toEqual(['目标乙', '目标丙', '目标甲'])
    expect(results.some((item) => item.name === '前缀目标')).toBe(false)
  })

  it('prefers the current Level1 and otherwise chooses the highest related weight', () => {
    const graph = searchGraph()
    expect(resolveSearchLevel1(graph, 'drug::shared', '分类乙')).toBe('分类乙')
    expect(resolveSearchLevel1(graph, 'drug::shared', '不存在')).toBe('分类甲')
    expect(representativeSearchPath(graph, 'drug::shared', '分类乙')?.pathId).toBe('p2')
  })

  it('replaces the last limited path when a search target is filtered out', () => {
    const graph = searchGraph()
    const targetPath = graph.paths.find((path) => path.pathId === 'p2')
    const target = targetPath
      ? { ...targetPath, nodeIds: [...targetPath.nodeIds, 'biomarker::only-p2'] }
      : null
    const injected = ensureSearchTargetVisible([graph.paths[0]!], 'biomarker::only-p2', target, 1)

    expect(injected.injected).toBe(true)
    expect(injected.paths.map((path) => path.pathId)).toEqual(['p2'])
    expect(
      ensureSearchTargetVisible(injected.paths, 'biomarker::only-p2', target, 1).injected,
    ).toBe(false)
  })
})

describe('relation pie palette', () => {
  it('assigns seven distinct chart colors and a stable neutral other color', () => {
    const colors = Array.from({ length: 7 }, (_, index) => relationPieColor(index))
    expect(new Set(colors).size).toBe(7)
    expect(relationPieColor(7)).toBe(colors[0])
    expect(relationPieColor(0, true)).toBe(RELATION_PIE_OTHER_COLOR)
  })
})

function searchGraph(extraNodes: Icd11SankeyNode[] = []): Icd11SankeyGraph {
  const nodes = [
    node('level1::shared', '共同节点', 'level1', 0, 18),
    node('level2::shared', '共同节点', 'level2', 1, 18),
    node('level3::shared', '共同节点', 'level3', 2, 18),
    node('drug::shared', '共同药物', 'drug', 3, 18),
    node('biomarker::shared', '共同标记物', 'biomarker', 4, 18),
    ...extraNodes,
  ]
  const paths = [path('p1', '分类甲', 12), path('p2', '分类乙', 6)]
  return {
    category: '全部目标类别',
    nodes,
    links: [],
    paths,
    level1Colors: {},
    stats: {
      totalWeight: 18,
      level1: 2,
      level2: 1,
      level3: 1,
      drug: 1,
      biomarker: 1,
      mappingRows: 2,
      relations: 2,
      maxNodes: 2,
      level2OnlyPaths: 0,
      level3Paths: 2,
      level2OnlyWeight: 0,
      level3Weight: 18,
      topLevel1: [],
      topLevel3: [],
      topDrug: [],
      topBiomarker: [],
    },
  }
}

function node(
  name: string,
  displayName: string,
  kind: Icd11SankeyNode['kind'],
  depth: number,
  value: number,
): Icd11SankeyNode {
  return {
    name,
    displayName,
    kind,
    depth,
    value,
    searchText: `${displayName} alias`,
    level1: '分类甲',
    color: '#4E79A7',
  }
}

function path(pathId: string, level1: string, weight: number): Icd11SankeyPath {
  return {
    pathId,
    level1,
    level2: '共同节点',
    level3: '共同节点',
    mappingLevel: 'Level3',
    drug: '共同药物',
    biomarker: '共同标记物',
    biomarkerAliases: [],
    weight,
    mappingRows: 1,
    share: weight / 18,
    nodeIds: [
      'level1::shared',
      'level2::shared',
      'level3::shared',
      'drug::shared',
      'biomarker::shared',
    ],
  }
}
