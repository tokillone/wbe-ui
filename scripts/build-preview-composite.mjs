#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CONTINENT_COUNTRY_SAMPLES } from './preview-map-audit-config.mjs'
import { applyControlledLabelPointOverrides } from './preview-label-overrides.mjs'
import {
  buildPresentationAdministration,
  writePresentationCollection,
} from './presentation-admin.mjs'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = resolve(
  process.env.PREVIEW_MAP_SOURCE_DIR || join(rootDir, 'scripts/data/preview-map'),
)
const baseArchive = resolve(
  process.env.PREVIEW_BASEMAP_SOURCE ||
    join(rootDir, 'public/tiles/wbe-basemap-editable-z6.pmtiles'),
)
const outputArchive = resolve(
  process.env.PREVIEW_COMPOSITE_OUTPUT ||
    join(rootDir, 'public/tiles/wbe-preview-composite.pmtiles'),
)
const generatedDir = join(rootDir, 'public/tiles/generated')
const renderDir = join(rootDir, 'public/geo/render')
const reportPath = join(generatedDir, 'preview-composite-report.json')
const workDir = mkdtempSync(join(tmpdir(), 'wbe-preview-composite-'))
const controlledLabelsPath = join(sourceDir, 'controlled-labels.geojson')
const cldrSnapshotPath = join(sourceDir, 'cldr-subdivisions-48.json')
const officialNameOverridesPath = join(sourceDir, 'official-admin-name-zh.json')
const worldCountriesPath = join(renderDir, 'world-countries.geojson')
const worldCountryLinesPath = join(renderDir, 'world-countries-lines.geojson')
const worldAdmin1Path = join(renderDir, 'world-admin1.geojson')
const worldAdmin1LinesPath = join(renderDir, 'world-admin1-lines.geojson')
const chinaProvincesPath = join(renderDir, 'china-provinces.geojson')
const chinaProvinceLinesPath = join(renderDir, 'china-provinces-lines.geojson')
const chinaCitiesPath = join(renderDir, 'china-cities.geojson')
const chinaCityLinesPath = join(renderDir, 'china-cities-lines.geojson')
const chinaCoastalDisplayPath = join(renderDir, 'china-coastal-display-envelopes.geojson')
const worldCitiesPath = join(generatedDir, 'world-cities.geojson')
const worldCityEdgesPath = join(generatedDir, 'world-city-edges.geojson')
const worldCityLabelsPath = join(generatedDir, 'world-city-labels.geojson')
const cgazAdmin1ShapePath = join(
  rootDir,
  '.cache/geoboundaries/cgaz-adm1/geoBoundariesCGAZ_ADM1.shp',
)
const mapshaperBin = join(rootDir, 'node_modules/.bin/mapshaper')

const canonicalBoundaryInputs = [
  worldCountriesPath,
  worldCountryLinesPath,
  worldAdmin1Path,
  worldAdmin1LinesPath,
  chinaProvincesPath,
  chinaProvinceLinesPath,
  chinaCitiesPath,
  chinaCityLinesPath,
  chinaCoastalDisplayPath,
  worldCitiesPath,
  worldCityEdgesPath,
]

const directArchives = [baseArchive]
const BOUNDARY_DEDUPLICATION = {
  zoom: 8,
  tileSize: 512,
  tolerancePx: 1.25,
  maxAngleDegrees: 8,
  minOverlapPx: 2,
  minCandidateOverlapRatio: 0.7,
  gridSizePx: 8,
}

const layerSpecs = [
  {
    id: 'preview_country_overview',
    input: worldCountryLinesPath,
    transform: 'country-boundaries',
    minzoom: 0,
    maxzoom: 2,
  },
  {
    id: 'preview_country_boundaries',
    input: worldCountryLinesPath,
    transform: 'country-boundaries',
    minzoom: 2,
    maxzoom: 8,
  },
  {
    id: 'preview_presentation_admin1_boundaries',
    transform: 'presentation-admin1-boundaries',
    minzoom: 3,
    maxzoom: 8,
  },
  {
    id: 'preview_presentation_admin2_boundaries',
    transform: 'presentation-admin2-boundaries',
    minzoom: 6,
    maxzoom: 8,
  },
  {
    id: 'preview_china_province_boundaries',
    input: chinaProvinceLinesPath,
    minzoom: 3,
    maxzoom: 8,
  },
  {
    id: 'preview_china_city_boundaries',
    input: chinaCityLinesPath,
    minzoom: 5,
    maxzoom: 8,
  },
  {
    id: 'preview_region_outlines',
    transform: 'region-outlines',
    minzoom: 0,
    maxzoom: 8,
  },
  {
    id: 'preview_region_display_outlines',
    transform: 'region-display-outlines',
    minzoom: 0,
    maxzoom: 8,
  },
  {
    id: 'preview_region_polygons',
    transform: 'region-polygons',
    minzoom: 0,
    maxzoom: 8,
  },
  {
    id: 'preview_country_labels',
    file: 'controlled-labels.geojson',
    featureLevel: 'country',
    minzoom: 0,
    maxzoom: 8,
  },
  {
    id: 'preview_presentation_admin1_labels',
    transform: 'presentation-admin1-labels',
    minzoom: 3,
    maxzoom: 8,
  },
  {
    id: 'preview_presentation_admin2_labels',
    transform: 'presentation-admin2-labels',
    minzoom: 6,
    maxzoom: 8,
  },
]

