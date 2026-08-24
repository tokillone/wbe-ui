import {
  CITY_LEVEL_ENTER_ZOOM,
  CITY_LEVEL_EXIT_ZOOM,
  COUNTRY_LEVEL_END_ZOOM,
} from './mapRuntime'

export type MapLabelLevel = 'country' | 'admin1' | 'city'

export const COUNTRY_LABEL_SCALE = 1.12
export const COUNTRY_LABEL_ZOOM_GROWTH = 1.1
export const ADMIN1_LABEL_MIN_SIZE = 10.4
export const ADMIN1_LABEL_MAX_SIZE = 13.4
export const CITY_LABEL_MIN_ZOOM = 6.3
export const CITY_LABEL_MIN_SIZE = 9.2
export const CITY_LABEL_MAX_SIZE = 12.6

export const MAP_POINT_COUNT_THRESHOLDS: Record<MapLabelLevel, readonly number[]> = {
  country: [20, 80, 300, 1000],
  admin1: [5, 20, 80, 300],
  city: [3, 10, 30, 100],
}

export const MAP_LABEL_COUNT_SCALES = [1, 1.03, 1.06, 1.09, 1.12] as const

export function countryLabelStyleForArea(area: number) {
  if (area >= 180) return { size: 13, sort: 0 }
  if (area >= 45) return { size: 12, sort: 1 }
  if (area >= 8) return { size: 10.5, sort: 2 }
  return { size: 9, sort: 3 }
}

export function labelCountTier(level: MapLabelLevel, pointCount: number) {
  const safeCount = Number.isFinite(pointCount) ? Math.max(0, pointCount) : 0
  const index = MAP_POINT_COUNT_THRESHOLDS[level].findIndex((threshold) => safeCount < threshold)
  return index < 0 ? MAP_LABEL_COUNT_SCALES.length - 1 : index
}

export function labelScaleForPointCount(level: MapLabelLevel, pointCount: number) {
  return MAP_LABEL_COUNT_SCALES[labelCountTier(level, pointCount)] ?? 1
}

export function labelBaseSize(level: MapLabelLevel, countryArea = 0) {
  if (level === 'country') {
    return countryLabelStyleForArea(countryArea).size * COUNTRY_LABEL_SCALE
  }
  return level === 'admin1' ? ADMIN1_LABEL_MIN_SIZE : CITY_LABEL_MIN_SIZE
}

export function staticLabelSizeAtZoom(level: MapLabelLevel, zoom: number, countryArea = 0) {
  if (level === 'country') {
    return (
      labelBaseSize(level, countryArea) +
      interpolateClamped(zoom, 1.1, 3.85, 0, COUNTRY_LABEL_ZOOM_GROWTH)
    )
  }
  if (level === 'admin1') {
    return interpolateClamped(
      zoom,
      3.85,
      8,
      ADMIN1_LABEL_MIN_SIZE,
      ADMIN1_LABEL_MAX_SIZE,
    )
  }
  return interpolateClamped(
    zoom,
    CITY_LABEL_MIN_ZOOM,
    8,
    CITY_LABEL_MIN_SIZE,
    CITY_LABEL_MAX_SIZE,
  )
}

export function labelDataEmphasisAtZoom(level: MapLabelLevel, zoom: number) {
  if (level === 'country') {
    if (zoom <= 1.1 || zoom >= 3.85) return 0
    if (zoom < 1.35) return interpolateClamped(zoom, 1.1, 1.35, 0, 1)
    if (zoom <= 3.6) return 1
    return interpolateClamped(zoom, 3.6, 3.85, 1, 0)
  }
  if (level === 'admin1') {
    if (zoom <= 3.85 || zoom >= 6.6) return 0
    if (zoom < 4.1) return interpolateClamped(zoom, 3.85, 4.1, 0, 1)
    if (zoom <= 6.35) return 1
    return interpolateClamped(zoom, 6.35, 6.6, 1, 0)
  }
  if (zoom <= 6.45) return 0
  return zoom < 6.7 ? interpolateClamped(zoom, 6.45, 6.7, 0, 1) : 1
}

export function businessLabelSizeAtZoom(
  level: MapLabelLevel,
  zoom: number,
  pointCount: number,
  countryArea = 0,
) {
  const countScale = labelScaleForPointCount(level, pointCount)
  const emphasis = labelDataEmphasisAtZoom(level, zoom)
  return staticLabelSizeAtZoom(level, zoom, countryArea) * (1 + (countScale - 1) * emphasis)
}

/**
 * MapLibre only permits `zoom` at the top level of a step/interpolate expression.
 * Build the feature-dependent size at each transition stop so the runtime style
 * keeps the same typography model without nesting a zoom expression in math.
 */
export function businessLabelTextSizeExpression(level: MapLabelLevel) {
  const stops =
    level === 'country'
      ? [1.1, 1.35, 3.6, COUNTRY_LEVEL_END_ZOOM]
      : level === 'admin1'
        ? [COUNTRY_LEVEL_END_ZOOM, 4.1, 6.35, CITY_LEVEL_ENTER_ZOOM, 8]
        : [CITY_LABEL_MIN_ZOOM, CITY_LEVEL_EXIT_ZOOM, 6.7, 8]
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    ...stops.flatMap((zoom) => [zoom, businessLabelSizeOutputAtZoom(level, zoom)]),
  ]
}

function businessLabelSizeOutputAtZoom(level: MapLabelLevel, zoom: number) {
  const baseSize = ['to-number', ['coalesce', ['get', 'labelBaseSize'], labelBaseSize(level)]]
  const growth = Number(
    (staticLabelSizeAtZoom(level, zoom) - labelBaseSize(level)).toFixed(4),
  )
  const staticSize = growth === 0 ? baseSize : ['+', baseSize, growth]
  const emphasis = labelDataEmphasisAtZoom(level, zoom)
  if (emphasis === 0) return staticSize
  const labelScale = ['to-number', ['coalesce', ['get', 'labelScale'], 1]]
  if (emphasis === 1) return ['*', staticSize, labelScale]
  return ['*', staticSize, ['+', 1, ['*', ['-', labelScale, 1], emphasis]]]
}

export function approximateMapLabelWidth(label: string, renderedSize: number) {
  return Math.max(
    14,
    [...label].reduce(
      (width, character) =>
        width + ((character.codePointAt(0) ?? 0) > 0xff ? renderedSize : renderedSize * 0.58),
      0,
    ) + 8,
  )
}

function interpolateClamped(
  value: number,
  inputStart: number,
  inputEnd: number,
  outputStart: number,
  outputEnd: number,
) {
  if (value <= inputStart) return outputStart
  if (value >= inputEnd) return outputEnd
  const progress = (value - inputStart) / (inputEnd - inputStart)
  return outputStart + (outputEnd - outputStart) * progress
}
