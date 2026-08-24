#!/usr/bin/env node
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = resolve(rootDir, '.cache/geoboundaries')
const generatedDir = resolve(rootDir, 'public/tiles/generated')
const mapshaperBin = resolve(rootDir, 'node_modules/.bin/mapshaper')
const sourceRevision = '5c25134028196d43ce97b5071934fd0cfc92f09f'
const sourceBase = `https://github.com/wmgeolab/geoBoundaries/raw/${sourceRevision}/releaseData/CGAZ`
const sources = {
  ADM1: {
    url: `${sourceBase}/geoBoundariesCGAZ_ADM1.zip`,
    // SHA-256 is recorded after the first verified download in the generated report.
    archive: resolve(cacheDir, 'geoBoundariesCGAZ_ADM1.zip'),
  },
  ADM2: {
    url: `${sourceBase}/geoBoundariesCGAZ_ADM2.zip`,
    archive: resolve(cacheDir, 'geoBoundariesCGAZ_ADM2.zip'),
  },
}
const joinedPath = resolve(cacheDir, 'cgaz-adm2-joined-s10.geojson')
const outputPath = resolve(generatedDir, 'world-cities.geojson')
const edgePath = resolve(generatedDir, 'world-city-edges.geojson')
const labelPath = resolve(generatedDir, 'world-city-labels.geojson')
const reportPath = resolve(generatedDir, 'world-cities-report.json')
const rawOutputPath = resolve(generatedDir, '.world-cities.raw.geojson')
const countryPath = resolve(rootDir, 'public/geo/world-countries.geojson')
const admin1Path = resolve(rootDir, 'public/geo/world-admin1.geojson')

const args = new Set(process.argv.slice(2))
const forceDownload = args.has('--force-download')
const forceBuild = args.has('--force-build')

if (!existsSync(mapshaperBin)) {
  throw new Error('Mapshaper is required. Run npm install before preparing global ADM2 data.')
}
mkdirSync(cacheDir, { recursive: true })
mkdirSync(generatedDir, { recursive: true })

for (const [level, source] of Object.entries(sources)) {
  const shapeDir = resolve(cacheDir, `cgaz-${level.toLowerCase()}`)
  const shapePath = resolve(shapeDir, `geoBoundariesCGAZ_${level}.shp`)
  if (forceDownload) {
    rmSync(source.archive, { force: true })
    rmSync(shapeDir, { force: true, recursive: true })
  }
  if (!existsSync(source.archive)) download(source.url, source.archive)
  if (!existsSync(shapePath)) {
    mkdirSync(shapeDir, { recursive: true })
    run('unzip', ['-o', source.archive, '-d', shapeDir], `extract ${level}`)
  }
  source.shapePath = shapePath
  source.sha256 = await sha256(source.archive)
}

if (forceBuild || !existsSync(joinedPath)) {
  run(
    mapshaperBin,
    [
      sources.ADM2.shapePath,
      '-join',
      `source=${sources.ADM1.shapePath}`,
      'fields=shapeID,shapeName',
      'prefix=parent_',
      'largest-overlap',
      'unmatched',
      '-clean',
      'rewind',
      'overlap-rule=max-area',
      'snap-interval=0.000001',
      '-simplify',
      '10%',
      'weighted',
      'keep-shapes',
      '-o',
      'format=geojson',
      'precision=0.00001',
      joinedPath,
    ],
    'join and simplify CGAZ ADM2',
  )
}

const countries = readJson(countryPath)
const currentAdmin1 = readJson(admin1Path)
const joined = readJson(joinedPath)
const countryKeyByIso = new Map(
  countries.features.flatMap((feature) => {
    const iso = String(feature.properties?.['ISO3166-1-Alpha-3'] ?? '').toUpperCase()
    const countryKey = canonicalCountryKey(feature.properties?.country_key)
    return iso && iso !== '-99' && countryKey ? [[iso, countryKey]] : []
  }),
)
countryKeyByIso.set('FRA', 'france')
countryKeyByIso.set('NOR', 'norway')
countryKeyByIso.set('XKX', 'kosovo')
countryKeyByIso.set('TWN', 'china')