try {
  requireCommands(['tippecanoe', 'tile-join', 'pmtiles'])
  ;[
    ...directArchives,
    ...canonicalBoundaryInputs,
    cgazAdmin1ShapePath,
    mapshaperBin,
    cldrSnapshotPath,
    officialNameOverridesPath,
    ...layerSpecs.filter((spec) => spec.file).map((spec) => join(sourceDir, spec.file)),
    ...layerSpecs.filter((spec) => spec.input).map((spec) => spec.input),
  ].forEach(requireFile)

  const worldCountries = JSON.parse(readFileSync(worldCountriesPath, 'utf8'))
  const rawControlledLabels = JSON.parse(readFileSync(controlledLabelsPath, 'utf8'))
  const { collection: controlledLabels, applied: controlledLabelOverrides } =
    applyControlledLabelPointOverrides(rawControlledLabels)
  const countryLabelRepairs = ensureCountryLabelCoverage(controlledLabels, worldCountries)
  const presentationAdministration = buildPresentationAdministration({
    workDir,
    mapshaperBin,
    run,
    cgazAdmin1ShapePath,
    worldCountriesPath,
    worldAdmin1Path,
    worldAdmin1LinesPath,
    chinaProvincesPath,
    chinaCitiesPath,
    chinaCityLinesPath,
    worldCitiesPath,
    worldCityEdgesPath,
    controlledLabels,
    cldrSnapshotPath,
    officialNameOverridesPath,
  })
  const renderedBoundaryCleanup = cleanRenderedBoundaryCollections({
    country: JSON.parse(readFileSync(worldCountryLinesPath, 'utf8')),
    admin1: filterCollection(
      presentationAdministration.collections.admin1Boundaries,
      (feature) => feature.properties?.country_key !== 'china',
    ),
    admin2: filterCollection(
      presentationAdministration.collections.admin2Boundaries,
      (feature) => feature.properties?.country_key !== 'china',
    ),
    chinaProvince: JSON.parse(readFileSync(chinaProvinceLinesPath, 'utf8')),
    chinaCity: JSON.parse(readFileSync(chinaCityLinesPath, 'utf8')),
  })
  const renderedBoundaryOverlapAudit = auditRenderedBoundaryOverlaps({
    ...renderedBoundaryCleanup.collections,
  })
  if (renderedBoundaryOverlapAudit.totalCoincidentSegmentCount !== 0) {
    throw new Error(
      `Visible boundary layers contain ${renderedBoundaryOverlapAudit.totalCoincidentSegmentCount} coincident segments`,
    )
  }
  const tolerantBoundaryOverlapAudit = auditTolerantBoundaryOverlaps(
    renderedBoundaryCleanup.collections,
  )
  if (tolerantBoundaryOverlapAudit.totalDuplicateLikeSegmentCount !== 0) {
    throw new Error(
      `Visible boundary layers contain ${tolerantBoundaryOverlapAudit.totalDuplicateLikeSegmentCount} duplicate-like segments within the Z8 tolerance`,
    )
  }
  const labelCounts = Object.fromEntries(
    ['country', 'admin1', 'city'].map((level) => [
      level,
      (controlledLabels.features ?? []).filter((feature) => feature.properties?.level === level)
        .length,
    ]),
  )
  let regionOutlineCoverage = null
  let regionDisplayOutlineAudit = null
  let regionPolygonCoverage = null
  const layerFeatureCounts = {}
  const cleanedBoundaryLayerCollections = {
    preview_presentation_admin1_boundaries: renderedBoundaryCleanup.collections.admin1,
    preview_presentation_admin2_boundaries: renderedBoundaryCleanup.collections.admin2,
    preview_china_province_boundaries: renderedBoundaryCleanup.collections.chinaProvince,
    preview_china_city_boundaries: renderedBoundaryCleanup.collections.chinaCity,
  }

  const generatedTilesets = layerSpecs.map((spec) => {
    let input
    if (spec.featureLevel) {
      input = writeControlledLabelSubset(controlledLabels, spec)
      layerFeatureCounts[spec.id] = labelCounts[spec.featureLevel]
    } else if (cleanedBoundaryLayerCollections[spec.id]) {
      const result = writePresentationCollection(
        workDir,
        spec.id,
        cleanedBoundaryLayerCollections[spec.id],
      )
      input = result.path
      layerFeatureCounts[spec.id] = result.count
    } else if (spec.transform?.startsWith('presentation-')) {
      const collectionKey = {
        'presentation-admin1-boundaries': 'admin1Boundaries',
        'presentation-admin1-labels': 'admin1Labels',
        'presentation-admin2-boundaries': 'admin2Boundaries',
        'presentation-admin2-labels': 'admin2Labels',
      }[spec.transform]
      const result = writePresentationCollection(
        workDir,
        spec.id,
        presentationAdministration.collections[collectionKey],
      )
      input = result.path
      layerFeatureCounts[spec.id] = result.count
    } else if (spec.transform === 'country-boundaries') {
      const result = writeCountryBoundarySubset(
        spec,
        worldCountries,
        renderedBoundaryCleanup.collections.country,
      )
      input = result.path
      layerFeatureCounts[spec.id] = result.count
    } else if (spec.transform === 'region-outlines') {
      const result = writeRegionOutlineCollection(spec)
      input = result.path
      regionOutlineCoverage = result.coverage
      layerFeatureCounts[spec.id] = result.count
    } else if (spec.transform === 'region-display-outlines') {
      const result = writeRegionDisplayOutlineCollection(spec)
      input = result.path
      regionDisplayOutlineAudit = result.audit
      layerFeatureCounts[spec.id] = result.count
    } else if (spec.transform === 'region-polygons') {
      const result = writeRegionPolygonCollection(spec)
      input = result.path
      regionPolygonCoverage = result.coverage
      layerFeatureCounts[spec.id] = result.count
    } else {
      input = spec.input ?? join(sourceDir, spec.file)
      layerFeatureCounts[spec.id] = featureCount(input)
    }
    const output = join(workDir, `${spec.id}.mbtiles`)
    const args = [
      '--quiet',
      '--force',
      '--output',
      output,
      '--layer',
      spec.id,
      '--minimum-zoom',
      String(spec.minzoom),
      '--maximum-zoom',
      String(spec.maxzoom),
      '--buffer',
      '64',
      '--no-feature-limit',
      '--no-tile-size-limit',
    ]
    if (spec.transform === 'region-display-outlines') {
      args.push('--simplification', '1.5', '--simplification-at-maximum-zoom', '0.25')
    } else if (spec.transform === 'region-polygons') {
      args.push('--simplification', '1', '--simplification-at-maximum-zoom', '0.15')
    } else {
      args.push('--no-line-simplification')
    }
    if (spec.featureLevel || spec.transform?.endsWith('-labels')) args.push('--drop-rate', '1')
    args.push(input)
    run('tippecanoe', args)
    return output
  })

  mkdirSync(dirname(outputArchive), { recursive: true })
  const temporaryOutput = join(dirname(outputArchive), '.wbe-preview-composite.tmp.pmtiles')
  rmSync(temporaryOutput, { force: true })
  run('tile-join', [
    '--quiet',
    '--force',
    '--overzoom',
    '--buffer',
    '64',
    '--no-tile-size-limit',
    '--minimum-zoom',
    '0',
    '--maximum-zoom',
    '8',
    '--name',
    'WBE preview composite basemap',
    '--description',
    'Standalone preview basemap, continuous administrative boundaries, and controlled labels',
    '--attribution',
    'OpenStreetMap contributors; Protomaps; geoBoundaries CC BY 4.0',
    '--output',
    temporaryOutput,
    ...directArchives,
    ...generatedTilesets,
  ])
  run('pmtiles', ['verify', '--quiet', temporaryOutput])
  renameSync(temporaryOutput, outputArchive)

  mkdirSync(generatedDir, { recursive: true })
  const header = JSON.parse(runCapture('pmtiles', ['show', '--header-json', outputArchive]))
  const metadata = JSON.parse(runCapture('pmtiles', ['show', '--metadata', outputArchive]))
  const inputs = [
    ...new Set([
      ...directArchives,
      ...canonicalBoundaryInputs,
      cgazAdmin1ShapePath,
      controlledLabelsPath,
      cldrSnapshotPath,
      officialNameOverridesPath,
      ...layerSpecs.filter((spec) => spec.file).map((spec) => join(sourceDir, spec.file)),
    ]),
  ]
  const report = {
    generatedAt: new Date().toISOString(),
    output: relativePath(outputArchive),
    outputBytes: statSync(outputArchive).size,
    outputSha256: sha256(outputArchive),
    zoom: { min: header.minzoom, max: header.maxzoom },
    tileJoin: {
      overzoom: true,
      buffer: 64,
      noTileSizeLimit: true,
    },
    inputs: inputs.map((path) => ({
      path: relativePath(path),
      bytes: statSync(path).size,
      sha256: sha256(path),
    })),
    labelFeatureCounts: labelCounts,
    countryLabelRepairs,
    controlledLabelOverrides,
    presentationAdministration: presentationAdministration.report,
    renderedBoundaryCleanup: renderedBoundaryCleanup.report,
    renderedBoundaryOverlapAudit,
    tolerantBoundaryOverlapAudit,
    regionOutlineCoverage,
    regionDisplayOutlineAudit,
    regionPolygonCoverage,
    displayOutlineSimplification: {
      simplification: 1.5,
      simplificationAtMaximumZoom: 0.25,
      staticAdministrativeBoundariesUnchanged: true,
    },
    previewLayers: layerSpecs.map(({ id, minzoom, maxzoom, featureLevel }) => ({
      id,
      minzoom,
      maxzoom,
      featureCount: layerFeatureCounts[id] ?? 0,
      ...(featureLevel ? { featureLevel, featureCount: labelCounts[featureLevel] } : {}),
    })),
    vectorLayers: (metadata.vector_layers ?? []).map((layer) => layer.id),
  }
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    `Built ${relativePath(outputArchive)} (${(report.outputBytes / 1048576).toFixed(1)} MiB, Z${header.minzoom}-Z${header.maxzoom}).`,
  )
} finally {
  rmSync(workDir, { recursive: true, force: true })
}

function filterCollection(collection, predicate) {
  return {
    type: 'FeatureCollection',
    features: (collection.features ?? []).filter(predicate),
  }
}

