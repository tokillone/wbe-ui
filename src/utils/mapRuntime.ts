import type { MapRegionStat } from '../types/map'

export type MapDisplayLevel = MapRegionStat['level']
export type MapRenderPhase = 'settled' | 'preparing-next' | 'transitioning'

export const COUNTRY_LEVEL_END_ZOOM = 3.85
export const CITY_LEVEL_ENTER_ZOOM = 6.6
export const CITY_LEVEL_EXIT_ZOOM = 6.45

/**
 * Chooses the visible hierarchy with a small city/admin-1 hysteresis band.
 * This prevents a high-resolution trackpad from repeatedly swapping two
 * complete bubble/name layers while it settles near the threshold.
 */
export function nextMapDisplayLevel(
  current: MapDisplayLevel,
  zoom: number,
): MapDisplayLevel {
  if (zoom < COUNTRY_LEVEL_END_ZOOM) return 'country'
  if (current === 'city' && zoom > CITY_LEVEL_EXIT_ZOOM) return 'city'
  if (zoom >= CITY_LEVEL_ENTER_ZOOM) return 'city'
  return 'admin1'
}

export function displayLevelWithoutHysteresis(zoom: number): MapDisplayLevel {
  if (zoom < COUNTRY_LEVEL_END_ZOOM) return 'country'
  return zoom < CITY_LEVEL_ENTER_ZOOM ? 'admin1' : 'city'
}

/**
 * Keeps one rendered world wider than the viewport plus a guard band. The map
 * can still wrap continuously, but duplicate business symbols cannot enter the
 * same viewport from the neighbouring world copy.
 */
export function wrappedWorldMinZoom(
  viewportWidth: number,
  configuredMinZoom = 1.1,
  guardPixels = 320,
  tileSize = 512,
) {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return configuredMinZoom
  const required = Math.log2((viewportWidth + guardPixels) / tileSize)
  return Math.max(configuredMinZoom, required)
}

/** Returns the longitude copy nearest to the current camera centre. */
export function nearestWorldCopyLongitude(targetLongitude: number, centerLongitude: number) {
  if (!Number.isFinite(targetLongitude) || !Number.isFinite(centerLongitude)) {
    return targetLongitude
  }
  return targetLongitude + 360 * Math.round((centerLongitude - targetLongitude) / 360)
}

export function nearestWorldCopyCoordinate(
  coordinate: [number, number],
  centerLongitude: number,
): [number, number] {
  return [nearestWorldCopyLongitude(coordinate[0], centerLongitude), coordinate[1]]
}