const adminKeysByCountry = new Map()
for (const feature of currentAdmin1.features ?? []) {
  const props = feature.properties ?? {}
  const rawCountryKey = normalizeKey(props.country_key)
  const countryKey = canonicalCountryKey(rawCountryKey)
  if (!countryKey) continue
  const geoKey =
    rawCountryKey === 'taiwan'
      ? 'china|taiwan'
      : `${countryKey}|${String(props.region_key ?? '').trim()}`
  const aliases = [props.region_key, props.display_name, props.name, ...(props.keys ?? [])]
  if (!adminKeysByCountry.has(countryKey)) adminKeysByCountry.set(countryKey, new Map())
  const index = adminKeysByCountry.get(countryKey)
  for (const alias of aliases) {
    const normalized = normalizeKey(String(alias ?? '').split('|').pop())
    if (normalized) index.set(normalized, geoKey)
  }
}

const sourceCountryIsos = new Set()
const normalized = []
const duplicateKeyCounts = new Map()
let skippedDisputed = 0
let skippedMainlandChina = 0
let unmatchedParents = 0

for (const feature of joined.features ?? []) {
  const props = feature.properties ?? {}
  const iso = String(props.shapeGroup ?? '').toUpperCase()
  if (!/^[A-Z]{3}$/.test(iso)) {
    skippedDisputed += 1
    continue
  }
  if (iso === 'CHN') {
    // The local GeoJSON contains the required prefecture/city level. CGAZ's CHN
    // ADM2 is one level finer and would create a second, overlapping mesh.
    skippedMainlandChina += 1
    continue
  }
  if (iso === 'TWN') continue
  const countryKey = countryKeyByIso.get(iso)
  if (!countryKey) continue
  sourceCountryIsos.add(iso)
  const displayName = String(props.shapeName ?? '').trim() || String(props.shapeID ?? '')
  const parentName = String(props.parent_shapeName ?? '').trim()
  const parentKey = resolveParentKey(countryKey, parentName)
  if (!props.parent_shapeID) unmatchedParents += 1
  normalized.push(
    normalizedCityFeature(feature, {
      countryKey,
      parentKey,
      displayName,
      sourceId: String(props.shapeID ?? ''),
      sourceLevel: 'CGAZ_ADM2',
    }),
  )
}

// Taiwan, Hong Kong and Macao are already represented in the local admin source
// at the requested city-equivalent level. Promote those records beneath the
// canonical China admin-1 keys so the hierarchy remains compatible with the app.
for (const feature of currentAdmin1.features ?? []) {
  const props = feature.properties ?? {}
  const sourceCountry = normalizeKey(props.country_key)
  const specialParent =
    sourceCountry === 'taiwan'
      ? 'china|taiwan'
      : sourceCountry === 'hongkongsar'
        ? 'china|hongkong'
        : ['macausar', 'macaosar'].includes(sourceCountry)
          ? 'china|aomen'
          : ''
  if (!specialParent) continue
  normalized.push(
    normalizedCityFeature(feature, {
      countryKey: 'china',
      parentKey: specialParent,
      displayName: String(props.display_name ?? props.name ?? props.region_key ?? ''),
      sourceId: `local-${sourceCountry}-${props.region_key ?? ''}`,
      sourceLevel: 'local_admin1_promoted',
    }),
  )
}

const coveredCountryKeys = new Set(normalized.map((feature) => feature.properties.country_key))
const admin1ByCountry = groupBy(currentAdmin1.features ?? [], (feature) =>
  canonicalCountryKey(feature.properties?.country_key),
)
for (const country of countries.features ?? []) {
  const countryKey = canonicalCountryKey(country.properties?.country_key)
  if (!countryKey || countryKey === 'china' || coveredCountryKeys.has(countryKey)) continue
  const fallbackAdmin1 = admin1ByCountry.get(countryKey) ?? []
  const fallbackFeatures = fallbackAdmin1.length ? fallbackAdmin1 : [country]
  for (const feature of fallbackFeatures) {
    const props = feature.properties ?? {}
    normalized.push(
      normalizedCityFeature(feature, {
        countryKey,
        parentKey: countryKey,
        displayName: String(props.display_name ?? props.name ?? countryKey),
        sourceId: `fallback-${countryKey}-${props.region_key ?? 'country'}`,
        sourceLevel: fallbackAdmin1.length ? 'local_admin1_promoted' : 'country_promoted',
      }),
    )
  }
}