function cleanRenderedBoundaryCollections(collections) {
  const country = cleanBoundaryCollection('country', collections.country, [])
  const admin1 = cleanBoundaryCollection('admin1', collections.admin1, [
    { name: 'country', collection: country.collection },
  ])
  const chinaProvince = cleanBoundaryCollection('chinaProvince', collections.chinaProvince, [
    { name: 'country', collection: country.collection },
  ])
  const admin2 = cleanBoundaryCollection('admin2', collections.admin2, [
    { name: 'country', collection: country.collection },
    { name: 'admin1', collection: admin1.collection },
  ])
  const chinaCity = cleanBoundaryCollection('chinaCity', collections.chinaCity, [
    { name: 'country', collection: country.collection },
    { name: 'chinaProvince', collection: chinaProvince.collection },
  ])
  const cleaned = { country, admin1, admin2, chinaProvince, chinaCity }
  return {
    collections: Object.fromEntries(
      Object.entries(cleaned).map(([name, result]) => [name, result.collection]),
    ),
    report: {
      ...BOUNDARY_DEDUPLICATION,
      layers: Object.fromEntries(
        Object.entries(cleaned).map(([name, result]) => [name, result.report]),
      ),
      removedByCountry: mergeBoundaryRemovalCountryReports(
        Object.values(cleaned).map((result) => result.report.removedByCountry),
      ),
    },
  }
}

function cleanBoundaryCollection(layerName, collection, higherPrioritySources) {
  const records = collectBoundarySegments(collection, layerName)
  const higherPriorityIndex = createBoundarySpatialIndex()
  for (const source of higherPrioritySources) {
    for (const record of collectBoundarySegments(source.collection, source.name)) {
      addBoundarySpatialRecord(higherPriorityIndex, record)
    }
  }
  const withinIndex = createBoundarySpatialIndex()
  const removed = new Set()
  const report = {
    inputSegmentCount: records.length,
    keptSegmentCount: 0,
    removedWithinExact: 0,
    removedWithinNear: 0,
    removedAgainst: {},
    removedByCountry: {},
  }
  const longestFirst = [...records].sort(
    (left, right) => right.pixelLength - left.pixelLength || left.id - right.id,
  )
  for (const record of longestFirst) {
    const higherMatch = findBoundaryCoincidence(record, higherPriorityIndex)
    if (higherMatch) {
      removed.add(record.id)
      incrementBoundaryRemoval(report, record, higherMatch.kind, higherMatch.record.layerName)
      continue
    }
    const withinMatch = findBoundaryCoincidence(
      record,
      withinIndex,
      (candidate) => candidate.semanticPair === record.semanticPair,
    )
    if (withinMatch) {
      removed.add(record.id)
      incrementBoundaryRemoval(report, record, withinMatch.kind, 'within')
      continue
    }
    addBoundarySpatialRecord(withinIndex, record)
  }
  const linesByFeature = new Map()
  for (const record of records) {
    if (removed.has(record.id)) continue
    if (!linesByFeature.has(record.featureIndex)) linesByFeature.set(record.featureIndex, [])
    linesByFeature.get(record.featureIndex).push([record.start, record.end])
  }
  const features = []
  for (const [featureIndex, lines] of linesByFeature) {
    if (!lines.length) continue
    const feature = collection.features[featureIndex]
    features.push({
      ...feature,
      geometry: {
        type: lines.length === 1 ? 'LineString' : 'MultiLineString',
        coordinates: lines.length === 1 ? lines[0] : lines,
      },
    })
  }
  report.keptSegmentCount = records.length - removed.size
  return { collection: { type: 'FeatureCollection', features }, report }
}

function incrementBoundaryRemoval(report, record, kind, against) {
  if (against === 'within') {
    const key = kind === 'exact' ? 'removedWithinExact' : 'removedWithinNear'
    report[key] += 1
  } else {
    const entry = report.removedAgainst[against] ?? { exact: 0, near: 0 }
    entry[kind] += 1
    report.removedAgainst[against] = entry
  }
  const countryKey = record.countryKey || '__unknown__'
  const countryEntry = report.removedByCountry[countryKey] ?? { exact: 0, near: 0 }
  countryEntry[kind] += 1
  report.removedByCountry[countryKey] = countryEntry
}

function mergeBoundaryRemovalCountryReports(reports) {
  const merged = {}
  for (const report of reports) {
    for (const [countryKey, counts] of Object.entries(report)) {
      const entry = merged[countryKey] ?? { exact: 0, near: 0 }
      entry.exact += Number(counts.exact ?? 0)
      entry.near += Number(counts.near ?? 0)
      merged[countryKey] = entry
    }
  }
  return Object.fromEntries(Object.entries(merged).sort(([left], [right]) => left.localeCompare(right)))
}

function collectBoundarySegments(collection, layerName) {
  const records = []
  for (let featureIndex = 0; featureIndex < (collection.features ?? []).length; featureIndex += 1) {
    const feature = collection.features[featureIndex]
    const properties = feature.properties ?? {}
    const semanticPair = boundarySemanticPair(properties, featureIndex)
    const countryKey = String(
      properties.country_key ?? properties.left_country_key ?? properties.left_geo_key ?? '',
    ).split('|')[0]
    for (const line of lineCoordinates(feature.geometry)) {
      for (let segmentIndex = 1; segmentIndex < line.length; segmentIndex += 1) {
        const start = normalizedBoundaryCoordinate(line[segmentIndex - 1])
        const end = normalizedBoundaryCoordinate(line[segmentIndex])
        if (!start || !end || (start[0] === end[0] && start[1] === end[1])) continue
        const pixelStart = boundaryWorldPixel(start)
        const pixelEnd = boundaryWorldPixel(end)
        const pixelLength = pointDistance(pixelStart, pixelEnd)
        if (!Number.isFinite(pixelLength) || pixelLength <= 0) continue
        records.push({
          id: records.length,
          featureIndex,
          start,
          end,
          pixelStart,
          pixelEnd,
          pixelLength,
          exactKey: boundarySegmentKey(start, end),
          semanticPair,
          countryKey,
          layerName,
        })
      }
    }
  }
  return records
}

function boundarySemanticPair(properties, featureIndex) {
  const left = String(properties.left_geo_key ?? '')
  const right = String(properties.right_geo_key ?? '')
  if (!left || !right) return `__feature__${featureIndex}`
  return left < right ? `${left}|~|${right}` : `${right}|~|${left}`
}

function normalizedBoundaryCoordinate(coordinate) {
  if (!Array.isArray(coordinate) || coordinate.length < 2) return null
  const longitude = Number(coordinate[0])
  const latitude = Number(coordinate[1])
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null
}

function boundaryWorldPixel([longitude, latitude]) {
  const size = BOUNDARY_DEDUPLICATION.tileSize * 2 ** BOUNDARY_DEDUPLICATION.zoom
  const clampedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude))
  const sine = Math.sin((clampedLatitude * Math.PI) / 180)
  return [
    ((longitude + 180) / 360) * size,
    (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * size,
  ]
}

function boundarySegmentKey(left, right) {
  const leftKey = `${left[0].toFixed(5)},${left[1].toFixed(5)}`
  const rightKey = `${right[0].toFixed(5)},${right[1].toFixed(5)}`
  return leftKey < rightKey ? `${leftKey}|${rightKey}` : `${rightKey}|${leftKey}`
}

function createBoundarySpatialIndex() {
  return { cells: new Map(), records: [] }
}

function addBoundarySpatialRecord(index, record) {
  const spatialId = index.records.length
  index.records.push(record)
  for (const key of boundaryGridKeys(record)) {
    if (!index.cells.has(key)) index.cells.set(key, [])
    index.cells.get(key).push(spatialId)
  }
}

function queryBoundarySpatialIndex(index, record) {
  const ids = new Set()
  for (const key of boundaryGridKeys(record)) {
    for (const id of index.cells.get(key) ?? []) ids.add(id)
  }
  return [...ids].map((id) => index.records[id])
}

function boundaryGridKeys(record) {
  const tolerance = BOUNDARY_DEDUPLICATION.tolerancePx
  const cellSize = BOUNDARY_DEDUPLICATION.gridSizePx
  const minX = Math.floor((Math.min(record.pixelStart[0], record.pixelEnd[0]) - tolerance) / cellSize)
  const maxX = Math.floor((Math.max(record.pixelStart[0], record.pixelEnd[0]) + tolerance) / cellSize)
  const minY = Math.floor((Math.min(record.pixelStart[1], record.pixelEnd[1]) - tolerance) / cellSize)
  const maxY = Math.floor((Math.max(record.pixelStart[1], record.pixelEnd[1]) + tolerance) / cellSize)
  const keys = []
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) keys.push(`${x}:${y}`)
  }
  return keys
}

