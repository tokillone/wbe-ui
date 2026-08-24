import { describe, expect, it } from 'vitest'

import { normalizeMapDetailResponse, normalizeMapStatsResponse } from '../services/map'
import type { MapDetailResponse, MapRegionStat, MapStatsResponse } from '../types/map'
import {
  biomarkerExplorerMetricKeys,
  canExploreBiomarker,
  compactExplorerSummaryCards,
  compactHeatFootprintPadding,
  countryLabelStyleForArea,
  declutterScreenSpaceCandidates,
  detailFilterContext,
  displayLevelForZoom,
  excludeSpecialAdminCityRows,
  excludeUnassignedCityRows,
  excludeGeometryFromFilter,
  firstActiveRegionCandidate,
  heatRegionLevelForDisplayLevel,
  isMainlandChinaCity,
  isUnassignedAdmin1GeoKey,
  isUnassignedGeoKey,
  overviewSummaryCards,
  pndlChartAxisTicks,
  pndlChartScalePercent,
  pndlComparisonsForRegion,
  progressiveDeclutterGap,
  regionFillOpacityExpression,
  resolveStableHeatRange,
  selectRowsForDisplayLevel,
  selectionYearRange,
  sortBiomarkersByLiterature,
  temperatureBandIndex,
  usesCompactHeatFootprint,
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
  it('recognizes reserved unassigned buckets at admin1 and city levels', () => {
    expect(isUnassignedAdmin1GeoKey('admin1', 'usa|__unassigned__')).toBe(true)
    expect(isUnassignedAdmin1GeoKey('country', 'usa|__unassigned__')).toBe(false)
    expect(isUnassignedAdmin1GeoKey('admin1', 'usa|california')).toBe(false)
    expect(isUnassignedGeoKey('city', 'china|qinghai|__unassigned__')).toBe(true)
    expect(isUnassignedGeoKey('country', 'china|__unassigned__')).toBe(false)
  })

  it('gives larger countries higher-priority labels', () => {
    expect(countryLabelStyleForArea(180)).toEqual({ size: 13, sort: 0 })
    expect(countryLabelStyleForArea(45)).toEqual({ size: 12, sort: 1 })
    expect(countryLabelStyleForArea(8)).toEqual({ size: 10.5, sort: 2 })
    expect(countryLabelStyleForArea(7.99)).toEqual({ size: 9, sort: 3 })
  })

  it('uses only the parent-country comparison for an unassigned admin1 bucket', () => {
    const comparisons = [
      { key: 'admin1', scopeLevel: 'admin1' },
      { key: 'country', scopeLevel: 'country' },
    ]

    expect(
      pndlComparisonsForRegion(comparisons, 'admin1', 'unitedsofamerica|__unassigned__'),
    ).toEqual([{ key: 'country', scopeLevel: 'country' }])
    expect(pndlComparisonsForRegion(comparisons, 'admin1', 'unitedsofamerica|newyork')).toEqual(
      comparisons,
    )
  })

  it('uses only the parent admin comparison for an unassigned city bucket', () => {
    const comparisons = [
      { key: 'city', scopeLevel: 'city' },
      { key: 'admin1', scopeLevel: 'admin1' },
      { key: 'country', scopeLevel: 'country' },
    ]

    expect(pndlComparisonsForRegion(comparisons, 'city', 'china|qinghai|__unassigned__')).toEqual([
      { key: 'admin1', scopeLevel: 'admin1' },
    ])
  })

  it('identifies mainland cities without treating Hong Kong, Macao, or Taiwan as mainland', () => {
    expect(isMainlandChinaCity('china|sichuan|chengdu', 'china|sichuan', 'china|sichuan')).toBe(
      true,
    )
    expect(isMainlandChinaCity('china|taiwan|taipei', 'china|taiwan')).toBe(false)
    expect(isMainlandChinaCity('china|hongkong|hongkong', 'china|hongkong')).toBe(false)
    expect(isMainlandChinaCity('china|aomen|macao', 'china|aomen')).toBe(false)
    expect(isMainlandChinaCity('japan|tokyo')).toBe(false)
  })

  it('preserves the original basemap filter when excluding mainland geometry', () => {
    const original = ['==', 'kind', 'locality']
    const geometry = { type: 'Polygon', coordinates: [] }
    const expected = ['all', original, ['!', ['within', geometry]]]

    expect(excludeGeometryFromFilter(original, geometry)).toEqual(expected)
    expect(excludeGeometryFromFilter(original, geometry)).toEqual(expected)
    expect(excludeGeometryFromFilter(null, geometry)).toEqual(['!', ['within', geometry]])
  })

  it('switches from country to admin1 to city at the configured thresholds', () => {
    expect(displayLevelForZoom(3.84)).toBe('country')
    expect(displayLevelForZoom(3.85)).toBe('admin1')
    expect(displayLevelForZoom(6.59)).toBe('admin1')
    expect(displayLevelForZoom(6.6)).toBe('city')
  })

  it('keeps exactly one interactive bubble level visible while zooming', () => {
    expect(visibleLevelsForZoom(3.2)).toEqual(['country'])
    expect(visibleLevelsForZoom(3.4)).toEqual(['country'])
    expect(visibleLevelsForZoom(3.85)).toEqual(['admin1'])
    expect(visibleLevelsForZoom(5.2)).toEqual(['admin1'])
    expect(visibleLevelsForZoom(6.59)).toEqual(['admin1'])
    expect(visibleLevelsForZoom(6.6)).toEqual(['city'])
  })

  it('reduces declutter spacing progressively as each hierarchy level is enlarged', () => {
    expect(progressiveDeclutterGap('country', 1.1)).toBe(12)
    expect(progressiveDeclutterGap('country', 3.85)).toBe(6)
    expect(progressiveDeclutterGap('admin1', 3.85)).toBe(10)
    expect(progressiveDeclutterGap('admin1', 6.6)).toBe(5)
    expect(progressiveDeclutterGap('city', 6.6)).toBe(8)
    expect(progressiveDeclutterGap('city', 8)).toBe(4)
  })

  it('keeps a selected search result and drops lower-priority overlapping label units', () => {
    const visible = declutterScreenSpaceCandidates(
      [
        {
          value: 'belgium',
          order: 0,
          pointCount: 30,
          bounds: { left: 0, top: 0, right: 40, bottom: 40 },
        },
        {
          value: 'netherlands',
          order: 1,
          pointCount: 80,
          bounds: { left: 30, top: 0, right: 80, bottom: 40 },
        },
        {
          value: 'belgium-search',
          order: 2,
          forceVisible: true,
          pointCount: 1,
          bounds: { left: 2, top: 2, right: 42, bottom: 42 },
        },
      ],
      6,
    )
    expect(visible).toEqual(['belgium-search'])
  })

  it('aggregates heat fill at the same hierarchy as the visible bubbles', () => {
    expect(heatRegionLevelForDisplayLevel('country')).toBe('country')
    expect(heatRegionLevelForDisplayLevel('admin1')).toBe('admin1')
    expect(heatRegionLevelForDisplayLevel('city')).toBe('city')
  })

  it('uses a compact heat footprint only for coarse fallback rows at deeper zooms', () => {
    expect(usesCompactHeatFootprint('country', 'country')).toBe(false)
    expect(usesCompactHeatFootprint('country', 'admin1')).toBe(true)
    expect(usesCompactHeatFootprint('admin1', 'country')).toBe(false)
    expect(usesCompactHeatFootprint('admin1', 'admin1')).toBe(false)
    expect(usesCompactHeatFootprint('city', 'admin1')).toBe(false)
    expect(usesCompactHeatFootprint('city', 'city')).toBe(false)
    expect(compactHeatFootprintPadding('country')).toBe(7)
    expect(compactHeatFootprintPadding('admin1')).toBe(5)
    expect(compactHeatFootprintPadding('city')).toBe(3)
  })

  it('ignores finer heat regions when only the country level is interactive', () => {
    const candidates = [
      { id: 'admin1|china|guangdong', label: '广东省' },
      { id: 'country|china', label: '中国' },
    ]

    expect(
      firstActiveRegionCandidate(candidates, new Set(['country|china']), (item) => item.id),
    ).toEqual({ id: 'country|china', label: '中国' })
  })

  it('maps low and high values to opposite temperature bands', () => {
    expect(temperatureBandIndex(1, 1, 1000, 4)).toBe(0)
    expect(temperatureBandIndex(1000, 1, 1000, 4)).toBe(3)
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

  it('uses a lower neutral opacity for covered regions without a PNDL value', () => {
    const expression = regionFillOpacityExpression(true)
    expect(expression).toEqual([
      'case',
      ['==', ['get', 'hasPndlValue'], true],
      [
        'case',
        ['==', ['get', 'level'], 'city'],
        0.76,
        ['==', ['get', 'level'], 'admin1'],
        0.72,
        0.68,
      ],
      ['==', ['get', 'hasCoverage'], true],
      [
        'case',
        ['==', ['get', 'level'], 'city'],
        0.34,
        ['==', ['get', 'level'], 'admin1'],
        0.38,
        0.32,
      ],
      0,
    ])
    expect(regionFillOpacityExpression(false)).toBe(0)
  })

  it('keeps data at its last known level without cross-level fallback', () => {
    const rows = [
      { level: 'country' as const, key: 'canada', country: 'canada' },
      { level: 'country' as const, key: 'usa', country: 'usa' },
      { level: 'admin1' as const, key: 'usa|california', country: 'usa' },
      { level: 'country' as const, key: 'china', country: 'china' },
      { level: 'admin1' as const, key: 'china|guangdong', country: 'china' },
      { level: 'city' as const, key: 'china|guangdong|guangzhou', country: 'china' },
    ]

    expect(
      selectRowsForDisplayLevel(rows, 'admin1', (row) => row.country).map((row) => row.key),
    ).toEqual(['usa|california', 'china|guangdong'])
    expect(
      selectRowsForDisplayLevel(rows, 'city', (row) => row.country).map((row) => row.key),
    ).toEqual(['china|guangdong|guangzhou'])
  })

  it('never promotes unassigned admin rows into the admin1 display level', () => {
    const rows = [
      { level: 'country' as const, key: 'vietnam', country: 'vietnam' },
      { level: 'admin1' as const, key: 'vietnam|__unassigned__', country: 'vietnam' },
      { level: 'country' as const, key: 'spain', country: 'spain' },
      { level: 'admin1' as const, key: 'spain|madrid', country: 'spain' },
      { level: 'admin1' as const, key: 'spain|__unassigned__', country: 'spain' },
    ]

    expect(
      selectRowsForDisplayLevel(rows, 'admin1', (row) => row.country).map((row) => row.key),
    ).toEqual(['spain|madrid'])
  })

  it('shows real cities and excludes unassigned city buckets at city level', () => {
    const rows = [
      { level: 'country' as const, geoKey: 'china', key: 'china', country: 'china' },
      {
        level: 'admin1' as const,
        geoKey: 'china|qinghai',
        key: 'china|qinghai',
        country: 'china',
      },
      {
        level: 'admin1' as const,
        geoKey: 'china|sichuan',
        key: 'china|sichuan',
        country: 'china',
      },
      {
        level: 'city' as const,
        geoKey: 'china|qinghai|xining',
        parentGeoKey: 'china|qinghai',
        key: 'china|qinghai|xining',
        country: 'china',
      },
      {
        level: 'city' as const,
        geoKey: 'china|qinghai|__unassigned__',
        parentGeoKey: 'china|qinghai',
        key: 'china|qinghai|__unassigned__',
        country: 'china',
      },
      {
        level: 'city' as const,
        geoKey: 'china|sichuan|__unassigned__',
        parentGeoKey: 'china|sichuan',
        key: 'china|sichuan|__unassigned__',
        country: 'china',
      },
    ]

    expect(
      selectRowsForDisplayLevel(rows, 'city', (row) => row.country).map((row) => row.key),
    ).toEqual(['china|qinghai|xining'])
    expect(excludeUnassignedCityRows(rows).map((row) => row.key)).not.toContain(
      'china|qinghai|__unassigned__',
    )
  })

  it('keeps city views empty when a province only has unassigned city data', () => {
    const rows = [
      { level: 'country' as const, geoKey: 'china', key: 'china', country: 'china' },
      {
        level: 'admin1' as const,
        geoKey: 'china|heilongjiang',
        key: 'china|heilongjiang',
        country: 'china',
      },
      {
        level: 'city' as const,
        geoKey: 'china|heilongjiang|__unassigned__',
        parentGeoKey: 'china|heilongjiang',
        key: 'china|heilongjiang|__unassigned__',
        country: 'china',
      },
    ]

    expect(selectRowsForDisplayLevel(rows, 'city', (row) => row.country)).toEqual([])
  })

  it('filters legacy Hong Kong and Macao pseudo-city rows from China city views', () => {
    const rows = [
      { level: 'admin1' as const, geoKey: 'china|hongkong', country: 'china' },
      { level: 'admin1' as const, geoKey: 'china|aomen', country: 'china' },
      {
        level: 'city' as const,
        geoKey: 'china|hongkong|hongkong',
        parentGeoKey: 'china|hongkong',
        country: 'china',
      },
      {
        level: 'city' as const,
        geoKey: 'china|aomen|macao',
        parentGeoKey: 'china|aomen',
        country: 'china',
      },
      {
        level: 'city' as const,
        geoKey: 'china|guangdong|zhongshan',
        parentGeoKey: 'china|guangdong',
        country: 'china',
      },
      { level: 'admin1' as const, geoKey: 'china|guangdong', country: 'china' },
    ]

    expect(
      selectRowsForDisplayLevel(rows, 'city', (row) => row.country).map((row) => row.geoKey),
    ).toEqual(['china|guangdong|zhongshan'])
    expect(excludeSpecialAdminCityRows(rows).map((row) => row.geoKey)).toEqual([
      'china|hongkong',
      'china|aomen',
      'china|guangdong|zhongshan',
      'china|guangdong',
    ])
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

  it('removes repeated literature and point metrics after selecting a biomarker', () => {
    expect(biomarkerExplorerMetricKeys(true)).toEqual(['records'])
    expect(biomarkerExplorerMetricKeys(false)).toEqual(['records', 'literature', 'points'])
  })

  it('keeps only the selected biomarker and a specific year in detail context', () => {
    expect(
      detailFilterContext({
        hasSpecificBiomarker: true,
        biomarkerLabel: '磺胺甲噁唑',
        year: '全部年份',
        fallbackParts: ['J 系统用抗感染药物', 'J01 系统用抗菌药', '全部小类'],
      }),
    ).toBe('磺胺甲噁唑')
    expect(
      detailFilterContext({
        hasSpecificBiomarker: true,
        biomarkerLabel: '磺胺甲噁唑',
        year: '2021',
      }),
    ).toBe('磺胺甲噁唑 · 2021')
  })

  it('removes all-value placeholders from non-biomarker detail context', () => {
    expect(
      detailFilterContext({
        hasSpecificBiomarker: false,
        year: '全部年份',
        fallbackParts: ['健康状态类', '全部目标物质类别', '全部小类'],
      }),
    ).toBe('健康状态类')
  })

  it('builds linear and logarithmic PNDL ticks from the same bar scale', () => {
    const linearTicks = pndlChartAxisTicks(100, 20, false)
    expect(linearTicks.map((tick) => tick.value)).toEqual([100, 75, 50, 25, 0])
    expect(pndlChartScalePercent(75, 100, 20, false)).toBe(75)

    const logTicks = pndlChartAxisTicks(1000, 1, true)
    expect(logTicks[0]?.value).toBeCloseTo(1000)
    expect(logTicks[logTicks.length - 1]?.value).toBe(0)
    logTicks.forEach((tick) => {
      expect(pndlChartScalePercent(tick.value, 1000, 1, true)).toBeCloseTo(tick.ratio * 100)
    })
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
      summary: {
        countryCount: 1,
        admin1Count: 0,
        cityCount: 0,
        pointCount: 1,
        recordCount: 1,
        doiCount: 1,
      },
      regions: [{ ...legacyChinaRegion, pndlMedianMgD1000inh: 244 }],
      points: [{ ...legacyChinaRegion, pndlMedianMgD1000inh: 244 }],
    } satisfies MapStatsResponse)

    expect(response.regions[0]?.pndlMedianMgD1000inh).toBe(244)
    expect(response.points[0]?.pndlMedianMgD1000inh).toBe(244)
  })

  it('removes stale special-admin pseudo cities from stats and recalculates the summary', () => {
    const hongKongAdmin = {
      ...legacyChinaRegion,
      level: 'admin1' as const,
      geoKey: 'china|hongkong',
      displayName: '香港特别行政区',
      recordCount: 4,
      doiCount: 1,
    }
    const hongKongPseudoCity = {
      ...hongKongAdmin,
      level: 'city' as const,
      geoKey: 'china|hongkong|hongkong',
      parentGeoKey: 'china|hongkong',
    }
    const zhongshan = {
      ...legacyChinaRegion,
      level: 'city' as const,
      geoKey: 'china|guangdong|zhongshan',
      parentGeoKey: 'china|guangdong',
      displayName: '中山市',
      recordCount: 3,
      doiCount: 1,
    }
    const response = normalizeMapStatsResponse({
      legend: { min: 1, max: 500, unit: 'mg/day/1000 inh', colors: [] },
      summary: {
        countryCount: 0,
        admin1Count: 1,
        cityCount: 2,
        pointCount: 3,
        recordCount: 11,
        doiCount: 3,
      },
      regions: [hongKongAdmin, hongKongPseudoCity, zhongshan],
      points: [hongKongAdmin, hongKongPseudoCity, zhongshan],
    } satisfies MapStatsResponse)

    expect(response.regions.map((row) => row.geoKey)).toEqual([
      'china|hongkong',
      'china|guangdong|zhongshan',
    ])
    expect(response.points.map((row) => row.geoKey)).toEqual([
      'china|hongkong',
      'china|guangdong|zhongshan',
    ])
    expect(response.summary).toEqual({
      countryCount: 0,
      admin1Count: 1,
      cityCount: 1,
      pointCount: 2,
      recordCount: 7,
      doiCount: 2,
    })
  })

  it('removes stale special-admin pseudo cities from detail comparisons and rankings', () => {
    const hongKongPseudoCity = {
      rank: 1,
      level: 'city' as const,
      geoKey: 'china|hongkong|hongkong',
      displayName: '香港特别行政区',
      pndlMedianMgD1000inh: 14452,
    }
    const zhongshan = {
      rank: 2,
      level: 'city' as const,
      geoKey: 'china|guangdong|zhongshan',
      displayName: '中山市',
      pndlMedianMgD1000inh: null,
    }
    const response = normalizeMapDetailResponse({
      region: { ...legacyChinaRegion, level: 'city', geoKey: hongKongPseudoCity.geoKey },
      locations: [
        { ...legacyChinaRegion, level: 'city', geoKey: hongKongPseudoCity.geoKey },
        { ...legacyChinaRegion, level: 'city', geoKey: zhongshan.geoKey },
      ],
      pndlRanking: [hongKongPseudoCity, zhongshan],
      pndlComparisons: [
        {
          key: 'admin1',
          label: '城市横向比较',
          scopeLevel: 'admin1',
          rows: [hongKongPseudoCity, zhongshan],
        },
      ],
      sources: [],
    } satisfies MapDetailResponse)

    expect(response.region).toBeNull()
    expect(response.locations?.map((row) => row.geoKey)).toEqual(['china|guangdong|zhongshan'])
    expect(response.pndlRanking?.map((row) => row.geoKey)).toEqual(['china|guangdong|zhongshan'])
    expect(response.pndlComparisons?.[0]?.rows.map((row) => row.geoKey)).toEqual([
      'china|guangdong|zhongshan',
    ])
  })
})
