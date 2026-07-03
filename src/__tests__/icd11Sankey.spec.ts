import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchIcd11SankeyCategories, fetchIcd11SankeyGraph } from '../services/icd11Sankey'
import { level2DrugShares, sankeyHoverTargetKey, smartSankeyLimit } from '../utils/icd11SankeyDisplay'
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

  it('aggregates Level2 drug shares for the pie chart', () => {
    const paths: Icd11SankeyPath[] = [
      path('p1', '内分泌疾病', '二甲双胍', 10),
      path('p2', '内分泌疾病', '二甲双胍', 3),
      path('p3', '内分泌疾病', '格列齐特', 7),
    ]

    const shares = level2DrugShares(paths)

    expect(shares).toHaveLength(2)
    expect(shares[0]).toMatchObject({
      name: '二甲双胍',
      value: 13,
      share: 0.65,
      pathIds: ['p1', 'p2'],
    })
    expect(shares[1]).toMatchObject({
      name: '格列齐特',
      value: 7,
      share: 0.35,
      pathIds: ['p3'],
    })
  })

  it('deduplicates hover target keys regardless of path order', () => {
    expect(sankeyHoverTargetKey('edge:a', ['p2', 'p1', 'p2'])).toBe(
      sankeyHoverTargetKey('edge:a', ['p1', 'p2']),
    )
  })
})

function path(pathId: string, level2: string, drug: string, weight: number): Icd11SankeyPath {
  return {
    pathId,
    level1: '内分泌、营养或代谢疾病',
    level2,
    drug,
    biomarker: drug,
    biomarkerAliases: [],
    weight,
    share: 0,
    nodeIds: ['level1', 'level2', `drug::${drug}`, `biomarker::${drug}`],
  }
}
