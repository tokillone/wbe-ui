import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  fetchIcd11SankeyCategories,
  fetchIcd11SankeyGraph,
  normalizeIcd11SankeyGraph,
} from '../services/icd11Sankey'
import {
  relationPieSectionsForNode,
  relationShareItems,
  pathsForLevel1Context,
  pathsForLevel1Scope,
  sankeyHoverTargetKey,
  smartSankeyLimit,
} from '../utils/icd11SankeyDisplay'
import type { Icd11SankeyPath } from '../types/icd11Sankey'

describe('icd11Sankey service', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches categories from the backend endpoint', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          code: 200,
          message: 'success',
          data: { categories: ['A 消化道和代谢系统药物'], defaultCategory: 'ALL' },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchIcd11SankeyCategories()

    expect(result.defaultCategory).toBe('ALL')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/icd11-sankey/categories?schema=all-level1-v1',
      expect.any(Object),
    )
  })

  it('passes selected category to the graph endpoint', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          code: 200,
          message: 'success',
          data: {
            category: 'N 神经系统药物',
            nodes: [],
            links: [],
            paths: [],
            level1Colors: {},
            stats: {
              totalWeight: 0,
              level1: 0,
              level2: 0,
              level3: 0,
              drug: 0,
              biomarker: 0,
              relations: 0,
              maxNodes: 0,
              topLevel1: [],
              topLevel3: [],
              topDrug: [],
              topBiomarker: [],
            },
          },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchIcd11SankeyGraph('N 神经系统药物')

    expect(result.category).toBe('N 神经系统药物')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/icd11-sankey/graph-v2?schema=all-level1-v1&category=N+%E7%A5%9E%E7%BB%8F%E7%B3%BB%E7%BB%9F%E8%8D%AF%E7%89%A9',
      expect.any(Object),
    )
  })
})

