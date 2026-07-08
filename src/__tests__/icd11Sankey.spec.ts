import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchIcd11SankeyCategories, fetchIcd11SankeyGraph } from '../services/icd11Sankey'
import {
  relationPieSectionsForNode,
  relationShareItems,
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
          data: { categories: ['A 消化道和代谢系统药物'], defaultCategory: 'A 消化道和代谢系统药物' },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchIcd11SankeyCategories()

    expect(result.defaultCategory).toBe('A 消化道和代谢系统药物')
    expect(fetchMock).toHaveBeenCalledWith('/api/icd11-sankey/categories', expect.any(Object))
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
              drug: 0,
              biomarker: 0,
              relations: 0,
              maxNodes: 0,
              topLevel1: [],
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
      '/api/icd11-sankey/graph?category=N+%E7%A5%9E%E7%BB%8F%E7%B3%BB%E7%BB%9F%E8%8D%AF%E7%89%A9',
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
      path('p1', '内分泌疾病', '二甲双胍', '二甲双胍', 10),
      path('p2', '内分泌疾病', '二甲双胍', '二甲双胍', 3),
      path('p3', '胃或十二指肠溃疡', '格列齐特', '格列齐特', 7),
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
      path('p1', '内分泌疾病', '二甲双胍', '二甲双胍', 10),
      path('p2', '胃或十二指肠溃疡', '二甲双胍', '乳酸', 3),
      path('p3', '内分泌疾病', '二甲双胍', '二甲双胍', 2),
    ]

    const level1Sections = relationPieSectionsForNode('level1', paths)
    const level2Sections = relationPieSectionsForNode('level2', paths)
    const drugSections = relationPieSectionsForNode('drug', paths)
    const biomarkerSections = relationPieSectionsForNode('biomarker', paths)

    expect(level1Sections.map((section) => section.id)).toEqual(['level1-level2'])
    expect(level2Sections.map((section) => section.id)).toEqual(['level2-drug'])
    expect(drugSections.map((section) => section.id)).toEqual(['drug-level2', 'drug-biomarker'])
    expect(biomarkerSections).toEqual([])
    const drugLevel2Section = drugSections[0]
    const drugBiomarkerSection = drugSections[1]
    expect(drugLevel2Section).toBeDefined()
    expect(drugBiomarkerSection).toBeDefined()
    expect(drugLevel2Section?.items[0]).toMatchObject({
      name: '内分泌疾病',
      value: 12,
      pathIds: ['p1', 'p3'],
    })
    expect(drugBiomarkerSection?.items[0]).toMatchObject({
      name: '二甲双胍',
      value: 12,
      pathIds: ['p1', 'p3'],
    })
  })
})

function path(
  pathId: string,
  level2: string,
  drug: string,
  biomarker: string,
  weight: number,
): Icd11SankeyPath {
  return {
    pathId,
    level1: '内分泌、营养或代谢疾病',
    level2,
    drug,
    biomarker,
    biomarkerAliases: [],
    weight,
    share: 0,
    nodeIds: ['level1', 'level2', `drug::${drug}`, `biomarker::${biomarker}`],
  }
}
