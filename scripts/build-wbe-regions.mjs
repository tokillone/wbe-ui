#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const geoDir = resolve(rootDir, 'public/geo')
const tilesDir = resolve(rootDir, 'public/tiles')
const generatedDir = resolve(tilesDir, 'generated')
const outputGeojson = resolve(generatedDir, 'wbe_regions.geojson')
const outputLineGeojson = resolve(generatedDir, 'wbe_region_boundaries.geojson')
const outputEdgeGeojson = resolve(generatedDir, 'wbe_boundary_edges.geojson')
const outputLabelGeojson = resolve(generatedDir, 'wbe_region_labels.geojson')
const outputReport = resolve(generatedDir, 'wbe_regions_report.json')
const outputMbtiles = resolve(generatedDir, 'wbe-regions.mbtiles')
const outputPmtiles = resolve(tilesDir, 'wbe-regions.pmtiles')
const sourceLayer = 'wbe_regions'
const lineSourceLayer = 'wbe_region_boundaries'
const edgeSourceLayer = 'wbe_boundary_edges'
const labelSourceLayer = 'wbe_region_labels'
const geometryCleaningRules = {
  country: { minPartArea: 0.08, relativeMinArea: 0.001, maxParts: 18 },
  admin1: { minPartArea: 0.04, relativeMinArea: 0.004, maxParts: 6 },
  city: { minPartArea: 0, relativeMinArea: 0, maxParts: 1 },
}

const args = new Set(process.argv.slice(2))
const prepareOnly = args.has('--prepare-only')
const skipTiles = args.has('--skip-tiles')
const tippecanoeImage = process.env.TIPPECANOE_IMAGE || 'ghcr.io/felt/tippecanoe:latest'
const pmtilesImage = process.env.PMTILES_IMAGE || 'ghcr.io/protomaps/go-pmtiles:latest'

mkdirSync(generatedDir, { recursive: true })

const sourceSpecs = [
  {
    path: 'render/world-countries.geojson',
    level: 'country',
    include: () => true,
    geoKey: (props) => stringProp(props, 'country_key'),
    parentGeoKey: () => '',
  },
  {
    path: 'render/world-admin1.geojson',
    level: 'admin1',
    include: (props) =>
      !new Set(['china', 'hongkongsar', 'macausar', 'macaosar', 'taiwan']).has(
        stringProp(props, 'country_key').toLowerCase(),
      ),
    geoKey: (props) => stringProp(props, 'geo_key') || `${stringProp(props, 'country_key')}|${stringProp(props, 'region_key')}`,
    parentGeoKey: (props) => stringProp(props, 'parent_geo_key') || stringProp(props, 'country_key'),
  },
  {
    path: 'render/china-provinces.geojson',
    level: 'admin1',
    include: () => true,
    geoKey: (props) => stringProp(props, 'geo_key') || `${stringProp(props, 'country_key')}|${stringProp(props, 'region_key')}`,
    parentGeoKey: (props) => stringProp(props, 'parent_geo_key') || stringProp(props, 'country_key'),
  },
  {
    path: resolve(generatedDir, 'world-cities.geojson'),
    level: 'city',
    include: () => true,
    geoKey: (props) => stringProp(props, 'geo_key'),
    parentGeoKey: (props) => stringProp(props, 'parent_geo_key'),
  },
  {
    path: 'render/china-cities.geojson',
    level: 'city',
    include: () => true,
    geoKey: (props) => stringProp(props, 'geo_key') || `${stringProp(props, 'country_key')}|${stringProp(props, 'region_key')}`,
    parentGeoKey: (props) => stringProp(props, 'parent_geo_key') || stringProp(props, 'country_key'),
  },
]

const featureGroups = new Map()
const report = {
  generatedAt: new Date().toISOString(),
  sourceLayer,
  sourceFiles: [],
  duplicateRegionIds: [],
  missingGeoKey: [],
  featureCountByLevel: {},
  geometryCleaning: {
    rules: geometryCleaningRules,
    byLevel: {},
    droppedFeatures: [],
  },
}