const rawRenderable = normalized.filter((feature) => geometryArea(feature.geometry) > 0)
rawRenderable.sort((left, right) =>
  String(left.properties.region_id).localeCompare(String(right.properties.region_id)),
)
writeJson(rawOutputPath, { type: 'FeatureCollection', features: rawRenderable })

run(
  mapshaperBin,
  [
    rawOutputPath,
    '-quiet',
    '-split',
    'country_key',
    '-clean',
    'rewind',
    'overlap-rule=max-area',
    'snap-interval=0.000001',
    '-merge-layers',
    'force',
    'name=world_cities',
    '-o',
    'format=geojson',
    'precision=0.00001',
    outputPath,
  ],
  'normalize global city topology',
)
rmSync(rawOutputPath, { force: true })

const renderable = readJson(outputPath).features ?? []
renderable.sort((left, right) =>
  String(left.properties?.region_id ?? '').localeCompare(String(right.properties?.region_id ?? '')),
)
writeJson(outputPath, { type: 'FeatureCollection', features: renderable })
const edgeCollection = topologyLineCollection(renderable)
writeJson(edgePath, edgeCollection)
run(
  mapshaperBin,
  [
    outputPath,
    '-points',
    'inner',
    '-o',
    'format=geojson',
    'precision=0.00001',
    labelPath,
  ],
  'build global city label points',
)

const countryKeys = new Set(
  countries.features.map((feature) => canonicalCountryKey(feature.properties?.country_key)).filter(Boolean),
)
const covered = new Set(normalized.map((feature) => feature.properties.country_key))
const report = {
  generatedAt: new Date().toISOString(),
  source: 'geoBoundaries CGAZ',
  sourceRevision,
  license: 'CC BY 4.0',
  sourceArchives: Object.fromEntries(
    Object.entries(sources).map(([level, source]) => [level, { url: source.url, sha256: source.sha256 }]),
  ),
  simplification: 'Mapshaper weighted 10%, keep-shapes, 0.00001 degree output precision',
  edgeTopology: {
    partitionField: 'country_key',
    policy:
      'polygons are topology-normalized per country; unique inner edges are derived from that exact normalized geometry',
    featureCount: edgeCollection.features.length,
    segmentCount: countLineSegments(edgeCollection),
  },
  featureCount: renderable.length,
  countryCount: covered.size,
  expectedCountryCount: countryKeys.size,
  missingCountryKeys: [...countryKeys].filter((key) => !covered.has(key)).sort(),
  sourceCountryIsoCount: sourceCountryIsos.size,
  skippedDisputedFeatures: skippedDisputed,
  skippedMainlandChinaFeatures: skippedMainlandChina,
  unmatchedParentFeatures: unmatchedParents,
  duplicateGeoKeysResolved: [...duplicateKeyCounts.values()].filter((count) => count > 1).length,
}
writeJson(reportPath, report)
if (report.missingCountryKeys.length) {
  throw new Error(`Global city coverage missing: ${report.missingCountryKeys.join(', ')}`)
}
console.log(
  `Prepared ${report.featureCount} city-equivalent regions for ${report.countryCount} country keys.`,
)

