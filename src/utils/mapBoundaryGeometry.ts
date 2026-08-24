export type BoundaryFeature = {
  type: 'Feature'
  id?: string | number
  properties: Record<string, unknown>
  geometry: unknown
}

export type BoundaryFeatureCollection = {
  type: 'FeatureCollection'
  features: BoundaryFeature[]
}

export type BoundaryBounds = [number, number, number, number]

const EMPTY_COLLECTION: BoundaryFeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}

/**
 * Converts polygon rings to real line geometries before MapLibre tiles the source.
 * This is intentionally separate from the fill source: polygon tile clipping closes
 * cut rings at tile edges, and using those clipped polygons in a line layer produces
 * the long horizontal/diagonal artefacts seen around Taiwan and Hong Kong.
 */
export function polygonBoundariesToLines(
  collection: BoundaryFeatureCollection | null | undefined,
  featureFilter?: (feature: BoundaryFeature) => boolean,
): BoundaryFeatureCollection {
  if (!collection) return EMPTY_COLLECTION
  const features = collection.features.flatMap((feature) => {
    if (featureFilter && !featureFilter(feature)) return []
    const lines = geometryRings(feature.geometry)
      .flatMap((ring) => splitAntimeridian(normalizeLine(ring)))
      .filter((line): line is number[][] => line.length >= 2)
    if (!lines.length) return []
    return [
      {
        type: 'Feature' as const,
        id: feature.id,
        properties: { ...feature.properties },
        geometry: {
          type: lines.length === 1 ? 'LineString' : 'MultiLineString',
          coordinates: lines.length === 1 ? lines[0] : lines,
        },
      },
    ]
  })
  return { type: 'FeatureCollection', features }
}

export function filterBoundaryFeatures(
  collection: BoundaryFeatureCollection | null | undefined,
  predicate: (feature: BoundaryFeature) => boolean,
): BoundaryFeatureCollection {
  if (!collection) return EMPTY_COLLECTION
  return {
    type: 'FeatureCollection',
    features: collection.features.filter(predicate),
  }
}

export function visibleParentGeoKeys(
  collection: BoundaryFeatureCollection | null | undefined,
  bounds: BoundaryBounds,
  paddingRatio = 0.08,
): string[] {
  if (!collection) return []
  const [west, south, east, north] = padBounds(bounds, paddingRatio)
  return collection.features
    .flatMap((feature) => {
      const bbox = geometryBounds(feature.geometry)
      if (!bbox || !boundsIntersect([west, south, east, north], bbox)) return []
      const key = featureGeoKey(feature)
      return key ? [key] : []
    })
    .sort()
}

export function boundaryCollectionForParents(
  collection: BoundaryFeatureCollection | null | undefined,
  parentGeoKeys: readonly string[],
): BoundaryFeatureCollection {
  const keys = new Set(parentGeoKeys)
  return filterBoundaryFeatures(collection, (feature) => {
    const parent = String(
      feature.properties.parent_geo_key ?? feature.properties.parentGeoKey ?? '',
    ).trim()
    return Boolean(parent && keys.has(parent))
  })
}

export function geometryBounds(geometry: unknown): BoundaryBounds | null {
  const points = geometryCoordinates(geometry)
  if (!points.length) return null
  let west = Number.POSITIVE_INFINITY
  let south = Number.POSITIVE_INFINITY
  let east = Number.NEGATIVE_INFINITY
  let north = Number.NEGATIVE_INFINITY
  points.forEach(([longitude, latitude]) => {
    if (longitude == null || latitude == null) return
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return
    west = Math.min(west, longitude)
    south = Math.min(south, latitude)
    east = Math.max(east, longitude)
    north = Math.max(north, latitude)
  })
  return Number.isFinite(west) ? [west, south, east, north] : null
}

function geometryRings(geometry: unknown): unknown[][] {
  if (!geometry || typeof geometry !== 'object') return []
  const typed = geometry as { type?: string; coordinates?: unknown }
  if (typed.type === 'Polygon' && Array.isArray(typed.coordinates)) {
    return typed.coordinates.filter(Array.isArray)
  }
  if (typed.type === 'MultiPolygon' && Array.isArray(typed.coordinates)) {
    return typed.coordinates.flatMap((polygon) => (Array.isArray(polygon) ? polygon : []))
  }
  return []
}

function normalizeLine(line: unknown[]): number[][] {
  const normalized: number[][] = []
  line.forEach((coordinate) => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) return
    const point = [Number(coordinate[0]), Number(coordinate[1])]
    if (!point.every(Number.isFinite)) return
    const previous = normalized[normalized.length - 1]
    if (previous?.[0] === point[0] && previous?.[1] === point[1]) return
    normalized.push(point)
  })
  return normalized
}

function splitAntimeridian(line: number[][]): number[][][] {
  if (line.length < 2) return []
  const parts: number[][][] = []
  let part = [line[0]!]
  for (let index = 1; index < line.length; index += 1) {
    const point = line[index]!
    const previous = line[index - 1]!
    if (Math.abs(point[0]! - previous[0]!) > 180) {
      if (part.length >= 2) parts.push(part)
      part = [point]
      continue
    }
    part.push(point)
  }
  if (part.length >= 2) parts.push(part)
  return parts
}

function geometryCoordinates(geometry: unknown): number[][] {
  if (!geometry || typeof geometry !== 'object') return []
  const coordinates = (geometry as { coordinates?: unknown }).coordinates
  const points: number[][] = []
  visitCoordinates(coordinates, points)
  return points
}

function visitCoordinates(value: unknown, points: number[][]) {
  if (!Array.isArray(value)) return
  if (
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  ) {
    points.push([value[0], value[1]])
    return
  }
  value.forEach((entry) => visitCoordinates(entry, points))
}

function featureGeoKey(feature: BoundaryFeature) {
  return String(
    feature.properties.geo_key ??
      feature.properties.geoKey ??
      feature.properties.country_key ??
      '',
  ).trim()
}

function padBounds(bounds: BoundaryBounds, ratio: number): BoundaryBounds {
  const [west, south, east, north] = bounds
  const longitudePadding = Math.max(0.25, Math.abs(east - west) * ratio)
  const latitudePadding = Math.max(0.2, Math.abs(north - south) * ratio)
  return [
    west - longitudePadding,
    Math.max(-90, south - latitudePadding),
    east + longitudePadding,
    Math.min(90, north + latitudePadding),
  ]
}

function boundsIntersect(left: BoundaryBounds, right: BoundaryBounds) {
  const longitudeIntersects =
    left[0] <= left[2]
      ? right[0] <= left[2] && right[2] >= left[0]
      : right[0] <= left[2] || right[2] >= left[0]
  return longitudeIntersects && right[1] <= left[3] && right[3] >= left[1]
}