for (const spec of sourceSpecs) {
  const filePath = spec.path.startsWith('/') ? spec.path : resolve(geoDir, spec.path)
  const collection = readJson(filePath)
  let used = 0
  for (const feature of collection.features ?? []) {
    const props = feature.properties ?? {}
    if (!spec.include(props)) continue
    const geoKey = spec.geoKey(props)
    if (!geoKey || geoKey.includes('undefined') || geoKey.endsWith('|')) {
      report.missingGeoKey.push({ source: spec.path, properties: props })
      continue
    }
    const regionId = `${spec.level}|${geoKey}`
    const bbox = geometryBbox(feature.geometry)
    if (!bbox) continue
    const normalized = {
      type: 'Feature',
      tippecanoe: zoomHint(spec.level),
      properties: {
        region_id: regionId,
        level: spec.level,
        geo_key: geoKey,
        parent_geo_key: spec.parentGeoKey(props),
        display_name: String(props.display_name ?? props.name ?? geoKey),
        country_key: stringProp(props, 'country_key'),
        region_key: stringProp(props, 'region_key'),
        bbox_w: roundCoord(bbox[0]),
        bbox_s: roundCoord(bbox[1]),
        bbox_e: roundCoord(bbox[2]),
        bbox_n: roundCoord(bbox[3]),
      },
      geometry: feature.geometry,
    }
    used += 1
    if (!featureGroups.has(regionId)) featureGroups.set(regionId, [])
    featureGroups.get(regionId).push(normalized)
  }
  report.sourceFiles.push({ file: spec.path, level: spec.level, used })
}

const features = []
for (const [regionId, group] of featureGroups.entries()) {
  if (group.length > 1) {
    report.duplicateRegionIds.push({ region_id: regionId, count: group.length })
  }
  const merged = cleanMergedFeature(mergeFeatures(group))
  if (!merged) {
    report.geometryCleaning.droppedFeatures.push({ region_id: regionId })
    continue
  }
  features.push(merged)
  report.featureCountByLevel[merged.properties.level] =
    (report.featureCountByLevel[merged.properties.level] ?? 0) + 1
}

features.sort((a, b) => String(a.properties.region_id).localeCompare(String(b.properties.region_id)))
const selectionLineCollection = {
  type: 'FeatureCollection',
  // Per-region outlines are only needed for country/admin-1 selection. City
  // selection uses a fill so coastlines and detached islands are never outlined.
  features: features.filter((feature) => feature.properties.level !== 'city').flatMap(featureToLineFeatures),
}
const edgeCollection = buildBoundaryEdgeCollection()
const labelCollection = buildRegionLabelCollection(features)
report.featureCountByLayer = {
  [sourceLayer]: features.length,
  [lineSourceLayer]: selectionLineCollection.features.length,
  [edgeSourceLayer]: edgeCollection.features.length,
  [labelSourceLayer]: labelCollection.features.length,
}
report.topologyPolicy = {
  coastlinesExcludedFromAdministrativeEdges: true,
  uniqueSharedLandEdges: true,
  cityEdgesPartitionedByCountry: true,
  cityPrincipalPolygonOnly: true,
  citySelectionUsesFillWithoutOutline: true,
}
writeJson(outputGeojson, { type: 'FeatureCollection', features })
writeJson(outputLineGeojson, selectionLineCollection)
writeJson(outputEdgeGeojson, edgeCollection)
writeJson(outputLabelGeojson, labelCollection)
writeJson(outputReport, report)

console.log(`Prepared ${features.length} WBE region features at ${relative(outputGeojson)}`)
console.log(`Validation report written to ${relative(outputReport)}`)

if (prepareOnly || skipTiles) process.exit(0)

rmIfExists(outputMbtiles)
rmIfExists(outputPmtiles)