function normalizedCityFeature(feature, options) {
  const baseSlug = normalizeKey(options.displayName) || normalizeKey(options.sourceId) || 'region'
  const parentPrefix = options.parentKey || options.countryKey
  const candidate = `${parentPrefix}|${baseSlug}`
  const count = (duplicateKeyCounts.get(candidate) ?? 0) + 1
  duplicateKeyCounts.set(candidate, count)
  const geoKey = count === 1 ? candidate : `${candidate}-${shortId(options.sourceId || String(count))}`
  return {
    type: 'Feature',
    properties: {
      region_id: `city|${geoKey}`,
      level: 'city',
      geo_key: geoKey,
      parent_geo_key: options.parentKey || options.countryKey,
      country_key: options.countryKey,
      region_key: geoKey.split('|').pop(),
      display_name: options.displayName,
      name: options.displayName,
      source_id: options.sourceId,
      source_level: options.sourceLevel,
    },
    // City-equivalent regions are rendered as their principal land body. Small
    // detached islands are intentionally omitted: they create noisy fragments
    // and duplicate-looking coastal outlines at application zoom levels.
    geometry: principalPolygonGeometry(feature.geometry),
  }
}

function topologyLineCollection(features) {
  const countries = groupBy(features, (feature) => feature.properties?.country_key)
  const outputFeatures = []
  for (const [countryKey, countryFeatures] of countries.entries()) {
    if (!countryKey) continue
    const segments = new Map()
    for (const feature of countryFeatures) {
      const owner = String(feature.properties?.geo_key ?? '')
      for (const ring of geometryRings(feature.geometry)) {
        for (let index = 1; index < ring.length; index += 1) {
          const left = normalizeCoordinate(ring[index - 1])
          const right = normalizeCoordinate(ring[index])
          if (!left || !right || sameCoordinate(left, right)) continue
          if (Math.abs(left[0] - right[0]) > 180) continue
          const key = segmentKey(left, right)
          const existing = segments.get(key)
          if (existing) existing.owners.add(owner)
          else segments.set(key, { left, right, owners: new Set([owner]) })
        }
      }
    }

    const boundaryGroups = new Map()
    for (const segment of segments.values()) {
      const owners = [...segment.owners].filter(Boolean).sort()
      if (owners.length < 2) continue
      const pairKey = owners.join('|~|')
      if (!boundaryGroups.has(pairKey)) boundaryGroups.set(pairKey, [])
      boundaryGroups.get(pairKey).push(segment)
    }

    for (const [pairKey, boundarySegments] of boundaryGroups.entries()) {
      const owners = pairKey.split('|~|')
      const lines = stitchSegments(boundarySegments)
      if (!lines.length) continue
      outputFeatures.push({
        type: 'Feature',
        properties: {
          level: 'city',
          country_key: countryKey,
          left_geo_key: owners[0] ?? '',
          right_geo_key: owners[1] ?? '',
        },
        geometry: {
          type: lines.length === 1 ? 'LineString' : 'MultiLineString',
          coordinates: lines.length === 1 ? lines[0] : lines,
        },
      })
    }
  }
  return { type: 'FeatureCollection', features: outputFeatures }
}

function stitchSegments(segments) {
  const endpointIndex = new Map()
  const entries = segments.map((segment, index) => {
    const leftKey = coordinateKey(segment.left)
    const rightKey = coordinateKey(segment.right)
    for (const key of [leftKey, rightKey]) {
      if (!endpointIndex.has(key)) endpointIndex.set(key, [])
      endpointIndex.get(key).push(index)
    }
    return { ...segment, leftKey, rightKey }
  })
  const remaining = new Set(entries.map((_, index) => index))
  const lines = []
  while (remaining.size) {
    const seedIndex = remaining.values().next().value
    const seed = entries[seedIndex]
    const startKey = endpointIndex.get(seed.leftKey)?.length !== 2 ? seed.leftKey : seed.rightKey
    const line = []
    let currentKey = startKey
    while (true) {
      const candidateIndex = (endpointIndex.get(currentKey) ?? []).find((index) =>
        remaining.has(index),
      )
      if (candidateIndex == null) break
      const candidate = entries[candidateIndex]
      remaining.delete(candidateIndex)
      const currentPoint = candidate.leftKey === currentKey ? candidate.left : candidate.right
      const nextPoint = candidate.leftKey === currentKey ? candidate.right : candidate.left
      if (!line.length) line.push(currentPoint)
      line.push(nextPoint)
      currentKey = coordinateKey(nextPoint)
    }
    if (line.length >= 2) lines.push(line)
  }
  return lines
}