function findBoundaryCoincidence(record, index, predicate = () => true) {
  for (const candidate of queryBoundarySpatialIndex(index, record)) {
    if (!predicate(candidate)) continue
    if (record.exactKey === candidate.exactKey) return { kind: 'exact', record: candidate }
    if (boundarySegmentsAreNearCoincident(record, candidate)) {
      return { kind: 'near', record: candidate }
    }
  }
  return null
}

function boundarySegmentsAreNearCoincident(left, right) {
  const leftVector = subtractPoint(left.pixelEnd, left.pixelStart)
  const rightVector = subtractPoint(right.pixelEnd, right.pixelStart)
  const leftLength = left.pixelLength
  const rightLength = right.pixelLength
  const cosine = Math.abs(dotPoint(leftVector, rightVector) / (leftLength * rightLength))
  const minimumCosine = Math.cos((BOUNDARY_DEDUPLICATION.maxAngleDegrees * Math.PI) / 180)
  if (cosine < minimumCosine) return false
  const axis = [leftVector[0] / leftLength, leftVector[1] / leftLength]
  const rightStartProjection = dotPoint(subtractPoint(right.pixelStart, left.pixelStart), axis)
  const rightEndProjection = dotPoint(subtractPoint(right.pixelEnd, left.pixelStart), axis)
  const overlap = Math.max(
    0,
    Math.min(leftLength, Math.max(rightStartProjection, rightEndProjection)) -
      Math.max(0, Math.min(rightStartProjection, rightEndProjection)),
  )
  if (overlap < BOUNDARY_DEDUPLICATION.minOverlapPx) return false
  if (overlap / leftLength < BOUNDARY_DEDUPLICATION.minCandidateOverlapRatio) return false
  const leftMidpoint = midpoint(left.pixelStart, left.pixelEnd)
  const rightMidpoint = midpoint(right.pixelStart, right.pixelEnd)
  return (
    pointToInfiniteLineDistance(leftMidpoint, right.pixelStart, right.pixelEnd) <=
      BOUNDARY_DEDUPLICATION.tolerancePx &&
    pointToInfiniteLineDistance(rightMidpoint, left.pixelStart, left.pixelEnd) <=
      BOUNDARY_DEDUPLICATION.tolerancePx
  )
}

function subtractPoint(left, right) {
  return [left[0] - right[0], left[1] - right[1]]
}

function dotPoint(left, right) {
  return left[0] * right[0] + left[1] * right[1]
}

function midpoint(left, right) {
  return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2]
}

function pointDistance(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1])
}

function pointToInfiniteLineDistance(point, lineStart, lineEnd) {
  const vector = subtractPoint(lineEnd, lineStart)
  const length = Math.hypot(vector[0], vector[1])
  if (!length) return Number.POSITIVE_INFINITY
  return Math.abs(
    vector[0] * (lineStart[1] - point[1]) -
      (lineStart[0] - point[0]) * vector[1],
  ) / length
}

function auditTolerantBoundaryOverlaps(collections) {
  const names = Object.keys(collections)
  const layers = {}
  let totalDuplicateLikeSegmentCount = 0
  for (const name of names) {
    const within = cleanBoundaryCollection(name, collections[name], []).report
    const exact = within.removedWithinExact
    const near = within.removedWithinNear
    layers[name] = { exact, near, total: exact + near }
    totalDuplicateLikeSegmentCount += exact + near
  }
  const pairs = []
  for (let leftIndex = 0; leftIndex < names.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < names.length; rightIndex += 1) {
      const left = names[leftIndex]
      const right = names[rightIndex]
      const report = cleanBoundaryCollection(right, collections[right], [
        { name: left, collection: collections[left] },
      ]).report
      const against = report.removedAgainst[left] ?? { exact: 0, near: 0 }
      const total = against.exact + against.near
      pairs.push({ left, right, exact: against.exact, near: against.near, total })
      totalDuplicateLikeSegmentCount += total
    }
  }
  return {
    ...BOUNDARY_DEDUPLICATION,
    layers,
    pairs,
    totalDuplicateLikeSegmentCount,
  }
}

function auditRenderedBoundaryOverlaps(collections) {
  const segmentSets = Object.fromEntries(
    Object.entries(collections).map(([name, collection]) => [name, boundarySegmentSet(collection)]),
  )
  const names = Object.keys(segmentSets)
  const pairs = []
  let totalCoincidentSegmentCount = 0
  for (let leftIndex = 0; leftIndex < names.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < names.length; rightIndex += 1) {
      const left = names[leftIndex]
      const right = names[rightIndex]
      const coincidentSegmentCount = setIntersectionSize(segmentSets[left], segmentSets[right])
      totalCoincidentSegmentCount += coincidentSegmentCount
      pairs.push({ left, right, coincidentSegmentCount })
    }
  }
  return {
    precision: 5,
    segmentCounts: Object.fromEntries(
      names.map((name) => [name, segmentSets[name].size]),
    ),
    pairs,
    totalCoincidentSegmentCount,
  }
}

function boundarySegmentSet(collection) {
  const segments = new Set()
  for (const feature of collection.features ?? []) {
    for (const line of lineCoordinates(feature.geometry)) {
      for (let index = 1; index < line.length; index += 1) {
        const left = boundaryCoordinateKey(line[index - 1])
        const right = boundaryCoordinateKey(line[index])
        if (!left || !right || left === right) continue
        segments.add(left < right ? `${left}|${right}` : `${right}|${left}`)
      }
    }
  }
  return segments
}

function lineCoordinates(geometry) {
  if (geometry?.type === 'LineString') return [geometry.coordinates ?? []]
  if (geometry?.type === 'MultiLineString') return geometry.coordinates ?? []
  return []
}

function boundaryCoordinateKey(coordinate) {
  if (!Array.isArray(coordinate) || coordinate.length < 2) return ''
  const longitude = Number(coordinate[0])
  const latitude = Number(coordinate[1])
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return ''
  return `${longitude.toFixed(5)},${latitude.toFixed(5)}`
}

function setIntersectionSize(left, right) {
  let count = 0
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left]
  for (const value of smaller) if (larger.has(value)) count += 1
  return count
}

function writeControlledLabelSubset(collection, spec) {
  const output = join(workDir, `${spec.id}.geojson`)
  const subset = {
    type: 'FeatureCollection',
    features: (collection.features ?? []).filter(
      (feature) => feature.properties?.level === spec.featureLevel,
    ),
  }
  writeFileSync(output, `${JSON.stringify(subset)}\n`)
  return output
}

function writeCountryBoundarySubset(spec, countries, boundaryCollection) {
  const countryAreas = new Map(
    (countries.features ?? []).map((feature) => [
      String(feature.properties?.country_key ?? ''),
      geometryArea(feature.geometry),
    ]),
  )
  const source = boundaryCollection ?? JSON.parse(readFileSync(spec.input, 'utf8'))
  const features = (source.features ?? []).map((feature) => {
    const leftKey = String(feature.properties?.left_geo_key ?? '')
    const rightKey = String(feature.properties?.right_geo_key ?? '')
    const leftArea = Number(countryAreas.get(leftKey) ?? 0)
    const rightArea = Number(countryAreas.get(rightKey) ?? 0)
    return {
      ...feature,
      properties: {
        ...(feature.properties ?? {}),
        level: 'country',
        left_area: leftArea,
        right_area: rightArea,
        min_area: Math.min(leftArea, rightArea),
        max_area: Math.max(leftArea, rightArea),
      },
    }
  })
  return writeDerivedCollection(spec.id, features)
}