if (commandExists('tippecanoe') && commandExists('pmtiles')) {
  runCommand(
    'tippecanoe',
    [
      '-o',
      outputMbtiles,
      '--force',
      '--quiet',
      '--minimum-zoom=0',
      '--maximum-zoom=10',
      '-L',
      `${sourceLayer}:${outputGeojson}`,
      '-L',
      `${lineSourceLayer}:${outputLineGeojson}`,
      '-L',
      `${edgeSourceLayer}:${outputEdgeGeojson}`,
      '-L',
      `${labelSourceLayer}:${outputLabelGeojson}`,
      '--no-feature-limit',
      '--no-tile-size-limit',
      '--no-tiny-polygon-reduction',
      '--detect-shared-borders',
    ],
    'tippecanoe',
  )
  runCommand('pmtiles', ['convert', '--quiet', outputMbtiles, outputPmtiles], 'pmtiles convert')
} else {
  if (!commandExists('docker')) {
    console.error(
      'tippecanoe and pmtiles CLIs, or a running Docker daemon, are required to build PMTiles.',
    )
    process.exit(1)
  }
  runDocker(
    tippecanoeImage,
    [
      'tippecanoe',
      '-o',
      containerPath(outputMbtiles),
      '--force',
      '--quiet',
      '--minimum-zoom=0',
      '--maximum-zoom=10',
      '-L',
      `${sourceLayer}:${containerPath(outputGeojson)}`,
      '-L',
      `${lineSourceLayer}:${containerPath(outputLineGeojson)}`,
      '-L',
      `${edgeSourceLayer}:${containerPath(outputEdgeGeojson)}`,
      '-L',
      `${labelSourceLayer}:${containerPath(outputLabelGeojson)}`,
      '--no-feature-limit',
      '--no-tile-size-limit',
      '--no-tiny-polygon-reduction',
      '--detect-shared-borders',
    ],
    'tippecanoe',
  )
  runDocker(
    pmtilesImage,
    [
      'pmtiles',
      'convert',
      '--quiet',
      containerPath(outputMbtiles),
      containerPath(outputPmtiles),
    ],
    'pmtiles convert',
  )
}

console.log(`Built ${relative(outputPmtiles)}`)

function runCommand(command, args, label) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`${label} failed`)
    process.exit(result.status ?? 1)
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function stringProp(props, key) {
  return String(props[key] ?? '').trim()
}

function mergeFeatures(group) {
  const [first] = group
  const polygons = group.flatMap((feature) => geometryPolygons(feature.geometry))
  return {
    type: 'Feature',
    tippecanoe: first.tippecanoe,
    properties: { ...first.properties },
    geometry:
      polygons.length === 1
        ? { type: 'Polygon', coordinates: polygons[0] }
        : { type: 'MultiPolygon', coordinates: polygons },
  }
}

function featureToLineFeatures(feature) {
  const lines = geometryPolygons(feature.geometry)
    .flatMap((polygon) => polygon)
    .flatMap((ring) => (Array.isArray(ring) ? splitAntimeridianLine(ring) : []))
    .filter((ring) => ring.length >= 2)
  if (!lines.length) return []
  return [
    {
      type: 'Feature',
      tippecanoe: feature.tippecanoe,
      properties: { ...feature.properties },
      geometry: {
        type: lines.length === 1 ? 'LineString' : 'MultiLineString',
        coordinates: lines.length === 1 ? lines[0] : lines,
      },
    },
  ]
}

function buildBoundaryEdgeCollection() {
  const edgeSources = [
    { path: resolve(geoDir, 'render/world-countries-lines.geojson'), level: 'country' },
    { path: resolve(geoDir, 'render/world-admin1-lines.geojson'), level: 'admin1' },
    { path: resolve(geoDir, 'render/china-provinces-lines.geojson'), level: 'admin1' },
    { path: resolve(generatedDir, 'world-city-edges.geojson'), level: 'city' },
    { path: resolve(geoDir, 'render/china-cities-lines.geojson'), level: 'city' },
  ]
  const features = edgeSources.flatMap(({ path, level }) => {
    if (!existsSync(path)) throw new Error(`Missing topology edge source: ${relative(path)}`)
    return (readJson(path).features ?? []).flatMap((feature) => {
      if (!['LineString', 'MultiLineString'].includes(feature.geometry?.type)) return []
      return [{
        ...feature,
        tippecanoe: zoomHint(level),
        properties: {
          ...(feature.properties ?? {}),
          level,
        },
      }]
    })
  })
  return { type: 'FeatureCollection', features }
}

