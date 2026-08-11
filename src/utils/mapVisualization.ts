import type { MapSummaryCard, MapTopBiomarker } from '../types/map'

export type MapDisplayLevel = 'country' | 'admin1' | 'city'

export type MapHierarchyRow = {
  level: MapDisplayLevel
  geoKey?: string
  parentGeoKey?: string | null
}

const ALL_FILTER_VALUE_PATTERN = /^(all|全部|全部年份|全部类别|全部小类|全部生物标记物|全部目标物质类别)$/i

export function isAllFilterContextValue(value: string | null | undefined) {
  return ALL_FILTER_VALUE_PATTERN.test(String(value ?? '').trim())
}

export function detailFilterContext(options: {
  hasSpecificBiomarker: boolean
  biomarkerLabel?: string | null
  year?: string | null
  fallbackParts?: Array<string | null | undefined>
}) {
  const year = isAllFilterContextValue(options.year) ? '' : String(options.year ?? '').trim()
  if (options.hasSpecificBiomarker) {
    return [options.biomarkerLabel, year]
      .map((value) => String(value ?? '').trim())
      .filter((value) => value && !isAllFilterContextValue(value))
      .join(' · ')
  }
  return [...(options.fallbackParts ?? []), year]
    .map((value) => String(value ?? '').trim())
    .filter((value) => value && !isAllFilterContextValue(value))
    .join(' / ')
}

export function isUnassignedGeoKey(level: string, geoKey: string) {
  return (level === 'admin1' || level === 'city') && geoKey.endsWith('|__unassigned__')
}

export function isUnassignedAdmin1GeoKey(level: string, geoKey: string) {
  return level === 'admin1' && isUnassignedGeoKey(level, geoKey)
}

export function excludeUnassignedCityRows<
  T extends { level: string; geoKey?: string; key?: string },
>(rows: T[]) {
  return rows.filter((row) => {
    const geoKey = String(row.geoKey ?? row.key ?? '')
    return !isUnassignedGeoKey(row.level, geoKey) || row.level !== 'city'
  })
}

export function countryLabelStyleForArea(area: number) {
  if (area >= 180) return { size: 13, sort: 0 }
  if (area >= 45) return { size: 12, sort: 1 }
  if (area >= 8) return { size: 10.5, sort: 2 }
  return { size: 9, sort: 3 }
}

export function pndlComparisonsForRegion<T extends { key: string; scopeLevel: string }>(
  comparisons: T[],
  level: string | null | undefined,
  geoKey: string | null | undefined,
) {
  const normalizedLevel = String(level ?? '')
  const normalizedGeoKey = String(geoKey ?? '')
  if (!isUnassignedGeoKey(normalizedLevel, normalizedGeoKey)) return comparisons
  const comparisonScope = normalizedLevel === 'city' ? 'admin1' : 'country'
  const parentComparison = comparisons.find(
    (comparison) =>
      comparison.scopeLevel === comparisonScope || comparison.key === comparisonScope,
  )
  return parentComparison ? [parentComparison] : []
}

const NON_MAINLAND_CHINA_GEO_SEGMENTS = new Set([
  'aomen',
  'hongkong',
  'macao',
  'macau',
  'taiwan',
  'xianggang',
  '台湾',
  '澳门',
  '香港',
])

function normalizedGeoSegments(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .split('|')
    .map((segment) => segment.replace(/[\s_-]+/g, ''))
    .filter(Boolean)
}

export function isMainlandChinaCity(
  geoKey: string | null | undefined,
  parentGeoKey?: string | null,
  provinceKey?: string | null,
) {
  const candidates = [geoKey, parentGeoKey, provinceKey]
    .map(normalizedGeoSegments)
    .filter((segments) => segments.length > 0)
  if (!candidates.some((segments) => segments[0] === 'china')) return false
  return !candidates.some((segments) =>
    segments.slice(1).some((segment) => NON_MAINLAND_CHINA_GEO_SEGMENTS.has(segment)),
  )
}

export function excludeGeometryFromFilter(originalFilter: unknown, geometry: unknown) {
  const outsideGeometry = ['!', ['within', geometry]]
  return originalFilter == null ? outsideGeometry : ['all', originalFilter, outsideGeometry]
}

export const MAP_LEVEL_ZOOM = {
  countryActiveEnd: 3.6,
  adminActiveEnd: 6.3,
  countryFadeStart: 3.3,
  countryFadeEnd: 3.6,
  cityFadeStart: 5.9,
  cityFadeEnd: 6.3,
} as const

export function displayLevelForZoom(zoom: number): MapDisplayLevel {
  if (zoom < MAP_LEVEL_ZOOM.countryActiveEnd) return 'country'
  if (zoom < MAP_LEVEL_ZOOM.adminActiveEnd) return 'admin1'
  return 'city'
}

