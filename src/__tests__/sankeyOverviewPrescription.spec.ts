import { describe, expect, it } from 'vitest'
import type {
  Icd11SankeyGraph,
  Icd11SankeyPath,
  DrugPrescriptionStatus,
} from '../types/icd11Sankey'
import {
  collapseRelationShares,
  overviewPieSections,
  promoteConnectedSankeyNodes,
  sankeyScopeCandidates,
  selectSankeyDisplayPaths,
  summarizeDrugPrescriptions,
  summarizeSankeyOverview,
} from '../utils/icd11SankeyDisplay'

function path(id: string, drug: string, weight = 1, level1 = 'A'): Icd11SankeyPath {
  return {
    pathId: id,
    level1,
    level2: `${level1}-L2`,
    level3: `${level1}-L3`,
    mappingLevel: 'Level3',
    drug,
    biomarker: `B-${id}`,
    biomarkerAliases: [],
    weight,
    mappingRows: 1,
    share: 0,
    nodeIds: [`L1-${level1}`, `L2-${level1}`, `L3-${level1}`, `drug::${drug.trim()}`, `bio::${id}`],
  }
}
function graph(
  paths: Icd11SankeyPath[],
  prescriptions?: Record<string, DrugPrescriptionStatus>,
): Icd11SankeyGraph {
  return {
    category: 'ALL',
    paths,
    links: [],
    level1Colors: {},
    stats: summarizeSankeyOverview(paths),
    drugPrescriptions: prescriptions,
    nodes: [...new Set(paths.map((path) => path.drug.trim()))].map((drug) => ({
      name: `drug::${drug}`,
      displayName: drug,
      kind: 'drug',
      depth: 3,
      value: 1,
      searchText: drug,
      level1: '',
      color: '',
    })),
  }
}

describe('Sankey complete overview and prescription denominator', () => {
  it('keeps every item beyond the old Top 10 inside Top 7 + other', () => {
    const paths = Array.from({ length: 14 }, (_, index) =>
      path(`p${index}`, `drug${index}`, 14 - index),
    )
    const section = overviewPieSections(paths, 'current').find(
      (section) => section.id === 'overview-drug',
    )!
    const collapsed = collapseRelationShares(section.items)
    expect(section.items).toHaveLength(14)
    expect(collapsed).toHaveLength(8)
    expect(collapsed[collapsed.length - 1]).toMatchObject({
      name: '其他 7 项',
      value: 28,
      hiddenItemCount: 7,
      isOther: true,
    })
    expect(collapsed.reduce((sum, item) => sum + item.share, 0)).toBeCloseTo(1)
    expect(collapsed.reduce((sum, item) => sum + item.value, 0)).toBe(105)
    expect(collapseRelationShares(section.items.slice(0, 8))[7]?.hiddenItemCount).toBe(1)
  })

  it('uses only valid Level3 rows for its numerator and denominator', () => {
    const valid = path('valid', 'Rx', 3)
    const direct = { ...path('direct', 'OTC', 100), mappingLevel: 'Level2' as const, level3: null }
    const missing = { ...path('missing', 'unknown', 99), level3: null }
    const section = overviewPieSections([valid, direct, missing], 'global').find(
      (section) => section.id === 'overview-level3',
    )!
    expect(section.items).toHaveLength(1)
    expect(section.items[0]).toMatchObject({ value: 3, share: 1 })
    expect(overviewPieSections([], 'current').every((section) => !section.items.length)).toBe(true)
  })

  it('counts distinct trimmed drug names instead of paths, including unknown and conflict', () => {
    const paths = [
      path('p1', ' Rx ', 200),
      path('p2', 'Rx'),
      path('p3', 'OTC'),
      path('p4', 'mixed'),
      path('p5', 'NA'),
      path('p6', 'missing'),
    ]
    const result = summarizeDrugPrescriptions(
      paths,
      graph(paths, {
        'drug::Rx': 'prescription',
        'drug::OTC': 'nonprescription',
        'drug::mixed': 'conflict',
        'drug::NA': 'unknown',
      }),
    )
    expect(result).toEqual({
      available: true,
      total: 5,
      counts: { prescription: 1, nonprescription: 1, conflict: 1, unknown: 2 },
    })
    expect(summarizeDrugPrescriptions(paths, graph(paths)).available).toBe(false)
    expect(summarizeDrugPrescriptions([], graph([], {}))).toMatchObject({
      available: true,
      total: 0,
    })
  })
})