function writeAdmin1BoundarySubset(spec) {
  const source = JSON.parse(readFileSync(spec.input, 'utf8'))
  const features = (source.features ?? []).filter((feature) => {
    const countryKey = String(feature.properties?.country_key ?? '')
    return spec.countryMode === 'only-vietnam' ? countryKey === 'vietnam' : countryKey !== 'vietnam'
  })
  return writeDerivedCollection(spec.id, features)
}

function writeGlobalAdmin2BoundarySubset(spec) {
  const source = JSON.parse(readFileSync(spec.input, 'utf8'))
  const features = (source.features ?? []).filter(
    (feature) => String(feature.properties?.country_key ?? '') !== 'china',
  )
  if (features.some((feature) => !feature.properties?.country_key)) {
    throw new Error(
      'Global ADM2 edge source is missing country_key; rebuild geo:global-city:prepare',
    )
  }
  return writeDerivedCollection(spec.id, features)
}

function writeRegionOutlineCollection(spec) {
  const sources = [
    { path: worldCountriesPath, level: 'country', minzoom: 0, include: () => true },
    {
      path: worldAdmin1Path,
      level: 'admin1',
      minzoom: 3,
      include: (feature) => String(feature.properties?.country_key ?? '') !== 'china',
    },
    { path: chinaProvincesPath, level: 'admin1', minzoom: 3, include: () => true },
    {
      path: worldCitiesPath,
      level: 'city',
      minzoom: 5,
      include: (feature) => String(feature.properties?.country_key ?? '') !== 'china',
    },
    { path: chinaCitiesPath, level: 'city', minzoom: 5, include: () => true },
  ]
  const features = []
  const expectedByLevel = { country: 0, admin1: 0, city: 0 }
  const emittedByLevel = { country: 0, admin1: 0, city: 0 }
  const regionIds = new Set()
  for (const sourceSpec of sources) {
    const collection = JSON.parse(readFileSync(sourceSpec.path, 'utf8'))
    for (const feature of collection.features ?? []) {
      if (!sourceSpec.include(feature)) continue
      expectedByLevel[sourceSpec.level] += 1
      const geoKey = outlineGeoKey(feature, sourceSpec.level)
      const regionId = geoKey ? `${sourceSpec.level}|${geoKey}` : ''
      if (!regionId)
        throw new Error(`Missing region outline key in ${relativePath(sourceSpec.path)}`)
      if (regionIds.has(regionId)) throw new Error(`Duplicate region outline id: ${regionId}`)
      const lines = geometryRings(feature.geometry).flatMap(splitAntimeridianLine)
      if (!lines.length) throw new Error(`Empty region outline: ${regionId}`)
      regionIds.add(regionId)
      emittedByLevel[sourceSpec.level] += 1
      features.push({
        type: 'Feature',
        tippecanoe: { minzoom: sourceSpec.minzoom, maxzoom: 8 },
        properties: {
          region_id: regionId,
          level: sourceSpec.level,
          geo_key: geoKey,
          parent_geo_key: String(feature.properties?.parent_geo_key ?? ''),
          country_key: String(feature.properties?.country_key ?? geoKey.split('|')[0] ?? ''),
        },
        geometry: {
          type: lines.length === 1 ? 'LineString' : 'MultiLineString',
          coordinates: lines.length === 1 ? lines[0] : lines,
        },
      })
    }
  }
  const result = writeDerivedCollection(spec.id, features)
  result.coverage = {
    expectedByLevel,
    emittedByLevel,
    matchRate:
      features.length > 0
        ? Number(
            (
              Object.values(emittedByLevel).reduce((sum, count) => sum + count, 0) /
              Object.values(expectedByLevel).reduce((sum, count) => sum + count, 0)
            ).toFixed(6),
          )
        : 0,
  }
  return result
}

