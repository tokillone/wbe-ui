#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = resolve(uiRoot, '..')
const provincePath = resolve(uiRoot, 'public/geo/china-provinces.geojson')
const cityPath = resolve(uiRoot, 'public/geo/china-cities.geojson')
const seedPath = resolve(workspaceRoot, 'wbe-backup/src/main/resources/db/map_geolocation_seed.sql')

const provinces = readJson(provincePath)
const cities = readJson(cityPath)

const normalizedProvinces = provinces.features.map((feature) => {
  const properties = feature.properties ?? {}
  const slug = romanSlug(properties)
  const geoKey = `china|${slug}`
  return {
    ...feature,
    properties: {
      ...properties,
      legacy_region_key: properties.legacy_region_key ?? properties.region_key ?? '',
      region_key: slug,
      geo_key: geoKey,
      parent_geo_key: 'china',
      region_id: `admin1|${geoKey}`,
      keys: unique([geoKey, ...(properties.keys ?? [])]),
    },
  }
})

const provinceIndex = normalizedProvinces.map((feature) => ({
  feature,
  point: representativePoint(feature.geometry),
  bbox: geometryBbox(feature.geometry),
}))

const normalizedCities = cities.features.map((feature) => {
  const properties = feature.properties ?? {}
  const slug = romanSlug(properties)
  const point = representativePoint(feature.geometry)
  const parent = containingProvince(point) ?? nearestProvince(point)
  if (!parent) throw new Error(`Unable to assign province for ${properties.display_name ?? slug}`)
  const provinceKey = String(parent.feature.properties.geo_key)
  const geoKey = `${provinceKey}|${slug}`
  return {
    ...feature,
    properties: {
      ...properties,
      legacy_region_key: properties.legacy_region_key ?? properties.region_key ?? '',
      region_key: slug,
      geo_key: geoKey,
      parent_geo_key: provinceKey,
      province_key: provinceKey,
      region_id: `city|${geoKey}`,
      keys: unique([geoKey, `china|${slug}`, ...(properties.keys ?? [])]),
    },
  }
})

validateUnique(normalizedProvinces, 'admin1')
validateUnique(normalizedCities, 'city')
writeJson(provincePath, { ...provinces, features: normalizedProvinces })
writeJson(cityPath, { ...cities, features: normalizedCities })
rewriteSeed(normalizedProvinces, normalizedCities)

const checks = ['Guangzhou', 'Hangzhou', 'Fuzhou', 'Wuhu'].map((name) => {
  const feature = normalizedCities.find((item) => item.properties?.name === name)
  return `${name}=${feature?.properties?.geo_key ?? 'missing'}`
})
console.log(`Normalized ${normalizedProvinces.length} provinces and ${normalizedCities.length} cities`)
console.log(checks.join(', '))

function containingProvince(point) {
  if (!point) return null
  const matches = provinceIndex.filter((item) => pointInFeature(point, item.feature))
  return matches.sort((a, b) => bboxArea(a.bbox) - bboxArea(b.bbox))[0] ?? null
}

function nearestProvince(point) {
  if (!point) return null
  return provinceIndex
    .filter((item) => item.point)
    .sort((a, b) => distanceSquared(point, a.point) - distanceSquared(point, b.point))[0] ?? null
}

function pointInFeature(point, feature) {
  return geometryPolygons(feature.geometry).some((polygon) => pointInPolygon(point, polygon))
}

function pointInPolygon(point, polygon) {
  if (!polygon?.length || !pointInRing(point, polygon[0])) return false
  return !polygon.slice(1).some((ring) => pointInRing(point, ring))
}

function pointInRing([x, y], ring) {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [xi, yi] = ring[index]
    const [xj, yj] = ring[previous]
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi
    if (crosses) inside = !inside
  }
  return inside
}

function representativePoint(geometry) {
  const polygons = geometryPolygons(geometry)
  if (!polygons.length) return null
  const polygon = polygons.sort((a, b) => Math.abs(ringSignedArea(b[0])) - Math.abs(ringSignedArea(a[0])))[0]
  const centroid = ringCentroid(polygon[0])
  if (centroid && pointInPolygon(centroid, polygon)) return centroid
  const bbox = geometryBbox({ type: 'Polygon', coordinates: polygon })
  const center = bbox ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] : null
  if (center && pointInPolygon(center, polygon)) return center
  return polygon[0]?.[0] ?? null
}

