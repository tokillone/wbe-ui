import { describe, expect, it } from 'vitest'

import { normalizeMapDetailResponse, normalizeMapStatsResponse } from '../services/map'
import type { MapDetailResponse, MapRegionStat, MapStatsResponse } from '../types/map'
import {
  canExploreBiomarker,
  compactExplorerSummaryCards,
  displayLevelForZoom,
  overviewSummaryCards,
  resolveStableHeatRange,
  selectRowsForDisplayLevel,
  selectionYearRange,
  sortBiomarkersByLiterature,
  temperatureBandIndex,
  visibleLevelsForZoom,
} from '../utils/mapVisualization'

const legacyChinaRegion: MapRegionStat = {
  level: 'country',
  geoKey: 'china',
  displayName: 'China',
  category: '烟草使用标志物',
  subcategory: '尼古丁及代谢物',
  biomarkerKey: '486566',
  biomarkerLabel: '可替宁',
  yearLabel: '全部年份',
  pndlGeomeanMgD1000inh: 239.650614993,
}

describe('map visualization hierarchy', () => {
  it('switches from country to admin1 to city at the configured thresholds', () => {
    expect(displayLevelForZoom(3.9)).toBe('country')
    expect(displayLevelForZoom(4.4)).toBe('admin1')
    expect(displayLevelForZoom(6.3)).toBe('city')
  })

  it('only overlaps levels inside the two short fade windows', () => {
    expect(visibleLevelsForZoom(3.9)).toEqual(['country'])
    expect(visibleLevelsForZoom(4.2)).toEqual(['country', 'admin1'])
    expect(visibleLevelsForZoom(5.2)).toEqual(['admin1'])
    expect(visibleLevelsForZoom(6.1)).toEqual(['admin1', 'city'])
    expect(visibleLevelsForZoom(6.4)).toEqual(['city'])
  })

  it('maps low and high values to opposite temperature bands', () => {
    expect(temperatureBandIndex(1, 1, 1000, 7)).toBe(0)
    expect(temperatureBandIndex(1000, 1, 1000, 7)).toBe(6)
  })

  it('keeps the backend heat range stable when the visible hierarchy changes', () => {
    const countryRange = resolveStableHeatRange(50, 5478, [100, 5478])
    const cityRange = resolveStableHeatRange(50, 5478, [50, 527.6, 5478])

    expect(countryRange).toEqual({ min: 50, max: 5478 })
    expect(cityRange).toEqual(countryRange)
    expect(temperatureBandIndex(527.6, countryRange.min, countryRange.max, 7)).toBe(
      temperatureBandIndex(527.6, cityRange.min, cityRange.max, 7),
    )
  })

  it('falls back to all hierarchy values when a legacy response has no legend range', () => {
    expect(resolveStableHeatRange(null, null, [100, 50, 5478])).toEqual({ min: 50, max: 5478 })
  })

  it('keeps a per-country fallback when the map reaches city zoom', () => {
    const rows = [
      { level: 'country' as const, key: 'canada', country: 'canada' },
      { level: 'country' as const, key: 'usa', country: 'usa' },
      { level: 'admin1' as const, key: 'usa|california', country: 'usa' },
      { level: 'country' as const, key: 'china', country: 'china' },
      { level: 'admin1' as const, key: 'china|guangdong', country: 'china' },
      { level: 'city' as const, key: 'china|guangdong|guangzhou', country: 'china' },
    ]

    expect(selectRowsForDisplayLevel(rows, 'admin1', (row) => row.country).map((row) => row.key))
      .toEqual(['canada', 'usa|california', 'china|guangdong'])
    expect(selectRowsForDisplayLevel(rows, 'city', (row) => row.country).map((row) => row.key))
      .toEqual(['canada', 'usa|california', 'china|guangdong|guangzhou'])
  })

  it('keeps exactly the three compact coverage metrics', () => {
    const cards = compactExplorerSummaryCards([
      { label: '点位数', value: '119' },
      { label: '文献数', value: '5' },
      { label: '记录数', value: '395' },
      { label: 'biomarker 数', value: '20' },
      { label: '当前 PNDL', value: '无数据' },
    ])

    expect(cards.map((card) => card.label)).toEqual(['点位数', '文献数', 'biomarker 数'])
  })

  it('allows biomarker exploration when coverage exists without PNDL', () => {
    expect(
      canExploreBiomarker({
        biomarkerKey: 'metformin',
        recordCount: 42,
        doiCount: 3,
        pointCount: 8,
        hasPndl: false,
      }),
    ).toBe(true)
  })

  it('sorts biomarker exploration by literature before record count', () => {
    const sorted = sortBiomarkersByLiterature([
      { biomarkerKey: 'a', biomarkerLabel: 'A', doiCount: 2, recordCount: 500 },
      { biomarkerKey: 'b', biomarkerLabel: 'B', doiCount: 8, recordCount: 40 },
      { biomarkerKey: 'c', biomarkerLabel: 'C', doiCount: 8, recordCount: 90 },
    ])

    expect(sorted.map((item) => item.biomarkerKey)).toEqual(['c', 'b', 'a'])
  })

  it('shows a year range and keeps six overview cards when no biomarker is selected', () => {
    const cards = overviewSummaryCards(
      [
        { label: '点位数', value: '1189' },
        { label: '文献数', value: '77' },
        { label: '记录数', value: '10508' },
        { label: 'biomarker 数', value: '350' },
        { label: 'PNDL 年份数', value: '0' },
        { label: '涉及城市数', value: '300' },
        { label: '当前 PNDL', value: '无数据' },
        { label: '同层 PNDL 排名', value: '-' },
      ],
      false,
      selectionYearRange(['全部年份', '2014', '2012', '2023']),
    )

    expect(cards).toHaveLength(6)
    expect(cards[4]).toMatchObject({ label: '年份范围', value: '2012-2023' })
    expect(cards.map((card) => card.label)).not.toContain('当前 PNDL')
    expect(cards.map((card) => card.label)).not.toContain('同层 PNDL 排名')
  })

  it('normalizes legacy geomean fields so comparison charts do not render no-data bars', () => {
    const response = normalizeMapDetailResponse({
      region: legacyChinaRegion,
      sources: [],
      summaryCards: [{ label: 'PNDL 几何均值', value: '239.7', note: 'mg/day/1000 inh' }],
      pndlComparisons: [
        {
          key: 'country',
          label: '国家横向比较',
          scopeLevel: 'country',
          rows: [
            {
              rank: 1,
              level: 'country',
              geoKey: 'china',
              displayName: 'China',
              pndlGeomeanMgD1000inh: 310.680683,
              selected: true,
            },
          ],
        },
      ],
    } satisfies MapDetailResponse)

    expect(response.region?.pndlMedianMgD1000inh).toBeCloseTo(239.650614993)
    expect(response.pndlComparisons?.[0]?.rows[0]?.pndlMedianMgD1000inh).toBeCloseTo(239.650614993)
    expect(response.summaryCards?.[0]?.label).toBe('当前 PNDL')
  })

  it('keeps the new median value when both API generations are present', () => {
    const response = normalizeMapStatsResponse({
      legend: { min: 1, max: 500, unit: 'mg/day/1000 inh', colors: [] },
      summary: { countryCount: 1, admin1Count: 0, cityCount: 0, pointCount: 1, recordCount: 1, doiCount: 1 },
      regions: [{ ...legacyChinaRegion, pndlMedianMgD1000inh: 244 }],
      points: [{ ...legacyChinaRegion, pndlMedianMgD1000inh: 244 }],
    } satisfies MapStatsResponse)

    expect(response.regions[0]?.pndlMedianMgD1000inh).toBe(244)
    expect(response.points[0]?.pndlMedianMgD1000inh).toBe(244)
  })
})
