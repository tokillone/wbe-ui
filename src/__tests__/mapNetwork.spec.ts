import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildMapApiUrl,
  fetchMapFilters,
  fetchMapStats,
  normalizeMapStatsResponse,
} from '../services/map'
import { probePmtilesRange } from '../utils/pmtiles'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('map network contract', () => {
  it('builds every backend request as an /api relative URL', () => {
    expect(
      buildMapApiUrl('/map/stats', {
        category: '抗生素',
        levels: 'country,admin1,city',
        year: undefined,
      }),
    ).toBe('/api/map/stats?category=%E6%8A%97%E7%94%9F%E7%B4%A0&levels=country%2Cadmin1%2Ccity')
    expect(() => buildMapApiUrl('https://example.test/map/stats')).toThrow(
      '地图接口必须使用 /api 下的相对路径',
    )
  })

  it('requests country, province/state, and city statistics through the relative API', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          message: 'success',
          data: {
            legend: { min: null, max: null, unit: 'mg/day/1000 inh', colors: [] },
            summary: {
              countryCount: 0,
              admin1Count: 0,
              cityCount: 0,
              pointCount: 0,
              recordCount: 0,
              doiCount: 0,
            },
            regions: [],
            points: [],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchMapStats(
      {
        targetClass: 'ALL',
        category: '全部目标物质类别',
        subcategory: '全部小类',
        biomarkerKey: 'ALL',
        year: '全部年份',
      },
      ['country', 'admin1', 'city'],
    )

    expect(result.regions).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/^\/api\/map\/stats\?/)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('levels=country%2Cadmin1%2Ccity')
  })

  it('revalidates the filter contract so a cached legacy response cannot hide new paths', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          message: 'success',
          data: {
            targetClasses: [],
            categories: [],
            categoriesByTargetClass: {},
            subcategoriesByCategory: {},
            biomarkersByCategorySubcategory: {},
            biomarkerPaths: [],
            yearsBySelection: {},
            defaultSelection: {
              targetClass: 'ALL',
              category: '全部目标物质类别',
              subcategory: '全部小类',
              biomarkerKey: 'ALL',
              year: '全部年份',
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchMapFilters()

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/map/filters')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-cache' })
  })

  it('keeps an empty filter result empty during response normalization', () => {
    const response = normalizeMapStatsResponse({
      legend: { min: null, max: null, unit: 'mg/day/1000 inh', colors: [] },
      summary: {
        countryCount: 0,
        admin1Count: 0,
        cityCount: 0,
        pointCount: 0,
        recordCount: 0,
        doiCount: 0,
      },
      regions: [],
      points: [],
      diagnostics: {
        statsRowCount: 0,
        positivePndlCount: 0,
        convertiblePndlCount: 0,
        mappablePndlCount: 0,
        geoLocationCount: 0,
        message: '当前筛选没有可映射的 PNDL 聚合结果。',
      },
    })

    expect(response.regions).toEqual([])
    expect(response.points).toEqual([])
    expect(response.diagnostics?.message).toContain('当前筛选')
  })

  it('accepts a PMTiles archive only when byte Range returns a valid 206 prefix', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('PMTiles', {
        status: 206,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Range': 'bytes 0-6/196455052',
        },
      }),
    )

    await expect(probePmtilesRange('/tiles/wbe-basemap.pmtiles', fetcher)).resolves.toEqual({
      ok: true,
    })
    expect(fetcher).toHaveBeenCalledWith('/tiles/wbe-basemap.pmtiles', {
      cache: 'no-store',
      headers: { Range: 'bytes=0-6' },
    })
  })

  it('rejects a server that ignores Range and answers with the full archive', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('PMTiles and the rest', { status: 200 }))

    await expect(probePmtilesRange('/tiles/wbe-basemap.pmtiles', fetcher)).resolves.toEqual({
      ok: false,
      reason: 'range-unsupported',
    })
  })

  it('reports API failures instead of silently rendering stale empty data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 503, message: '地图服务暂不可用', data: null }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(
      fetchMapStats(
        {
          targetClass: 'ALL',
          category: '全部目标物质类别',
          subcategory: '全部小类',
          biomarkerKey: 'ALL',
          year: '全部年份',
        },
        ['country'],
      ),
    ).rejects.toThrow('服务暂时不可用，请稍后重试')
  })
})
