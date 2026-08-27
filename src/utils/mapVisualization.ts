import type { MapSummaryCard, MapTopBiomarker } from '../types/map'

export { countryLabelStyleForArea } from './mapLabelTypography'

export type MapDisplayLevel = 'country' | 'admin1' | 'city'

export type ScreenSpaceBounds = {
  left: number
  top: number
  right: number
  bottom: number
}

export type ScreenSpaceDeclutterCandidate<T> = {
  value: T
  bounds: ScreenSpaceBounds
  alternativeBounds?: ScreenSpaceBounds[]
  order: number
  forceVisible?: boolean
  hovered?: boolean
  pointCount?: number
  recordCount?: number
  area?: number
}

export type ScreenSpaceDeclutterPlacement<T> = {
  value: T
  bounds: ScreenSpaceBounds
  placementIndex: number
}

export type MapHierarchyRow = {
  level: MapDisplayLevel
  geoKey?: string
  parentGeoKey?: string | null
}

export type AdaptiveHeatScale = {
  count: number
  distinctCount: number
  min: number
  median: number
  max: number
  colors: string[]
  groups: Array<{
    value: number
    percentile: number
    colorIndex: number
  }>
}

const SPECIAL_ADMIN_CITY_GEO_KEYS = new Set(['china|hongkong|hongkong', 'china|aomen|macao'])

const ALL_FILTER_VALUE_PATTERN =
  /^(all|全部|全部年份|全部类别|全部小类|全部生物标记物|全部目标物质类别)$/i

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

export function isSpecialAdminCityGeoKey(level: string, geoKey: string | null | undefined) {
  return level === 'city' && SPECIAL_ADMIN_CITY_GEO_KEYS.has(String(geoKey ?? '').toLowerCase())
}

export function excludeSpecialAdminCityRows<
  T extends { level: string; geoKey?: string; key?: string },
>(rows: T[]) {
  return rows.filter((row) => {
    const geoKey = String(row.geoKey ?? row.key ?? '')
    return !isSpecialAdminCityGeoKey(row.level, geoKey)
  })
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
    (comparison) => comparison.scopeLevel === comparisonScope || comparison.key === comparisonScope,
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
  countryActiveEnd: 3.85,
  adminActiveEnd: 6.6,
  countryFadeStart: 3.85,
  countryFadeEnd: 3.85,
  cityFadeStart: 6.6,
  cityFadeEnd: 6.6,
} as const

export function displayLevelForZoom(zoom: number): MapDisplayLevel {
  if (zoom < MAP_LEVEL_ZOOM.countryActiveEnd) return 'country'
  if (zoom < MAP_LEVEL_ZOOM.adminActiveEnd) return 'admin1'
  return 'city'
}

export function visibleLevelsForZoom(zoom: number): MapDisplayLevel[] {
  return [displayLevelForZoom(zoom)]
}

export function progressiveDeclutterGap(level: MapDisplayLevel, zoom: number) {
  const [startZoom, endZoom, startGap, endGap] =
    level === 'country'
      ? [1.1, MAP_LEVEL_ZOOM.countryActiveEnd, 12, 6]
      : level === 'admin1'
        ? [MAP_LEVEL_ZOOM.countryActiveEnd, MAP_LEVEL_ZOOM.adminActiveEnd, 10, 5]
        : [MAP_LEVEL_ZOOM.adminActiveEnd, 8, 8, 4]
  const progress = Math.min(Math.max((zoom - startZoom) / (endZoom - startZoom), 0), 1)
  return startGap + (endGap - startGap) * progress
}

export function declutterScreenSpaceCandidates<T>(
  candidates: ScreenSpaceDeclutterCandidate<T>[],
  gap: number,
) {
  return declutterScreenSpacePlacements(candidates, gap).map((item) => item.value)
}

export function declutterScreenSpacePlacements<T>(
  candidates: ScreenSpaceDeclutterCandidate<T>[],
  gap: number,
  reservedBounds: ScreenSpaceBounds[] = [],
): ScreenSpaceDeclutterPlacement<T>[] {
  const sorted = [...candidates].sort((left, right) => {
    if (Boolean(right.forceVisible) !== Boolean(left.forceVisible)) {
      return Number(Boolean(right.forceVisible)) - Number(Boolean(left.forceVisible))
    }
    if (Boolean(right.hovered) !== Boolean(left.hovered)) {
      return Number(Boolean(right.hovered)) - Number(Boolean(left.hovered))
    }
    if ((right.pointCount ?? 0) !== (left.pointCount ?? 0)) {
      return (right.pointCount ?? 0) - (left.pointCount ?? 0)
    }
    if ((right.recordCount ?? 0) !== (left.recordCount ?? 0)) {
      return (right.recordCount ?? 0) - (left.recordCount ?? 0)
    }
    if ((right.area ?? 0) !== (left.area ?? 0)) {
      return (right.area ?? 0) - (left.area ?? 0)
    }
    return left.order - right.order
  })
  const accepted: ScreenSpaceDeclutterPlacement<T>[] = []
  sorted.forEach((candidate) => {
    const options = [candidate.bounds, ...(candidate.alternativeBounds ?? [])]
    const placementIndex = options.findIndex(
      (bounds) =>
        !reservedBounds.some((reserved) => screenSpaceBoundsIntersect(bounds, reserved, gap)) &&
        !accepted.some((item) => screenSpaceBoundsIntersect(bounds, item.bounds, gap)),
    )
    if (placementIndex >= 0) {
      accepted.push({ value: candidate.value, bounds: options[placementIndex]!, placementIndex })
    }
  })
  const order = new Map(candidates.map((candidate) => [candidate.value, candidate.order]))
  return accepted.sort(
    (left, right) => (order.get(left.value) ?? 0) - (order.get(right.value) ?? 0),
  )
}