describe('Sankey linked branch allocation', () => {
  it('retains ten low-weight related branches and their seeds among fifty paths', () => {
    const primary = Array.from({ length: 80 }, (_, i) => path(`p${i}`, `drug${i}`, 100 - i))
    const related = Array.from({ length: 15 }, (_, i) =>
      path(`r${i}`, `drug${70 + (i % 10)}`, 1, 'B'),
    )
    const candidates = sankeyScopeCandidates([...primary, ...related], 'A', 'linked')
    const shown = selectSankeyDisplayPaths(candidates, 'A', 'linked', 50)
    expect(shown).toHaveLength(50)
    expect(shown.filter((path) => path.level1 === 'B')).toHaveLength(10)
    for (const linked of shown.filter((path) => path.level1 === 'B')) {
      expect(shown.some((seed) => seed.level1 === 'A' && seed.drug === linked.drug)).toBe(true)
    }
    expect(
      selectSankeyDisplayPaths([...candidates].reverse(), 'A', 'linked', 50).map(
        (path) => path.pathId,
      ),
    ).toEqual(shown.map((path) => path.pathId))
    expect(
      selectSankeyDisplayPaths(candidates, 'A', 'selected', 50).every(
        (path) => path.level1 === 'A',
      ),
    ).toBe(true)
  })

  it('fills unused quota, excludes unrelated paths and drops associations with filtered-out seeds', () => {
    const primary = path('seed', 'shared', 2)
    const related = Array.from({ length: 9 }, (_, i) => path(`r${i}`, 'shared', 10, 'B'))
    const unrelated = path('unrelated', 'other', 30, 'C')
    const candidates = sankeyScopeCandidates([primary, ...related, unrelated], 'A', 'linked')
    expect(candidates).toHaveLength(10)
    expect(selectSankeyDisplayPaths(candidates, 'A', 'linked', 5)).toHaveLength(5)
    expect(selectSankeyDisplayPaths(candidates, 'A', 'linked', null)).toHaveLength(10)
    expect(sankeyScopeCandidates([primary, ...related], 'A', 'linked', 3)).toEqual([])
  })
})

describe('Sankey focused node ordering', () => {
  it('moves every node on the selected trajectory ahead within its own depth', () => {
    const paths = [path('p1', 'first', 5), path('p2', 'focus', 2)]
    const nodes = [
      { name: 'other-l2', depth: 1 },
      { name: 'L2-A', depth: 1 },
      { name: 'drug::first', depth: 3 },
      { name: 'drug::focus', depth: 3 },
      { name: 'bio::p1', depth: 4 },
      { name: 'bio::p2', depth: 4 },
    ].map((node) => ({
      ...node,
      displayName: node.name,
      kind:
        node.depth === 3
          ? ('drug' as const)
          : node.depth === 4
            ? ('biomarker' as const)
            : ('level2' as const),
      value: 1,
      searchText: node.name,
      level1: 'A',
      color: '',
    }))
    const ordered = promoteConnectedSankeyNodes(nodes, paths, 'drug::focus')
    expect(ordered.filter((node) => node.depth === 3).map((node) => node.name)).toEqual([
      'drug::focus',
      'drug::first',
    ])
    expect(ordered.filter((node) => node.depth === 4).map((node) => node.name)).toEqual([
      'bio::p2',
      'bio::p1',
    ])
  })
})