function writeRegionPolygonCollection(spec) {
  const sources = [
    { path: worldCountriesPath, level: 'country', minzoom: 0, include: () => true },
    {
      path: worldAdmin1Path,
      level: 'admin1',
      minzoom: 3,
      include: (feature) => String(feature.properties?.country_key ?? '') !== 'china',
    },
    { path: chinaProvincesPath, level: 'admin1', minzoom: 3, include: () => true },
    {
      path: worldCitiesPath,
      level: 'city',
      minzoom: 5,
      include: (feature) => String(feature.properties?.country_key ?? '') !== 'china',
    },
    { path: chinaCitiesPath, level: 'city', minzoom: 5, include: () => true },
  ]
  const expectedByLevel = { country: 0, admin1: 0, city: 0 }
  const emittedByLevel = { country: 0, admin1: 0, city: 0 }
  const regionIds = new Set()
  const features = []

  for (const sourceSpec of sources) {
    const collection = JSON.parse(readFileSync(sourceSpec.path, 'utf8'))
    for (const feature of collection.features ?? []) {
      if (!sourceSpec.include(feature)) continue
      expectedByLevel[sourceSpec.level] += 1
      const geoKey = outlineGeoKey(feature, sourceSpec.level)
      const regionId = geoKey ? `${sourceSpec.level}|${geoKey}` : ''
      if (!regionId)
        throw new Error(`Missing region polygon key in ${relativePath(sourceSpec.path)}`)
      if (regionIds.has(regionId)) throw new Error(`Duplicate region polygon id: ${regionId}`)
      if (!['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) {
        throw new Error(`Invalid region polygon geometry: ${regionId}`)
      }
      regionIds.add(regionId)
      emittedByLevel[sourceSpec.level] += 1
      features.push({
        type: 'Feature',
        id: regionId,
        tippecanoe: { minzoom: sourceSpec.minzoom, maxzoom: 8 },
        properties: {
          region_id: regionId,
          level: sourceSpec.level,
          geo_key: geoKey,
          parent_geo_key: String(feature.properties?.parent_geo_key ?? ''),
          country_key: String(feature.properties?.country_key ?? geoKey.split('|')[0] ?? ''),
        },
        geometry: feature.geometry,
      })
    }
  }

  const result = writeDerivedCollection(spec.id, features)
  const expectedTotal = Object.values(expectedByLevel).reduce((sum, count) => sum + count, 0)
  const emittedTotal = Object.values(emittedByLevel).reduce((sum, count) => sum + count, 0)
  result.coverage = {
    expectedByLevel,
    emittedByLevel,
    expectedTotal,
    emittedTotal,
    matchRate: expectedTotal ? Number((emittedTotal / expectedTotal).toFixed(6)) : 0,
  }
  return result
}

function writeRegionDisplayOutlineCollection(spec) {
  const sourceSpecs = [
    { path: worldCountriesPath, level: 'country', minzoom: 0, include: () => true },
    {
      path: worldAdmin1Path,
      level: 'admin1',
      minzoom: 3,
      include: (feature) => String(feature.properties?.country_key ?? '') !== 'china',
    },
    { path: chinaProvincesPath, level: 'admin1', minzoom: 3, include: () => true },
    {
      path: worldCitiesPath,
      level: 'city',
      minzoom: 5,
      include: (feature) => String(feature.properties?.country_key ?? '') !== 'china',
    },
    { path: chinaCitiesPath, level: 'city', minzoom: 5, include: () => true },
  ]
  const countries = JSON.parse(readFileSync(worldCountriesPath, 'utf8'))
  const countryByKey = new Map(
    (countries.features ?? []).map((feature) => [
      String(feature.properties?.country_key ?? feature.properties?.geo_key ?? ''),
      feature,
    ]),
  )
  const overrides = new Map(
    (JSON.parse(readFileSync(chinaCoastalDisplayPath, 'utf8')).features ?? []).map((feature) => [
      String(feature.properties?.geo_key ?? ''),
      feature,
    ]),
  )
  const records = []
  for (const sourceSpec of sourceSpecs) {
    const collection = JSON.parse(readFileSync(sourceSpec.path, 'utf8'))
    for (const feature of collection.features ?? []) {
      if (!sourceSpec.include(feature)) continue
      const geoKey = outlineGeoKey(feature, sourceSpec.level)
      const regionId = geoKey ? `${sourceSpec.level}|${geoKey}` : ''
      if (!regionId) {
        throw new Error(`Missing display outline key in ${relativePath(sourceSpec.path)}`)
      }
      const countryKey = String(feature.properties?.country_key ?? geoKey.split('|')[0] ?? '')
      records.push({
        sourceSpec,
        feature,
        geoKey,
        regionId,
        countryKey,
        parentGeoKey: String(feature.properties?.parent_geo_key ?? ''),
        override: overrides.get(geoKey),
      })
    }
  }

  const groups = new Map()
  for (const record of records) {
    const groupKey = `${record.sourceSpec.level}|${
      record.sourceSpec.level === 'country' ? '__world__' : record.parentGeoKey || record.countryKey
    }`
    if (!groups.has(groupKey)) groups.set(groupKey, [])
    groups.get(groupKey).push(record)
  }

  const exteriorGridByCountry = new Map()
  const audit = {
    expectedCount: records.length,
    emittedCount: 0,
    matchRate: 0,
    coastalMultipartCandidates: 0,
    mergedToSinglePolygon: 0,
    curatedEnvelopeCount: 0,
    canonicalFallbackCount: 0,
    overlapCount: 0,
    fallbackReasons: {},
    modes: {},
    focusRegions: {},
    continentSamples: {},
  }
  const outputRecords = []
  const increment = (target, key) => {
    target[key] = (target[key] ?? 0) + 1
  }

  for (const siblings of groups.values()) {
    const accepted = []
    const ordered = [...siblings].sort(
      (left, right) =>
        Number(Boolean(right.override)) - Number(Boolean(left.override)) ||
        left.regionId.localeCompare(right.regionId),
    )
    for (const record of ordered) {
      const beforeCount = geometryPolygons(record.feature.geometry).length
      let displayGeometry = record.feature.geometry
      let mode = 'canonical'
      let fallbackReason = ''

      if (record.override?.geometry) {
        displayGeometry = record.override.geometry
        mode = String(
          record.override.properties?.display_geometry_mode ?? 'curated-coastal-envelope',
        )
        audit.curatedEnvelopeCount += 1
      } else {
        const country = countryByKey.get(record.countryKey)
        const candidate = buildAutomaticCoastalEnvelope(
          record.feature,
          record.sourceSpec.level,
          country?.geometry,
          exteriorGridByCountry,
          record.countryKey,
        )
        if (candidate.eligible) audit.coastalMultipartCandidates += 1
        if (candidate.geometry) {
          const overlapsCanonicalSibling = siblings.some(
            (sibling) =>
              sibling !== record &&
              geometriesHaveAreaOverlap(candidate.geometry, sibling.feature.geometry),
          )
          const overlapsAcceptedEnvelope = accepted.some((sibling) =>
            geometriesHaveAreaOverlap(candidate.geometry, sibling.geometry),
          )
          if (!overlapsCanonicalSibling && !overlapsAcceptedEnvelope) {
            displayGeometry = candidate.geometry
            mode = 'automatic-coastal-envelope'
            audit.mergedToSinglePolygon += 1
          } else {
            fallbackReason = overlapsCanonicalSibling
              ? 'overlaps-canonical-sibling'
              : 'overlaps-display-envelope'
          }
        } else if (candidate.eligible) {
          fallbackReason = candidate.reason || 'unsafe-envelope'
        }
      }

      // Automatic candidates were checked above against every canonical
      // sibling. Canonical fallbacks are already a cleaned topology, while
      // curated envelopes passed the boundary builder's tolerance-aware audit.
      // Only compare curated envelopes with other accepted display envelopes.
      const overlapsCanonicalSibling = false
      const overlapsAcceptedEnvelope =
        Boolean(record.override) &&
        accepted.some(
          (sibling) =>
            sibling.mode.includes('envelope') &&
            geometriesHaveAreaOverlap(displayGeometry, sibling.geometry),
        )
      if (overlapsCanonicalSibling || overlapsAcceptedEnvelope) {
        if (record.override) {
          throw new Error(`Curated display envelope overlaps a sibling: ${record.regionId}`)
        }
        displayGeometry = record.feature.geometry
        mode = 'canonical'
        fallbackReason = overlapsCanonicalSibling
          ? 'overlaps-canonical-sibling'
          : 'overlaps-display-envelope'
      }
      if (fallbackReason) {
        audit.canonicalFallbackCount += 1
        increment(audit.fallbackReasons, fallbackReason)
      }
      increment(audit.modes, mode)
      accepted.push({ regionId: record.regionId, geometry: displayGeometry, mode })
      outputRecords.push({ record, displayGeometry, mode, beforeCount, fallbackReason })
    }
  }

  for (let leftIndex = 0; leftIndex < outputRecords.length; leftIndex += 1) {
    const left = outputRecords[leftIndex]
    for (let rightIndex = leftIndex + 1; rightIndex < outputRecords.length; rightIndex += 1) {
      const right = outputRecords[rightIndex]
      if (
        !left.mode.includes('envelope') ||
        !right.mode.includes('envelope') ||
        left.record.sourceSpec.level !== right.record.sourceSpec.level ||
        (left.record.sourceSpec.level !== 'country' &&
          (left.record.parentGeoKey || left.record.countryKey) !==
            (right.record.parentGeoKey || right.record.countryKey))
      ) {
        continue
      }
      if (geometriesHaveAreaOverlap(left.displayGeometry, right.displayGeometry)) {
        audit.overlapCount += 1
      }
    }
  }
  if (audit.overlapCount) {
    throw new Error(`Display outline validation found ${audit.overlapCount} sibling overlap(s)`)
  }

  const features = outputRecords.map(
    ({ record, displayGeometry, mode, beforeCount, fallbackReason }) => {
      const lines = geometryRings(displayGeometry).flatMap(splitAntimeridianLine)
      if (!lines.length) throw new Error(`Empty region display outline: ${record.regionId}`)
      const afterCount = geometryPolygons(displayGeometry).length
      const properties = {
        region_id: record.regionId,
        level: record.sourceSpec.level,
        geo_key: record.geoKey,
        parent_geo_key: record.parentGeoKey,
        country_key: record.countryKey,
        display_geometry_mode: mode,
        component_count_before: beforeCount,
        component_count_after: afterCount,
        ...(fallbackReason ? { fallback_reason: fallbackReason } : {}),
      }
      if (['china|hongkong', 'china|aomen', 'china|guangdong|zhuhai'].includes(record.geoKey)) {
        audit.focusRegions[record.geoKey] = {
          mode,
          componentCountBefore: beforeCount,
          componentCountAfter: afterCount,
          lineCount: lines.length,
        }
      }
      return {
        type: 'Feature',
        tippecanoe: { minzoom: record.sourceSpec.minzoom, maxzoom: 8 },
        properties,
        geometry: {
          type: lines.length === 1 ? 'LineString' : 'MultiLineString',
          coordinates: lines.length === 1 ? lines[0] : lines,
        },
      }
    },
  )
  audit.emittedCount = features.length
  audit.matchRate = audit.expectedCount
    ? Number((audit.emittedCount / audit.expectedCount).toFixed(6))
    : 0
  audit.continentSamples = Object.fromEntries(
    Object.entries(CONTINENT_COUNTRY_SAMPLES).map(([continent, countryKeys]) => [
      continent,
      countryKeys.map((countryKey) => {
        const matching = outputRecords.filter((item) => item.record.countryKey === countryKey)
        return {
          countryKey,
          outlineCount: matching.length,
          coastalEnvelopeCount: matching.filter((item) => item.mode.includes('envelope')).length,
          fallbackCount: matching.filter((item) => item.fallbackReason).length,
        }
      }),
    ]),
  )
  const result = writeDerivedCollection(spec.id, features)
  result.audit = audit
  return result
}

function writeDerivedCollection(id, features) {
  const path = join(workDir, `${id}.geojson`)
  writeFileSync(path, `${JSON.stringify({ type: 'FeatureCollection', features })}\n`)
  return { path, count: features.length }
}

function outlineGeoKey(feature, level) {
  const props = feature.properties ?? {}
  if (level === 'country') return String(props.geo_key ?? props.country_key ?? '')
  return String(
    props.geo_key ?? `${String(props.country_key ?? '')}|${String(props.region_key ?? '')}`,
  ).replace(/\|$/, '')
}

function geometryRings(geometry) {
  if (geometry?.type === 'Polygon') return geometry.coordinates
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates.flat()
  return []
}

function geometryPolygons(geometry) {
  if (geometry?.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    return [geometry.coordinates]
  }
  if (geometry?.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates
  }
  return []
}

function buildAutomaticCoastalEnvelope(
  feature,
  level,
  countryGeometry,
  exteriorGridByCountry,
  countryKey,
) {
  const polygons = geometryPolygons(feature.geometry)
  if (polygons.length < 2) return { eligible: false, geometry: null, reason: '' }
  if (polygons.length > 24) {
    return { eligible: true, geometry: null, reason: 'too-many-components' }
  }
  if (geometryCrossesAntimeridian(feature.geometry)) {
    return { eligible: true, geometry: null, reason: 'antimeridian-or-remote-components' }
  }
  if (level !== 'country') {
    if (!countryGeometry) {
      return { eligible: true, geometry: null, reason: 'missing-country-coastline' }
    }
    let grid = exteriorGridByCountry.get(countryKey)
    if (!grid) {
      grid = buildExteriorSegmentGrid(countryGeometry)
      exteriorGridByCountry.set(countryKey, grid)
    }
    if (!geometryTouchesExteriorGrid(feature.geometry, grid)) {
      return { eligible: false, geometry: null, reason: 'inland-multipart' }
    }
  }
  const bbox = geometryBbox(feature.geometry)
  if (!bbox) return { eligible: true, geometry: null, reason: 'empty-geometry' }
  const spanKm = haversineKm([bbox[0], bbox[1]], [bbox[2], bbox[3]])
  const spanLimitKm = level === 'country' ? 700 : level === 'admin1' ? 260 : 120
  if (spanKm > spanLimitKm) {
    return { eligible: true, geometry: null, reason: 'remote-components' }
  }
  const points = polygons.flatMap((polygon) => polygon[0] ?? [])
  const hull = convexHull(points)
  if (hull.length < 4) return { eligible: true, geometry: null, reason: 'invalid-hull' }
  const geometry = { type: 'Polygon', coordinates: [hull] }
  const canonicalArea = geometryArea(feature.geometry)
  const envelopeArea = geometryArea(geometry)
  if (!canonicalArea || envelopeArea / canonicalArea > 14) {
    return { eligible: true, geometry: null, reason: 'excessive-area-growth' }
  }
  return { eligible: true, geometry, reason: '' }
}

function buildExteriorSegmentGrid(geometry) {
  const cellSize = 0.5
  const tolerance = 0.035
  const cells = new Map()
  for (const polygon of geometryPolygons(geometry)) {
    const ring = polygon[0] ?? []
    for (let index = 1; index < ring.length; index += 1) {
      const left = ring[index - 1]
      const right = ring[index]
      if (!left || !right || Math.abs(left[0] - right[0]) > 180) continue
      const segment = { left, right }
      const minX = Math.floor((Math.min(left[0], right[0]) - tolerance) / cellSize)
      const maxX = Math.floor((Math.max(left[0], right[0]) + tolerance) / cellSize)
      const minY = Math.floor((Math.min(left[1], right[1]) - tolerance) / cellSize)
      const maxY = Math.floor((Math.max(left[1], right[1]) + tolerance) / cellSize)
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          const key = `${x}|${y}`
          if (!cells.has(key)) cells.set(key, [])
          cells.get(key).push(segment)
        }
      }
    }
  }
  return { cellSize, tolerance, cells }
}