function ringCentroid(ring) {
  let areaFactor = 0
  let x = 0
  let y = 0
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index]
    const [x2, y2] = ring[index + 1]
    const cross = x1 * y2 - x2 * y1
    areaFactor += cross
    x += (x1 + x2) * cross
    y += (y1 + y2) * cross
  }
  if (!areaFactor) return null
  return [x / (3 * areaFactor), y / (3 * areaFactor)]
}

function ringSignedArea(ring) {
  let area = 0
  for (let index = 0; index < ring.length - 1; index += 1) {
    area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1]
  }
  return area / 2
}

function geometryPolygons(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates]
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates
  return []
}

function geometryBbox(geometry) {
  const coordinates = []
  collectCoordinates(geometry?.coordinates, coordinates)
  if (!coordinates.length) return null
  return coordinates.reduce(
    (bbox, [x, y]) => [Math.min(bbox[0], x), Math.min(bbox[1], y), Math.max(bbox[2], x), Math.max(bbox[3], y)],
    [Infinity, Infinity, -Infinity, -Infinity],
  )
}

function collectCoordinates(value, output) {
  if (!Array.isArray(value)) return
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    output.push(value)
    return
  }
  value.forEach((item) => collectCoordinates(item, output))
}

function rewriteSeed(provinceFeatures, cityFeatures) {
  const sql = readFileSync(seedPath, 'utf8')
  const valuesMarker = ') VALUES\n'
  const footerMarker = '\nON DUPLICATE KEY UPDATE'
  const valuesStart = sql.indexOf(valuesMarker)
  const footerStart = sql.indexOf(footerMarker)
  if (valuesStart < 0 || footerStart < 0) throw new Error('Unexpected map_geolocation_seed.sql format')
  const header = sql.slice(0, valuesStart + valuesMarker.length)
  const existingRows = sql
    .slice(valuesStart + valuesMarker.length, footerStart)
    .split('\n')
    .map((line) => line.trim().replace(/,$/, ''))
    .filter(Boolean)
    .filter((line) => !line.startsWith("('admin1', 'china|") && !line.startsWith("('city', 'china|"))
  const chinaRows = [
    ...provinceFeatures.map((feature) => seedRow(feature, 'admin1')),
    ...cityFeatures.map((feature) => seedRow(feature, 'city')),
  ]
  const rows = [...existingRows, ...chinaRows].sort((a, b) => a.localeCompare(b, 'en'))
  const body = rows.map((row, index) => `${row}${index === rows.length - 1 ? '' : ','}`).join('\n')
  writeFileSync(seedPath, `${header}${body}${sql.slice(footerStart)}\n`)
}

function seedRow(feature, level) {
  const props = feature.properties ?? {}
  const [longitude, latitude] = representativePoint(feature.geometry) ?? [null, null]
  const provinceFeature = level === 'admin1'
    ? feature
    : normalizedProvinces.find((item) => item.properties.geo_key === props.parent_geo_key)
  const provinceName = provinceFeature?.properties?.name ?? provinceFeature?.properties?.display_name ?? null
  const cityName = level === 'city' ? props.name ?? props.display_name ?? null : null
  return `('${level}', ${sqlValue(props.geo_key)}, ${sqlValue(props.parent_geo_key)}, 'China', ${sqlValue(provinceName)}, ${sqlValue(cityName)}, ${sqlValue(props.display_name ?? props.name)}, ${numberValue(latitude)}, ${numberValue(longitude)}, TRUE, 'canonical-boundary-centroid')`
}

function romanSlug(properties) {
  const fromKey = (properties.keys ?? [])
    .map((key) => String(key))
    .find((key) => /^china\|[a-z][a-z0-9-]*$/i.test(key))
  const source = fromKey?.split('|').at(-1) ?? properties.name ?? properties.region_key ?? ''
  return String(source).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function validateUnique(features, level) {
  const ids = new Set()
  features.forEach((feature) => {
    const id = feature.properties?.region_id
    if (!id || ids.has(id)) throw new Error(`Duplicate or missing ${level} region_id: ${id}`)
    ids.add(id)
  })
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))]
}

function distanceSquared(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
}

function bboxArea(bbox) {
  return bbox ? Math.max(0, bbox[2] - bbox[0]) * Math.max(0, bbox[3] - bbox[1]) : Infinity
}

function sqlValue(value) {
  if (value == null || value === '') return 'NULL'
  return `'${String(value).replaceAll("'", "''")}'`
}

function numberValue(value) {
  return Number.isFinite(value) ? Number(value).toFixed(7) : 'NULL'
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value)}\n`)
}