function buildRegionLabelCollection(regionFeatures) {
  const generatedCityLabels = readJson(resolve(generatedDir, 'world-city-labels.geojson'))
  const generatedCityIds = new Set()
  const cityLabels = (generatedCityLabels.features ?? []).flatMap((feature) => {
    const props = feature.properties ?? {}
    if (!props.region_id || feature.geometry?.type !== 'Point') return []
    generatedCityIds.add(String(props.region_id))
    return [{ ...feature, tippecanoe: zoomHint('city') }]
  })
  const remainingLabels = regionFeatures.flatMap((feature) => {
    if (generatedCityIds.has(String(feature.properties.region_id))) return []
    const point = representativePoint(feature.geometry)
    if (!point) return []
    return [{
      type: 'Feature',
      tippecanoe: zoomHint(feature.properties.level),
      properties: { ...feature.properties },
      geometry: { type: 'Point', coordinates: point },
    }]
  })
  return { type: 'FeatureCollection', features: [...remainingLabels, ...cityLabels] }
}

function representativePoint(geometry) {
  const polygons = geometryPolygons(geometry)
  const polygon = polygons.sort((left, right) => polygonArea(right) - polygonArea(left))[0]
  const ring = polygon?.[0]
  if (!ring?.length) return null
  const bbox = geometryBbox({ type: 'Polygon', coordinates: polygon })
  if (!bbox) return null
  const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
  if (pointInRing(center, ring)) return center.map(roundCoord)
  for (const point of ring) {
    if (Array.isArray(point) && point.length >= 2) return point.slice(0, 2).map(roundCoord)
  }
  return null
}

function pointInRing([x, y], ring) {
  let inside = false
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const left = ring[current]
    const right = ring[previous]
    const intersects =
      left[1] > y !== right[1] > y &&
      x < ((right[0] - left[0]) * (y - left[1])) / (right[1] - left[1]) + left[0]
    if (intersects) inside = !inside
  }
  return inside
}

function zoomHint(level) {
  if (level === 'country') return { minzoom: 0, maxzoom: 10 }
  if (level === 'admin1') return { minzoom: 3, maxzoom: 10 }
  return { minzoom: 6, maxzoom: 10 }
}

function splitAntimeridianLine(line) {
  if (!Array.isArray(line) || line.length < 2) return []
  const parts = []
  let part = [line[0]]
  for (let index = 1; index < line.length; index += 1) {
    const point = line[index]
    const previous = line[index - 1]
    if (Math.abs(Number(point?.[0]) - Number(previous?.[0])) > 180) {
      if (part.length >= 2) parts.push(part)
      part = [point]
      continue
    }
    part.push(point)
  }
  if (part.length >= 2) parts.push(part)
  return parts
}

function cleanMergedFeature(feature) {
  const level = feature.properties.level
  const rule = geometryCleaningRules[level] ?? geometryCleaningRules.admin1
  const polygons = geometryPolygons(feature.geometry)
    .map((polygon) => ({ polygon, area: polygonArea(polygon) }))
    .filter((item) => item.area > 0)
    .sort((a, b) => b.area - a.area)
  if (!polygons.length) return null

  const mainArea = polygons[0].area
  const kept = polygons
    .filter(
      (item, index) =>
        index === 0 ||
        (item.area >= rule.minPartArea && item.area / mainArea >= rule.relativeMinArea),
    )
    .slice(0, rule.maxParts)
  const dropped = polygons.filter((item) => !kept.includes(item))
  recordGeometryCleaning(level, polygons, kept, dropped)

  const geometry =
    kept.length === 1
      ? { type: 'Polygon', coordinates: kept[0].polygon }
      : { type: 'MultiPolygon', coordinates: kept.map((item) => item.polygon) }
  const bbox = geometryBbox(geometry)
  if (!bbox) return null
  return {
    ...feature,
    properties: {
      ...feature.properties,
      bbox_w: roundCoord(bbox[0]),
      bbox_s: roundCoord(bbox[1]),
      bbox_e: roundCoord(bbox[2]),
      bbox_n: roundCoord(bbox[3]),
    },
    geometry,
  }
}