describe('icd11Sankey display helpers', () => {
  it('uses smart limits based on category path density', () => {
    expect(smartSankeyLimit(412)).toBe(100)
    expect(smartSankeyLimit(112)).toBe(50)
    expect(smartSankeyLimit(80)).toBe(50)
    expect(smartSankeyLimit(79)).toBeNull()
    expect(smartSankeyLimit(3)).toBeNull()
  })

  it('aggregates relation shares for pie charts', () => {
    const paths: Icd11SankeyPath[] = [
      path('p1', '内分泌疾病', '2型糖尿病', '二甲双胍', '二甲双胍', 10),
      path('p2', '内分泌疾病', '2型糖尿病', '二甲双胍', '二甲双胍', 3),
      path('p3', '胃或十二指肠溃疡', '胃溃疡', '格列齐特', '格列齐特', 7),
    ]

    const level2Shares = relationShareItems(paths, (item) => item.level2)
    const drugShares = relationShareItems(paths, (item) => item.drug)
    const biomarkerShares = relationShareItems(paths, (item) => item.biomarker)

    expect(level2Shares).toHaveLength(2)
    expect(level2Shares[0]).toMatchObject({
      name: '内分泌疾病',
      value: 13,
      share: 0.65,
      pathIds: ['p1', 'p2'],
    })
    expect(level2Shares[1]).toMatchObject({
      name: '胃或十二指肠溃疡',
      value: 7,
      share: 0.35,
      pathIds: ['p3'],
    })
    expect(drugShares[0]).toMatchObject({
      name: '二甲双胍',
      value: 13,
      share: 0.65,
      pathIds: ['p1', 'p2'],
    })
    expect(drugShares[1]).toMatchObject({
      name: '格列齐特',
      value: 7,
      share: 0.35,
      pathIds: ['p3'],
    })
    expect(biomarkerShares.map((item) => item.name)).toEqual(['二甲双胍', '格列齐特'])
  })

  it('deduplicates hover target keys regardless of path order', () => {
    expect(sankeyHoverTargetKey('edge:a', ['p2', 'p1', 'p2'])).toBe(
      sankeyHoverTargetKey('edge:a', ['p1', 'p2']),
    )
  })

  it('builds pie sections based on locked node kind', () => {
    const paths: Icd11SankeyPath[] = [
      path('p1', '内分泌疾病', '2型糖尿病', '二甲双胍', '二甲双胍', 10),
      path('p2', '胃或十二指肠溃疡', '胃溃疡', '二甲双胍', '乳酸', 3),
      path('p3', '内分泌疾病', '2型糖尿病', '二甲双胍', '二甲双胍', 2),
    ]

    const level1Sections = relationPieSectionsForNode('level1', paths)
    const level2Sections = relationPieSectionsForNode('level2', paths)
    const level3Sections = relationPieSectionsForNode('level3', paths)
    const drugSections = relationPieSectionsForNode('drug', paths)
    const biomarkerSections = relationPieSectionsForNode('biomarker', paths)

    expect(level1Sections.map((section) => section.id)).toEqual(['level1-level2'])
    expect(level2Sections.map((section) => section.id)).toEqual([
      'level2-mapping-depth',
      'level2-drug',
      'level2-level3',
    ])
    expect(level3Sections.map((section) => section.id)).toEqual(['level3-drug'])
    expect(drugSections.map((section) => section.id)).toEqual([
      'drug-mapping-depth',
      'drug-disease-node',
      'drug-biomarker',
    ])
    expect(biomarkerSections.map((section) => section.id)).toEqual([
      'biomarker-drug',
      'biomarker-disease-node',
    ])
    const drugDiseaseSection = drugSections.find((section) => section.id === 'drug-disease-node')
    const drugBiomarkerSection = drugSections.find((section) => section.id === 'drug-biomarker')
    expect(drugDiseaseSection).toBeDefined()
    expect(drugBiomarkerSection).toBeDefined()
    expect(drugDiseaseSection?.items[0]).toMatchObject({
      name: '2型糖尿病',
      value: 12,
      pathIds: ['p1', 'p3'],
    })
    expect(level3Sections[0]?.items[0]).toMatchObject({
      name: '二甲双胍',
      value: 15,
      pathIds: ['p1', 'p2', 'p3'],
    })
    expect(drugBiomarkerSection?.items[0]).toMatchObject({
      name: '二甲双胍',
      value: 12,
      pathIds: ['p1', 'p3'],
    })
    expect(biomarkerSections[0]?.items[0]).toMatchObject({
      name: '二甲双胍',
      value: 15,
      pathIds: ['p1', 'p2', 'p3'],
    })
    expect(level2Sections.find((section) => section.id === 'level2-drug')?.items[0]).toMatchObject({
      name: '二甲双胍',
      value: 15,
    })
  })

  it('adds one-hop paths from other Level1 values when they share a downstream node', () => {
    const selected = path('selected', '内分泌疾病', '2型糖尿病', '二甲双胍', '二甲双胍', 10)
    const related = {
      ...path('related', '肾脏疾病', null, '二甲双胍', '二甲双胍', 3),
      level1: '泌尿生殖系统疾病',
      nodeIds: ['level1-b', 'level2-b', 'drug::二甲双胍', 'biomarker::二甲双胍'],
    }
    const unrelated = {
      ...path('unrelated', '心脏疾病', null, '阿斯匹林', '水杨酸', 2),
      level1: '循环系统疾病',
      nodeIds: ['level1-c', 'level2-c', 'drug::阿斯匹林', 'biomarker::水杨酸'],
    }

    expect(pathsForLevel1Context([selected, related, unrelated], selected.level1).map((item) => item.pathId)).toEqual([
      'selected',
      'related',
    ])
    expect(
      pathsForLevel1Scope([selected, related, unrelated], selected.level1, 'selected').map(
        (item) => item.pathId,
      ),
    ).toEqual(['selected'])
    expect(
      pathsForLevel1Scope([selected, related, unrelated], selected.level1, 'linked').map(
        (item) => item.pathId,
      ),
    ).toEqual(['selected', 'related'])
  })

  it('keeps legacy four-stage graph data as a truthful Level2 terminal path', () => {
    const graph = normalizeIcd11SankeyGraph({
      category: 'A 消化道和代谢系统药物',
      nodes: [
        node('level1', '内分泌疾病', 'level1', 0, 3),
        node('level2', '糖尿病', 'level2', 1, 3),
        node('drug', '二甲双胍', 'drug', 2, 3),
        node('biomarker', '二甲双胍', 'biomarker', 3, 3),
      ],
      links: [],
      paths: [
        {
          ...path('legacy', '糖尿病', '', '二甲双胍', '二甲双胍', 3),
          nodeIds: ['level1', 'level2', 'drug', 'biomarker'],
        },
      ],
      level1Colors: { '内分泌、营养或代谢疾病': '#326FB4' },
      stats: {
        totalWeight: 3,
        level1: 1,
        level2: 1,
        level3: 0,
        drug: 1,
        biomarker: 1,
        relations: 1,
        maxNodes: 1,
        level2OnlyPaths: 0,
        level3Paths: 0,
        level2OnlyWeight: 0,
        level3Weight: 0,
        topLevel1: [],
        topLevel3: [],
        topDrug: [],
        topBiomarker: [],
      },
    })

    expect(graph.paths[0]?.nodeIds).toHaveLength(4)
    expect(graph.paths[0]?.level3).toBeNull()
    expect(graph.paths[0]?.mappingLevel).toBe('Level2')
    expect(graph.nodes.find((item) => item.kind === 'level3')).toBeUndefined()
    expect(graph.nodes.find((item) => item.kind === 'drug')?.depth).toBe(3)
    expect(graph.nodes.find((item) => item.kind === 'biomarker')?.depth).toBe(4)
    expect(graph.stats.level3).toBe(0)
    expect(graph.stats.level2OnlyPaths).toBe(1)
    expect(graph.stats.level2OnlyWeight).toBe(3)
  })
})

function node(
  name: string,
  displayName: string,
  kind: 'level1' | 'level2' | 'level3' | 'drug' | 'biomarker',
  depth: number,
  value: number,
) {
  return {
    name,
    displayName,
    kind,
    depth,
    value,
    searchText: displayName,
    level1: '内分泌、营养或代谢疾病',
    color: '#326FB4',
  }
}

function path(
  pathId: string,
  level2: string,
  level3: string | null,
  drug: string,
  biomarker: string,
  weight: number,
): Icd11SankeyPath {
  return {
    pathId,
    level1: '内分泌、营养或代谢疾病',
    level2,
    level3,
    mappingLevel: level3 ? 'Level3' : 'Level2',
    drug,
    biomarker,
    biomarkerAliases: [],
    weight,
    share: 0,
    nodeIds: level3
      ? ['level1', 'level2', `level3::${level3}`, `drug::${drug}`, `biomarker::${biomarker}`]
      : ['level1', 'level2', `drug::${drug}`, `biomarker::${biomarker}`],
  }
}
