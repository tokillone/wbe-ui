import type { MapSummaryCard } from '../types/map'

export type MapDisplayLevel = 'country' | 'admin1' | 'city'

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

const PNDL_VALUE_CARD_LABELS = new Set(['当前PNDL', 'PNDL几何均值', '同层PNDL排名', '当前排名'])

function compactCardLabel(label: string) {
  return String(label ?? '').replace(/\s+/g, '')
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