export function visibleLevelsForZoom(zoom: number): MapDisplayLevel[] {
  return [displayLevelForZoom(zoom)]
}

export function heatRegionLevelForDisplayLevel(level: MapDisplayLevel): MapDisplayLevel {
  return level
}

export function usesCompactHeatFootprint(
  regionLevel: MapDisplayLevel,
  displayLevel: MapDisplayLevel,
) {
  const hierarchyRank: Record<MapDisplayLevel, number> = {
    country: 0,
    admin1: 1,
    city: 2,
  }
  return hierarchyRank[regionLevel] < hierarchyRank[displayLevel]
}

export function compactHeatFootprintPadding(level: MapDisplayLevel) {
  if (level === 'country') return 7
  if (level === 'admin1') return 5
  return 3
}

export function firstActiveRegionCandidate<T>(
  candidates: T[],
  activeRegionIds: ReadonlySet<string>,
  regionId: (candidate: T) => string,
) {
  return candidates.find((candidate) => activeRegionIds.has(regionId(candidate)))
}

export function selectRowsForDisplayLevel<T extends MapHierarchyRow>(
  rows: T[],
  level: MapDisplayLevel,
  countryKey: (row: T) => string,
) {
  if (level === 'country') return rows.filter((row) => row.level === 'country')

  const grouped = new Map<string, T[]>()
  rows.forEach((row) => {
    const key = countryKey(row)
    if (!key) return
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  })

  return [...grouped.entries()].flatMap(([country, countryRows]) => {
    const countryLevelRows = countryRows.filter((row) => row.level === 'country')
    const adminRows = countryRows.filter((row) => row.level === 'admin1')
    const assignedAdminRows = adminRows.filter((row) => !isUnassignedRow(row))
    const unassignedAdminRows = adminRows.filter(isUnassignedRow)
    if (level === 'admin1') {
      return assignedAdminRows.length
        ? assignedAdminRows
        : unassignedAdminRows.length
          ? unassignedAdminRows
          : countryLevelRows
    }

    if (country === 'china') {
      const cityRows = countryRows.filter((row) => row.level === 'city')
      if (!assignedAdminRows.length) {
        const assignedCityRows = cityRows.filter((row) => !isUnassignedRow(row))
        return assignedCityRows
      }
      return assignedAdminRows.flatMap((adminRow) => {
        const adminKey = hierarchyGeoKey(adminRow)
        const childRows = cityRows.filter((row) => hierarchyParentGeoKey(row) === adminKey)
        return childRows.filter((row) => !isUnassignedRow(row))
      })
    }
    return assignedAdminRows.length
      ? assignedAdminRows
      : unassignedAdminRows.length
        ? unassignedAdminRows
        : countryLevelRows
  })
}

function hierarchyGeoKey(row: MapHierarchyRow) {
  return String(row.geoKey ?? (row as MapHierarchyRow & { key?: string }).key ?? '')
}

function hierarchyParentGeoKey(row: MapHierarchyRow) {
  if (row.parentGeoKey) return String(row.parentGeoKey)
  const parts = hierarchyGeoKey(row).split('|')
  return parts.length > 1 ? parts.slice(0, -1).join('|') : ''
}

function isUnassignedRow(row: MapHierarchyRow) {
  return isUnassignedGeoKey(row.level, hierarchyGeoKey(row))
}

export function temperatureBandIndex(value: number, min: number, max: number, bandCount: number) {
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    bandCount <= 1
  ) {
    return 0
  }
  if (max <= min) return Math.floor(bandCount / 2)
  const useLogScale = min > 0 && max / min > 100
  const ratio = useLogScale
    ? (Math.log10(value + 1) - Math.log10(min + 1)) / (Math.log10(max + 1) - Math.log10(min + 1))
    : (value - min) / (max - min)
  return Math.round(Math.max(0, Math.min(1, ratio)) * (bandCount - 1))
}

export function resolveStableHeatRange(
  legendMin: number | null | undefined,
  legendMax: number | null | undefined,
  allLevelValues: number[],
) {
  const fallbackValues = allLevelValues.filter((value) => Number.isFinite(value) && value > 0)
  const fallbackMin = fallbackValues.length ? Math.min(...fallbackValues) : 0
  const fallbackMax = fallbackValues.length ? Math.max(...fallbackValues) : 0
  const min = Number(legendMin)
  const max = Number(legendMax)

  if (Number.isFinite(min) && min > 0 && Number.isFinite(max) && max >= min) {
    return { min, max }
  }
  return { min: fallbackMin, max: fallbackMax }
}