function geometryTouchesExteriorGrid(geometry, grid) {
  for (const polygon of geometryPolygons(geometry)) {
    for (const point of polygon[0] ?? []) {
      const key = `${Math.floor(point[0] / grid.cellSize)}|${Math.floor(point[1] / grid.cellSize)}`
      if (
        (grid.cells.get(key) ?? []).some(
          (segment) => pointToSegmentDistance(point, segment.left, segment.right) <= grid.tolerance,
        )
      ) {
        return true
      }
    }
  }
  return false
}

function pointToSegmentDistance(point, left, right) {
  const dx = right[0] - left[0]
  const dy = right[1] - left[1]
  if (!dx && !dy) return Math.hypot(point[0] - left[0], point[1] - left[1])
  const ratio = Math.max(
    0,
    Math.min(1, ((point[0] - left[0]) * dx + (point[1] - left[1]) * dy) / (dx * dx + dy * dy)),
  )
  return Math.hypot(point[0] - (left[0] + ratio * dx), point[1] - (left[1] + ratio * dy))
}

function geometryCrossesAntimeridian(geometry) {
  const bbox = geometryBbox(geometry)
  if (bbox && bbox[2] - bbox[0] > 180) return true
  return geometryRings(geometry).some((ring) =>
    ring.some((point, index) => index > 0 && Math.abs(point[0] - ring[index - 1][0]) > 180),
  )
}

function geometryBbox(geometry) {
  const points = geometryPolygons(geometry).flatMap((polygon) => polygon.flat())
  if (!points.length) return null
  return points.reduce(
    (bbox, point) => [
      Math.min(bbox[0], Number(point?.[0] ?? Infinity)),
      Math.min(bbox[1], Number(point?.[1] ?? Infinity)),
      Math.max(bbox[2], Number(point?.[0] ?? -Infinity)),
      Math.max(bbox[3], Number(point?.[1] ?? -Infinity)),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  )
}

function convexHull(values) {
  const unique = [
    ...new Map(
      values
        .filter((point) => Array.isArray(point) && point.length >= 2)
        .map((point) => [
          `${Number(point[0]).toFixed(6)},${Number(point[1]).toFixed(6)}`,
          [Number(point[0]), Number(point[1])],
        ]),
    ).values(),
  ].sort((left, right) => left[0] - right[0] || left[1] - right[1])
  if (unique.length < 3) return []
  const cross = (origin, left, right) =>
    (left[0] - origin[0]) * (right[1] - origin[1]) - (left[1] - origin[1]) * (right[0] - origin[0])
  const lower = []
  for (const point of unique) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop()
    }
    lower.push(point)
  }
  const upper = []
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index]
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop()
    }
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  const hull = [...lower, ...upper]
  return hull.length >= 3 ? [...hull, hull[0]] : []
}

function geometriesHaveAreaOverlap(leftGeometry, rightGeometry) {
  const leftBbox = geometryBbox(leftGeometry)
  const rightBbox = geometryBbox(rightGeometry)
  if (!leftBbox || !rightBbox || !bboxRangesOverlap(leftBbox, rightBbox)) return false
  for (const leftPolygon of geometryPolygons(leftGeometry)) {
    for (const rightPolygon of geometryPolygons(rightGeometry)) {
      const leftRing = leftPolygon[0] ?? []
      const rightRing = rightPolygon[0] ?? []
      const polygonBboxLeft = ringBbox(leftRing)
      const polygonBboxRight = ringBbox(rightRing)
      if (!bboxRangesOverlap(polygonBboxLeft, polygonBboxRight)) continue
      if (ringsProperlyIntersect(leftRing, rightRing)) return true
      const leftPoint = polygonInteriorPoint(leftPolygon)
      const rightPoint = polygonInteriorPoint(rightPolygon)
      if (
        (leftPoint && pointInPolygon(leftPoint, rightPolygon)) ||
        (rightPoint && pointInPolygon(rightPoint, leftPolygon))
      ) {
        return true
      }
    }
  }
  return false
}

function ringsProperlyIntersect(leftRing, rightRing) {
  for (let leftIndex = 1; leftIndex < leftRing.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex < rightRing.length; rightIndex += 1) {
      if (
        segmentsProperlyIntersect(
          leftRing[leftIndex - 1],
          leftRing[leftIndex],
          rightRing[rightIndex - 1],
          rightRing[rightIndex],
        )
      ) {
        return true
      }
    }
  }
  return false
}