function screenSpaceBoundsIntersect(
  left: ScreenSpaceBounds,
  right: ScreenSpaceBounds,
  gap: number,
) {
  return !(
    left.right + gap <= right.left ||
    right.right + gap <= left.left ||
    left.bottom + gap <= right.top ||
    right.bottom + gap <= left.top
  )
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
  _countryKey: (row: T) => string,
) {
  if (level === 'country') return rows.filter((row) => row.level === 'country')

  // Unassigned records belong to their last known parent aggregate. They are
  // intentionally not promoted into a more detailed visual level: doing so
  // would fabricate a location and duplicate the parent's fill/bubble.
  return rows.filter((row) => {
    if (row.level !== level || isUnassignedRow(row)) return false
    return level !== 'city' || !isSpecialAdminCityGeoKey(row.level, hierarchyGeoKey(row))
  })
}

export function buildAdaptiveHeatScale(
  values: number[],
  palette: readonly string[],
): AdaptiveHeatScale {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right)
  if (!sorted.length || !palette.length) {
    return {
      count: 0,
      distinctCount: 0,
      min: 0,
      median: 0,
      max: 0,
      colors: [],
      groups: [],
    }
  }

  const rawGroups: Array<{ value: number; start: number; end: number }> = []
  sorted.forEach((value, index) => {
    const previous = rawGroups[rawGroups.length - 1]
    if (previous?.value === value) {
      previous.end = index
    } else {
      rawGroups.push({ value, start: index, end: index })
    }
  })

  const bandCount = Math.min(palette.length, rawGroups.length)
  const colors =
    bandCount === 1
      ? [palette[Math.floor((palette.length - 1) / 2)]!]
      : Array.from({ length: bandCount }, (_, index) => {
          const paletteIndex = Math.round((index * (palette.length - 1)) / (bandCount - 1))
          return palette[paletteIndex]!
        })
  const denominator = Math.max(sorted.length - 1, 1)
  const groups = rawGroups.map(({ value, start, end }) => {
    const percentile = sorted.length === 1 ? 0.5 : (start + end) / 2 / denominator
    return {
      value,
      percentile,
      colorIndex: Math.min(colors.length - 1, Math.floor(percentile * colors.length)),
    }
  })
  const middle = (sorted.length - 1) / 2
  const lowerMiddle = sorted[Math.floor(middle)]!
  const upperMiddle = sorted[Math.ceil(middle)]!

  return {
    count: sorted.length,
    distinctCount: rawGroups.length,
    min: sorted[0]!,
    median: (lowerMiddle + upperMiddle) / 2,
    max: sorted[sorted.length - 1]!,
    colors,
    groups,
  }
}

export function adaptiveHeatPercentile(scale: AdaptiveHeatScale, value: number) {
  if (!Number.isFinite(value) || value <= 0 || !scale.groups.length) return 0.5
  let low = 0
  let high = scale.groups.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (scale.groups[middle]!.value < value) low = middle + 1
    else high = middle
  }
  const exact = scale.groups[low]
  if (exact?.value === value) return exact.percentile
  if (low === 0) return 0
  if (low >= scale.groups.length) return 1
  const lower = scale.groups[low - 1]!
  const upper = scale.groups[low]!
  const ratio = (value - lower.value) / Math.max(upper.value - lower.value, Number.EPSILON)
  return lower.percentile + ratio * (upper.percentile - lower.percentile)
}

export function adaptiveHeatColor(scale: AdaptiveHeatScale, value: number, fallback: string) {
  if (!scale.colors.length || !Number.isFinite(value) || value <= 0) return fallback
  const percentile = adaptiveHeatPercentile(scale, value)
  const index = Math.min(
    scale.colors.length - 1,
    Math.floor(Math.max(0, Math.min(1, percentile)) * scale.colors.length),
  )
  return scale.colors[index] ?? fallback
}

function hierarchyGeoKey(row: MapHierarchyRow) {
  return String(row.geoKey ?? (row as MapHierarchyRow & { key?: string }).key ?? '')
}

function isUnassignedRow(row: MapHierarchyRow) {
  return isUnassignedGeoKey(row.level, hierarchyGeoKey(row))
}

export function regionFillOpacityExpression(hasSpecificBiomarker: boolean) {
  if (!hasSpecificBiomarker) return 0
  return [
    'case',
    ['any', ['==', ['get', 'hasPndlValue'], true], ['==', ['get', 'hasCoverage'], true]],
    1,
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
  return (
    hasSpecificBiomarker ? ['records'] : ['records', 'literature', 'points']
  ) as BiomarkerExplorerMetricKey[]
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
    const value = denominator > 0 ? min * (10 ** (ratio * denominator) - 1) : max * ratio
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