export function regionFillOpacityExpression(hasSpecificBiomarker: boolean) {
  if (!hasSpecificBiomarker) return 0
  return [
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
    0,
  ]
}

const PNDL_VALUE_CARD_LABELS = new Set(['当前PNDL', 'PNDL几何均值', '同层PNDL排名', '当前排名'])
const COMPACT_EXPLORER_CARD_LABELS = new Set([
  '点位',
  '点位数',
  '文献',
  '文献数',
  'biomarker数',
  '生物标记物',
  '生物标记物数',
])

function compactCardLabel(label: string) {
  return String(label ?? '').replace(/\s+/g, '')
}

export function compactExplorerSummaryCards(cards: MapSummaryCard[]) {
  return cards
    .filter((card) => COMPACT_EXPLORER_CARD_LABELS.has(compactCardLabel(card.label)))
    .slice(0, 3)
}

export type BiomarkerExplorerMetricKey = 'records' | 'literature' | 'points'

export function biomarkerExplorerMetricKeys(hasSpecificBiomarker: boolean) {
  return (hasSpecificBiomarker
    ? ['records']
    : ['records', 'literature', 'points']) as BiomarkerExplorerMetricKey[]
}

export type PndlAxisTick = {
  ratio: number
  value: number
}

export function pndlChartScalePercent(
  value: number | null | undefined,
  max: number,
  min: number,
  useLogScale: boolean,
) {
  const numericValue = Number(value ?? 0)
  if (!Number.isFinite(numericValue) || numericValue <= 0 || max <= 0) return 0
  if (useLogScale && min > 0) {
    const denominator = Math.log10(max / min + 1)
    if (denominator <= 0) return 0
    const numerator = Math.log10(numericValue / min + 1)
    return Math.max(0, Math.min(100, (numerator / denominator) * 100))
  }
  return Math.max(0, Math.min(100, (numericValue / max) * 100))
}

export function pndlChartAxisTicks(max: number, min: number, useLogScale: boolean) {
  const ratios = [1, 0.75, 0.5, 0.25, 0]
  if (!Number.isFinite(max) || max <= 0) {
    return ratios.map((ratio) => ({ ratio, value: 0 }))
  }
  const denominator = useLogScale && min > 0 ? Math.log10(max / min + 1) : 0
  return ratios.map((ratio): PndlAxisTick => {
    const value =
      denominator > 0 ? min * (10 ** (ratio * denominator) - 1) : max * ratio
    return { ratio, value: Math.max(0, value) }
  })
}

export function canExploreBiomarker(
  item: Pick<
    MapTopBiomarker,
    'biomarkerKey' | 'recordCount' | 'doiCount' | 'pointCount' | 'hasPndl'
  >,
) {
  return Boolean(
    item.biomarkerKey &&
    (Number(item.recordCount ?? 0) > 0 ||
      Number(item.doiCount ?? 0) > 0 ||
      Number(item.pointCount ?? 0) > 0 ||
      item.hasPndl),
  )
}

export function sortBiomarkersByLiterature(items: MapTopBiomarker[]) {
  return [...items].sort((left, right) => {
    const literatureDifference = Number(right.doiCount ?? 0) - Number(left.doiCount ?? 0)
    if (literatureDifference) return literatureDifference
    const recordDifference = Number(right.recordCount ?? 0) - Number(left.recordCount ?? 0)
    if (recordDifference) return recordDifference
    const pointDifference = Number(right.pointCount ?? 0) - Number(left.pointCount ?? 0)
    if (pointDifference) return pointDifference
    return String(left.biomarkerLabel ?? left.biomarkerKey).localeCompare(
      String(right.biomarkerLabel ?? right.biomarkerKey),
      'zh-CN',
    )
  })
}

export function selectionYearRange(years: string[]) {
  const numericYears = years
    .map((year) => Number(String(year).trim()))
    .filter((year) => Number.isInteger(year) && year >= 1900 && year <= 2100)
    .sort((left, right) => left - right)
  if (!numericYears.length) return ''
  const first = numericYears[0]
  const last = numericYears[numericYears.length - 1]
  return first === last ? String(first) : `${first}-${last}`
}

export function overviewSummaryCards(
  cards: MapSummaryCard[],
  hasSpecificBiomarker: boolean,
  fallbackYearRange = '',
) {
  return cards
    .filter((card) => !PNDL_VALUE_CARD_LABELS.has(compactCardLabel(card.label)))
    .map((card) => {
      if (hasSpecificBiomarker || compactCardLabel(card.label) !== 'PNDL年份数') return card
      return {
        ...card,
        label: '年份范围',
        value: fallbackYearRange || card.value,
        note: '当前区域覆盖年份',
      }
    })
    .slice(0, 6)
}