function recordGeometryCleaning(level, polygons, kept, dropped) {
  const bucket =
    report.geometryCleaning.byLevel[level] ??
    (report.geometryCleaning.byLevel[level] = {
      features: 0,
      sourcePolygons: 0,
      keptPolygons: 0,
      droppedPolygons: 0,
      sourceArea: 0,
      keptArea: 0,
      droppedArea: 0,
    })
  bucket.features += 1
  bucket.sourcePolygons += polygons.length
  bucket.keptPolygons += kept.length
  bucket.droppedPolygons += dropped.length
  bucket.sourceArea = roundCoord(bucket.sourceArea + sumArea(polygons))
  bucket.keptArea = roundCoord(bucket.keptArea + sumArea(kept))
  bucket.droppedArea = roundCoord(bucket.droppedArea + sumArea(dropped))
}

function sumArea(items) {
  return items.reduce((sum, item) => sum + item.area, 0)
}

function geometryPolygons(geometry) {
  if (!geometry) return []
  if (geometry.type === 'Polygon') return [geometry.coordinates]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates
  return []
}

function polygonArea(polygon) {
  if (!Array.isArray(polygon) || !Array.isArray(polygon[0])) return 0
  const [outerRing, ...holes] = polygon
  return Math.max(0, ringArea(outerRing) - holes.reduce((sum, ring) => sum + ringArea(ring), 0))
}

function ringArea(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 0
  let area = 0
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index]
    const [x2, y2] = ring[(index + 1) % ring.length]
    area += x1 * y2 - x2 * y1
  }
  return Math.abs(area) / 2
}

function geometryBbox(geometry) {
  const points = []
  visitCoordinates(geometry?.coordinates, points)
  if (!points.length) return null
  return points.reduce(
    (bbox, [lng, lat]) => [
      Math.min(bbox[0], lng),
      Math.min(bbox[1], lat),
      Math.max(bbox[2], lng),
      Math.max(bbox[3], lat),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  )
}

function visitCoordinates(value, points) {
  if (!Array.isArray(value)) return
  if (typeof value[0] === 'number' && typeof value[1] === 'number') {
    points.push([value[0], value[1]])
    return
  }
  value.forEach((item) => visitCoordinates(item, points))
}

function expandBbox(current, next) {
  if (!next) return current
  return [
    Math.min(current[0], next[0]),
    Math.min(current[1], next[1]),
    Math.max(current[2], next[2]),
    Math.max(current[3], next[3]),
  ]
}

function roundCoord(value) {
  return Math.round(value * 1e6) / 1e6
}

function commandExists(command) {
  return spawnSync('sh', ['-lc', `command -v ${command}`], { stdio: 'ignore' }).status === 0
}

function runDocker(image, command, label) {
  const result = spawnSync(
    'docker',
    ['run', '--rm', '-v', `${rootDir}:/work`, '-w', '/work', image, ...command],
    { stdio: 'inherit' },
  )
  if (result.status !== 0) {
    console.error(`${label} failed with Docker image ${image}`)
    process.exit(result.status ?? 1)
  }
}

function containerPath(path) {
  return `/work/${relative(path)}`
}

function relative(path) {
  return path.replace(`${rootDir}/`, '')
}

function rmIfExists(path) {
  if (existsSync(path)) rmSync(path)
}