function geometryRings(geometry) {
  if (geometry?.type === 'Polygon') return geometry.coordinates
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates.flat()
  return []
}

function normalizeCoordinate(value) {
  if (!Array.isArray(value) || value.length < 2) return null
  const point = [roundCoord(Number(value[0])), roundCoord(Number(value[1]))]
  return point.every(Number.isFinite) ? point : null
}

function roundCoord(value) {
  return Number(Number(value).toFixed(5))
}

function sameCoordinate(left, right) {
  return left[0] === right[0] && left[1] === right[1]
}

function coordinateKey(point) {
  return `${roundCoord(point[0])},${roundCoord(point[1])}`
}

function segmentKey(left, right) {
  const leftKey = coordinateKey(left)
  const rightKey = coordinateKey(right)
  return leftKey < rightKey ? `${leftKey}|${rightKey}` : `${rightKey}|${leftKey}`
}

function countLineSegments(collection) {
  return (collection.features ?? []).reduce((total, feature) => {
    const lines =
      feature.geometry?.type === 'LineString'
        ? [feature.geometry.coordinates]
        : feature.geometry?.type === 'MultiLineString'
          ? feature.geometry.coordinates
          : []
    return total + lines.reduce((sum, line) => sum + Math.max(0, line.length - 1), 0)
  }, 0)
}

function principalPolygonGeometry(geometry) {
  const polygons =
    geometry?.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry?.type === 'MultiPolygon'
        ? geometry.coordinates
        : []
  const principal = polygons
    .map((polygon) => ({ polygon, area: polygonArea(polygon) }))
    .filter((item) => item.area > 0)
    .sort((left, right) => right.area - left.area)[0]?.polygon
  return principal ? { type: 'Polygon', coordinates: principal } : geometry
}

function polygonArea(polygon) {
  const ringArea = (ring) => {
    let sum = 0
    for (let index = 1; index < (ring?.length ?? 0); index += 1) {
      const left = ring[index - 1]
      const right = ring[index]
      sum += Number(left?.[0] ?? 0) * Number(right?.[1] ?? 0)
      sum -= Number(right?.[0] ?? 0) * Number(left?.[1] ?? 0)
    }
    return Math.abs(sum / 2)
  }
  const [outer = [], ...holes] = polygon ?? []
  return Math.max(0, ringArea(outer) - holes.reduce((sum, ring) => sum + ringArea(ring), 0))
}

function geometryArea(geometry) {
  if (geometry?.type === 'Polygon') return polygonArea(geometry.coordinates)
  if (geometry?.type === 'MultiPolygon') {
    return geometry.coordinates.reduce((sum, polygon) => sum + polygonArea(polygon), 0)
  }
  return 0
}

function resolveParentKey(countryKey, parentName) {
  const normalizedParent = normalizeKey(parentName)
  const known = adminKeysByCountry.get(countryKey)?.get(normalizedParent)
  return known || `${countryKey}|${normalizedParent || 'unassigned'}`
}

function normalizeKey(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '')
}

function canonicalCountryKey(value) {
  const key = normalizeKey(value)
  return [
    'china',
    'hongkong',
    'hongkongsar',
    'macau',
    'macao',
    'macausar',
    'macaosar',
    'taiwan',
    '中国',
    '香港',
    '澳门',
    '台湾',
  ].includes(key)
    ? 'china'
    : key
}

function shortId(value) {
  return createHash('sha1').update(String(value)).digest('hex').slice(0, 8)
}

function groupBy(values, keyFor) {
  const result = new Map()
  for (const value of values) {
    const key = keyFor(value)
    if (!result.has(key)) result.set(key, [])
    result.get(key).push(value)
  }
  return result
}

function download(url, path) {
  mkdirSync(dirname(path), { recursive: true })
  run('curl', ['-fL', '--retry', '3', '--progress-bar', url, '-o', path], `download ${url}`)
}

function run(command, commandArgs, label) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`${label} failed`)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value)}\n`)
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
