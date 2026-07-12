import type { MapSummaryCard, MapTopBiomarker } from '../types/map'

export type MapDisplayLevel = 'country' | 'admin1' | 'city'

export type MapHierarchyRow = {
  level: MapDisplayLevel
}

export const MAP_LEVEL_ZOOM = {
  countryActiveEnd: 4.2,
  adminActiveEnd: 6.1,
  countryFadeStart: 4,
  countryFadeEnd: 4.4,
  cityFadeStart: 5.9,
  cityFadeEnd: 6.3,
} as const

export function displayLevelForZoom(zoom: number): MapDisplayLevel {
  if (zoom < MAP_LEVEL_ZOOM.countryActiveEnd) return 'country'
  if (zoom < MAP_LEVEL_ZOOM.adminActiveEnd) return 'admin1'
  return 'city'
}

export function visibleLevelsForZoom(zoom: number): MapDisplayLevel[] {
  const levels: MapDisplayLevel[] = []
  if (zoom < MAP_LEVEL_ZOOM.countryFadeEnd) levels.push('country')
  if (zoom >= MAP_LEVEL_ZOOM.countryFadeStart && zoom < MAP_LEVEL_ZOOM.cityFadeEnd) {
    levels.push('admin1')
  }
  if (zoom >= MAP_LEVEL_ZOOM.cityFadeStart) levels.push('city')
  return levels
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
    if (level === 'admin1') return adminRows.length ? adminRows : countryLevelRows

    if (country === 'china') {
      const cityRows = countryRows.filter((row) => row.level === 'city')
      return cityRows.length ? cityRows : adminRows.length ? adminRows : countryLevelRows
    }
    return adminRows.length ? adminRows : countryLevelRows
  })
}

export function temperatureBandIndex(value: number, min: number, max: number, bandCount: number) {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(min) || !Number.isFinite(max) || bandCount <= 1) {
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
  return cards.filter((card) => COMPACT_EXPLORER_CARD_LABELS.has(compactCardLabel(card.label))).slice(0, 3)
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