function segmentsProperlyIntersect(a, b, c, d) {
  if (!segmentBboxesIntersect(a, b, c, d)) return false
  const first = orientation(a, b, c)
  const second = orientation(a, b, d)
  const third = orientation(c, d, a)
  const fourth = orientation(c, d, b)
  return first * second < -1e-12 && third * fourth < -1e-12
}

function segmentBboxesIntersect(a, b, c, d) {
  return (
    Math.min(a[0], b[0]) <= Math.max(c[0], d[0]) &&
    Math.max(a[0], b[0]) >= Math.min(c[0], d[0]) &&
    Math.min(a[1], b[1]) <= Math.max(c[1], d[1]) &&
    Math.max(a[1], b[1]) >= Math.min(c[1], d[1])
  )
}

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function polygonInteriorPoint(polygon) {
  const ring = polygon?.[0] ?? []
  let twiceArea = 0
  let x = 0
  let y = 0
  for (let index = 1; index < ring.length; index += 1) {
    const left = ring[index - 1]
    const right = ring[index]
    const cross = left[0] * right[1] - right[0] * left[1]
    twiceArea += cross
    x += (left[0] + right[0]) * cross
    y += (left[1] + right[1]) * cross
  }
  const centroid = Math.abs(twiceArea) > 1e-12 ? [x / (3 * twiceArea), y / (3 * twiceArea)] : null
  if (centroid && pointInPolygon(centroid, polygon)) return centroid
  const bbox = ringBbox(ring)
  const middle = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
  return pointInPolygon(middle, polygon) ? middle : (ring[0] ?? null)
}

function pointInPolygon(point, polygon) {
  if (!pointInRing(point, polygon?.[0] ?? [])) return false
  return (polygon?.slice(1) ?? []).every((ring) => !pointInRing(point, ring))
}

function pointInRing([x, y], ring) {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const current = ring[index]
    const before = ring[previous]
    if (!current || !before) continue
    const intersects =
      current[1] > y !== before[1] > y &&
      x < ((before[0] - current[0]) * (y - current[1])) / (before[1] - current[1]) + current[0]
    if (intersects) inside = !inside
  }
  return inside
}

function ringBbox(ring) {
  return (ring ?? []).reduce(
    (bbox, point) => [
      Math.min(bbox[0], point[0]),
      Math.min(bbox[1], point[1]),
      Math.max(bbox[2], point[0]),
      Math.max(bbox[3], point[1]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  )
}

function bboxRangesOverlap(left, right) {
  return left[0] < right[2] && left[2] > right[0] && left[1] < right[3] && left[3] > right[1]
}

function haversineKm(left, right) {
  const radians = (value) => (value * Math.PI) / 180
  const latitudeDelta = radians(right[1] - left[1])
  const longitudeDelta = radians(right[0] - left[0])
  const leftLatitude = radians(left[1])
  const rightLatitude = radians(right[1])
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function splitAntimeridianLine(ring) {
  if (!Array.isArray(ring) || ring.length < 2) return []
  const parts = []
  let part = [ring[0]]
  for (let index = 1; index < ring.length; index += 1) {
    const point = ring[index]
    const previous = ring[index - 1]
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

function featureCount(path) {
  return JSON.parse(readFileSync(path, 'utf8')).features?.length ?? 0
}

function writeGlobalAdmin2FallbackLabelSubset(spec, curatedCountryKeys) {
  const source = JSON.parse(readFileSync(spec.input, 'utf8'))
  const features = (source.features ?? [])
    .filter((feature) => {
      const countryKey = feature.properties?.country_key
      return countryKey && countryKey !== 'china' && !curatedCountryKeys.has(countryKey)
    })
    .map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        display_name_en: feature.properties?.display_name ?? feature.properties?.name ?? '',
        display_name_zh: feature.properties?.display_name ?? feature.properties?.name ?? '',
        priority: feature.properties?.source_level === 'CGAZ_ADM2' ? 0 : -1000,
      },
    }))
  const output = join(workDir, `${spec.id}.geojson`)
  writeFileSync(output, `${JSON.stringify({ type: 'FeatureCollection', features })}\n`)
  return { path: output, count: features.length }
}

function ensureCountryLabelCoverage(labels, countries) {
  const features = labels.features ?? []
  const countryLabels = new Set(
    features
      .filter((feature) => feature.properties?.level === 'country')
      .map((feature) => feature.properties?.country_key ?? feature.properties?.geo_key),
  )
  const repairs = []
  for (const country of countries.features ?? []) {
    const props = country.properties ?? {}
    const countryKey = props.country_key
    if (!countryKey || countryLabels.has(countryKey)) continue
    const fallback = features.find(
      (feature) =>
        feature.properties?.level === 'admin1' && feature.properties?.country_key === countryKey,
    )
    const point =
      fallback?.geometry?.type === 'Point'
        ? fallback.geometry.coordinates
        : representativePoint(country.geometry)
    if (!point) throw new Error(`Unable to create missing country label: ${countryKey}`)
    const area = geometryArea(country.geometry)
    const fallbackProps = fallback?.properties ?? {}
    const displayNameEn = props.display_name ?? props.name ?? countryKey
    const displayNameZh =
      fallbackProps.display_name_zh ?? fallbackProps.display_name ?? displayNameEn
    features.push({
      type: 'Feature',
      properties: {
        level: 'country',
        geo_key: countryKey,
        parent_geo_key: '',
        country_key: countryKey,
        display_name: displayNameZh,
        display_name_zh: displayNameZh,
        display_name_en: displayNameEn,
        area,
        parent_country_area: area,
        has_admin1: Boolean(fallback),
        administrative_class: 'country',
        is_special: false,
        is_cjk: true,
        suppress_country_label: false,
        world_priority: false,
        priority: -30000 - Math.round(Math.sqrt(Math.max(0, area)) * 100),
        label_method: fallback ? 'admin1-label-repair' : 'geometry-repair',
        label_clearance: fallbackProps.label_clearance ?? 0,
        label_clearance_ratio: fallbackProps.label_clearance_ratio ?? 0,
      },
      geometry: { type: 'Point', coordinates: point },
    })
    countryLabels.add(countryKey)
    repairs.push({ countryKey, displayNameZh, displayNameEn })
  }
  return repairs
}

function representativePoint(geometry) {
  const polygons =
    geometry?.type === 'Polygon'
      ? geometry.coordinates
      : geometry?.type === 'MultiPolygon'
        ? geometry.coordinates.flat()
        : []
  const ring = polygons
    .filter((candidate) => Array.isArray(candidate?.[0]))
    .sort((left, right) => ringArea(right) - ringArea(left))[0]
  if (!ring?.length) return null
  const points = ring.filter((point) => Array.isArray(point) && point.length >= 2)
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  return [
    Number(((Math.min(...xs) + Math.max(...xs)) / 2).toFixed(6)),
    Number(((Math.min(...ys) + Math.max(...ys)) / 2).toFixed(6)),
  ]
}

function geometryArea(geometry) {
  if (geometry?.type === 'Polygon') return polygonArea(geometry.coordinates)
  if (geometry?.type === 'MultiPolygon') {
    return geometry.coordinates.reduce((sum, polygon) => sum + polygonArea(polygon), 0)
  }
  return 0
}

function polygonArea(polygon) {
  if (!Array.isArray(polygon)) return 0
  return polygon.reduce((sum, ring, index) => sum + (index === 0 ? 1 : -1) * ringArea(ring), 0)
}

function ringArea(ring) {
  if (!Array.isArray(ring)) return 0
  let sum = 0
  for (let index = 0; index < ring.length - 1; index += 1) {
    sum += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1]
  }
  return Math.abs(sum / 2)
}

function requireCommands(commands) {
  commands.forEach((command) => {
    try {
      execFileSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' })
    } catch {
      throw new Error(`Missing required command: ${command}`)
    }
  })
}

function requireFile(path) {
  if (!existsSync(path)) throw new Error(`Missing preview map input: ${path}`)
}

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' })
}

function runCapture(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' })
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function relativePath(path) {
  return path.startsWith(`${rootDir}/`) ? path.slice(rootDir.length + 1) : path
}
