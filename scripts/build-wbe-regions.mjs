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
const outputReport = resolve(generatedDir, 'wbe_regions_report.json')
const outputMbtiles = resolve(generatedDir, 'wbe-regions.mbtiles')
const outputPmtiles = resolve(tilesDir, 'wbe-regions.pmtiles')
const sourceLayer = 'wbe_regions'
const geometryCleaningRules = {
  country: { minPartArea: 0.35, relativeMinArea: 0.002, maxParts: 18 },
  admin1: { minPartArea: 0.12, relativeMinArea: 0.006, maxParts: 8 },
  city: { minPartArea: 0.18, relativeMinArea: 0.035, maxParts: 3 },
}

const args = new Set(process.argv.slice(2))
const prepareOnly = args.has('--prepare-only')
const skipTiles = args.has('--skip-tiles')
const tippecanoeImage = process.env.TIPPECANOE_IMAGE || 'ghcr.io/felt/tippecanoe:latest'
const pmtilesImage = process.env.PMTILES_IMAGE || 'ghcr.io/protomaps/go-pmtiles:latest'

mkdirSync(generatedDir, { recursive: true })

const sourceSpecs = [
  {
    path: 'world-countries.geojson',
    level: 'country',
    include: () => true,
    geoKey: (props) => stringProp(props, 'country_key'),
    parentGeoKey: () => '',
  },
  {
    path: 'world-admin1.geojson',
    level: 'admin1',
    include: (props) => stringProp(props, 'country_key') !== 'china',
    geoKey: (props) => stringProp(props, 'geo_key') || `${stringProp(props, 'country_key')}|${stringProp(props, 'region_key')}`,
    parentGeoKey: (props) => stringProp(props, 'parent_geo_key') || stringProp(props, 'country_key'),
  },
  {
    path: 'china-provinces.geojson',
    level: 'admin1',
    include: () => true,
    geoKey: (props) => stringProp(props, 'geo_key') || `${stringProp(props, 'country_key')}|${stringProp(props, 'region_key')}`,
    parentGeoKey: (props) => stringProp(props, 'parent_geo_key') || stringProp(props, 'country_key'),
  },
  {
    path: 'china-cities.geojson',
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
  const filePath = resolve(geoDir, spec.path)
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
writeJson(outputGeojson, { type: 'FeatureCollection', features })
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
      '--layer',
      sourceLayer,
      '--drop-densest-as-needed',
      '--extend-zooms-if-still-dropping',
      '--detect-shared-borders',
      outputGeojson,
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
      '--layer',
      sourceLayer,
      '--drop-densest-as-needed',
      '--extend-zooms-if-still-dropping',
      '--detect-shared-borders',
      containerPath(outputGeojson),
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
    properties: { ...first.properties },
    geometry:
      polygons.length === 1
        ? { type: 'Polygon', coordinates: polygons[0] }
        : { type: 'MultiPolygon', coordinates: polygons },
  }
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
