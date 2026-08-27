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
import { auditPreviewTileBoundaries } from './audit-preview-tile-boundaries.mjs'
import {
  buildPresentationAdministration,
  PRESENTATION_ADMIN2_BOUNDARY_ZOOM,
  PRESENTATION_ADMIN2_ZOOM,
  presentationLabelMinZoom,
  writePresentationCollection,
} from './presentation-admin.mjs'
import { cleanPresentationLabel } from './presentation-names.mjs'

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
const regionIndexPath = join(renderDir, 'region-index.json')
const reportPath = join(generatedDir, 'preview-composite-report.json')
const boundaryLegalEndpointsPath = join(generatedDir, 'boundary-legal-endpoints.json')
const workDir = mkdtempSync(join(tmpdir(), 'wbe-preview-composite-'))
const controlledLabelsPath = join(sourceDir, 'controlled-labels.geojson')
const cldrSnapshotPath = join(sourceDir, 'cldr-subdivisions-48.json')
const officialNameOverridesPath = join(sourceDir, 'official-admin-name-zh.json')
const boundarySourceManifestPath = join(sourceDir, 'boundary-source-manifest.json')
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
  gridSizePx: 16,
  partialNearSegmentRemoval: false,
  ownershipPolicy: 'exact-segment-first-owner',
}
const RENDERED_BOUNDARY_LAYER_RANGES = Object.freeze({
  country: [3, 8],
  admin1: [4, 8],
  // Fractional zoom 6.35 is rendered from z6 vector tiles, so child
  // boundaries must participate in ownership/reconciliation from z6.
  admin2: [6, 8],
  chinaProvince: [4, 8],
  chinaCity: [6, 8],
})

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
  mkdirSync(generatedDir, { recursive: true })
  ;[
    ...directArchives,
    ...canonicalBoundaryInputs,
    cgazAdmin1ShapePath,
    mapshaperBin,
    regionIndexPath,
    cldrSnapshotPath,
    officialNameOverridesPath,
    boundarySourceManifestPath,
    ...layerSpecs.filter((spec) => spec.file).map((spec) => join(sourceDir, spec.file)),
    ...layerSpecs.filter((spec) => spec.input).map((spec) => spec.input),
  ].forEach(requireFile)

  const worldCountries = JSON.parse(readFileSync(worldCountriesPath, 'utf8'))
  const boundarySourceManifest = JSON.parse(readFileSync(boundarySourceManifestPath, 'utf8'))
  validateBoundarySourceManifest(boundarySourceManifest)
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
    nameQualityReportPath: join(generatedDir, 'presentation-name-quality-report.json'),
  })
  const enrichedRegionIndex = enrichPresentationRegionIndex(
    JSON.parse(readFileSync(regionIndexPath, 'utf8')),
    presentationAdministration.collections,
  )
  validateEnrichedRegionIndex(enrichedRegionIndex)
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
  writeFileSync(
    join(generatedDir, 'boundary-exact-overlap-diagnostic.json'),
    `${JSON.stringify(renderedBoundaryOverlapAudit, null, 2)}\n`,
  )
  if (renderedBoundaryOverlapAudit.totalCoincidentSegmentCount !== 0) {
    throw new Error(
      `Visible boundary layers contain ${renderedBoundaryOverlapAudit.totalCoincidentSegmentCount} coincident segments: ${JSON.stringify(
        renderedBoundaryOverlapAudit.pairs.filter((pair) => pair.coincidentSegmentCount),
      )}`,
    )
  }
  const tolerantBoundaryOverlapAudit = auditTolerantBoundaryOverlaps(
    renderedBoundaryCleanup.collections,
  )
  writeFileSync(
    join(generatedDir, 'boundary-overlap-diagnostic.json'),
    `${JSON.stringify(tolerantBoundaryOverlapAudit, null, 2)}\n`,
  )
  if (tolerantBoundaryOverlapAudit.totalDuplicateLikeSegmentCount !== 0) {
    const failures = {
      layers: Object.fromEntries(
        Object.entries(tolerantBoundaryOverlapAudit.layers).filter(([, value]) => value.total),
      ),
      pairs: tolerantBoundaryOverlapAudit.pairs.filter((pair) => pair.total),
    }
    throw new Error(
      `Visible boundary layers contain ${tolerantBoundaryOverlapAudit.totalDuplicateLikeSegmentCount} duplicate-like segments within the Z8 tolerance: ${JSON.stringify(failures)}`,
    )
  }
  const boundaryLegalEndpoints = buildBoundaryLegalEndpointManifest(
    renderedBoundaryCleanup.collections,
  )
  writeFileSync(boundaryLegalEndpointsPath, `${JSON.stringify(boundaryLegalEndpoints)}\n`)
  const labelCounts = Object.fromEntries(
    ['country', 'admin1', 'city'].map((level) => [
      level,
      (controlledLabels.features ?? []).filter((feature) => feature.properties?.level === level)
        .length,
    ]),
  )
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
    if (spec.transform === 'region-polygons') {
      args.push('--simplification', '1', '--simplification-at-maximum-zoom', '0.15')
    } else {
      args.push('--no-line-simplification')
    }
    if (spec.id.includes('boundar') || spec.id === 'preview_country_overview') {
      args.push('--full-detail', '15', '--low-detail', '15', '--minimum-detail', '15')
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
  const boundaryTileOverlapAudit = await auditPreviewTileBoundaries(outputArchive, {
    legalEndpointsPath: boundaryLegalEndpointsPath,
  })
  writeFileSync(
    join(generatedDir, 'boundary-tile-diagnostic.json'),
    `${JSON.stringify(boundaryTileOverlapAudit, null, 2)}\n`,
  )
  if (
    boundaryTileOverlapAudit.exactDuplicateCount !== 0 ||
    boundaryTileOverlapAudit.nearDuplicateLikeCount !== 0 ||
    boundaryTileOverlapAudit.crossLayerOverlapCount !== 0 ||
    boundaryTileOverlapAudit.interiorDanglingEndpointCount !== 0 ||
    boundaryTileOverlapAudit.tileSeamDanglingEndpointCount !== 0
  ) {
    throw new Error(
      `Final Z0-Z8 boundary audit failed: exact=${boundaryTileOverlapAudit.exactDuplicateCount}, near=${boundaryTileOverlapAudit.nearDuplicateLikeCount}, cross-layer=${boundaryTileOverlapAudit.crossLayerOverlapCount}, dangling=${boundaryTileOverlapAudit.interiorDanglingEndpointCount}, seam=${boundaryTileOverlapAudit.tileSeamDanglingEndpointCount}`,
    )
  }

  const header = JSON.parse(runCapture('pmtiles', ['show', '--header-json', outputArchive]))
  const metadata = JSON.parse(runCapture('pmtiles', ['show', '--metadata', outputArchive]))
  writeFileSync(regionIndexPath, `${JSON.stringify(enrichedRegionIndex, null, 2)}\n`)
  const inputs = [
    ...new Set([
      ...directArchives,
      ...canonicalBoundaryInputs,
      cgazAdmin1ShapePath,
      controlledLabelsPath,
      cldrSnapshotPath,
      officialNameOverridesPath,
      boundarySourceManifestPath,
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
    boundarySources: boundarySourceManifest,
    renderedBoundaryCleanup: renderedBoundaryCleanup.report,
    renderedBoundaryOverlapAudit,
    tolerantBoundaryOverlapAudit,
    boundaryTileOverlapAudit,
    regionPolygonCoverage,
    regionIndexCoverage: enrichedRegionIndex.presentation,
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
  const country = deduplicateExactBoundaryCollection('country', collections.country)
  const admin1Exact = deduplicateExactBoundaryCollection('admin1', collections.admin1)
  const admin2Exact = deduplicateExactBoundaryCollection('admin2', collections.admin2)
  const chinaProvinceExact = deduplicateExactBoundaryCollection(
    'chinaProvince',
    collections.chinaProvince,
  )
  const chinaCityExact = deduplicateExactBoundaryCollection('chinaCity', collections.chinaCity)
  for (const result of [country, admin1Exact, admin2Exact, chinaProvinceExact, chinaCityExact]) {
    nodeBoundaryResultAtTileSeams(result)
  }
  const admin1 = assignHierarchyBoundaryOwnership('admin1', admin1Exact, [country])
  const admin2 = assignHierarchyBoundaryOwnership('admin2', admin2Exact, [admin1, country])
  const chinaProvince = assignHierarchyBoundaryOwnership('chinaProvince', chinaProvinceExact, [
    country,
  ])
  const chinaCity = assignHierarchyBoundaryOwnership('chinaCity', chinaCityExact, [
    chinaProvince,
    country,
  ])
  for (const result of [country, admin1, admin2, chinaProvince, chinaCity]) {
    nodeBoundaryResultAtTileSeams(result)
  }
  enforceFinalExactParentOwnership(admin1, [country])
  enforceFinalExactParentOwnership(admin2, [admin1, country])
  enforceFinalExactParentOwnership(chinaProvince, [country])
  enforceFinalExactParentOwnership(chinaCity, [chinaProvince, country])
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

function nodeBoundaryResultAtTileSeams(result) {
  result.collection = {
    type: 'FeatureCollection',
    features: (result.collection.features ?? []).map((feature) => ({
      ...feature,
      geometry: nodeBoundaryGeometryAtTileSeams(feature.geometry),
    })),
  }
  result.report.hierarchyOwnership ??= {}
  result.report.hierarchyOwnership.tileSeamNodeZoom = BOUNDARY_DEDUPLICATION.zoom
}

function nodeBoundaryGeometryAtTileSeams(geometry) {
  const lines = lineCoordinates(geometry).map((line) => {
    const output = []
    for (let index = 1; index < line.length; index += 1) {
      const points = nodeBoundarySegmentAtTileSeams(line[index - 1], line[index])
      if (!points.length) continue
      if (!output.length) output.push(points[0])
      output.push(...points.slice(1))
    }
    return output
  })
  return {
    type: lines.length === 1 ? 'LineString' : 'MultiLineString',
    coordinates: lines.length === 1 ? lines[0] : lines,
  }
}

function nodeBoundarySegmentAtTileSeams(start, end) {
  if (!Array.isArray(start) || !Array.isArray(end)) return []
  if (Math.abs(Number(end[0]) - Number(start[0])) > 180) return [start, end]
  const zoom = BOUNDARY_DEDUPLICATION.zoom
  const pixelStart = boundaryWorldPixel(start, zoom)
  const pixelEnd = boundaryWorldPixel(end, zoom)
  const ratios = new Set([0, 1])
  for (const axis of [0, 1]) {
    const left = pixelStart[axis]
    const right = pixelEnd[axis]
    const delta = right - left
    if (Math.abs(delta) < 1e-9) continue
    const minimumBoundary = Math.floor(Math.min(left, right) / 512) + 1
    const maximumBoundary = Math.ceil(Math.max(left, right) / 512) - 1
    for (let boundary = minimumBoundary; boundary <= maximumBoundary; boundary += 1) {
      const ratio = (boundary * 512 - left) / delta
      if (ratio > 1e-9 && ratio < 1 - 1e-9) ratios.add(ratio)
    }
  }
  const coordinates = [...ratios]
    .sort((left, right) => left - right)
    .map((ratio) =>
      boundaryWorldPixelToCoordinate(
        [
          pixelStart[0] + (pixelEnd[0] - pixelStart[0]) * ratio,
          pixelStart[1] + (pixelEnd[1] - pixelStart[1]) * ratio,
        ],
        zoom,
      ),
    )
  return coordinates.filter(
    (coordinate, index) =>
      index === 0 ||
      pointDistance(
        boundaryWorldPixel(coordinates[index - 1], zoom),
        boundaryWorldPixel(coordinate, zoom),
      ) > 1e-6,
  )
}

function boundaryWorldPixelToCoordinate([x, y], zoom) {
  const size = BOUNDARY_DEDUPLICATION.tileSize * 2 ** zoom
  const longitude = (x / size) * 360 - 180
  const mercator = Math.PI - (2 * Math.PI * y) / size
  const latitude = (Math.atan(Math.sinh(mercator)) * 180) / Math.PI
  return [longitude, latitude]
}

function enforceFinalExactParentOwnership(childResult, parentResults) {
  const parentSegmentKeys = new Set()
  for (const parentResult of parentResults) {
    for (const record of collectBoundarySegments(parentResult.collection, 'parent')) {
      parentSegmentKeys.add(record.exactKey)
    }
  }
  const keptByFeature = new Map()
  let removedSegmentCount = 0
  for (const record of collectBoundarySegments(childResult.collection, 'child')) {
    if (parentSegmentKeys.has(record.exactKey)) {
      removedSegmentCount += 1
      continue
    }
    const segments = keptByFeature.get(record.featureIndex) ?? []
    segments.push([record.start, record.end])
    keptByFeature.set(record.featureIndex, segments)
  }
  const sourceFeatures = childResult.collection.features
  childResult.collection = {
    type: 'FeatureCollection',
    features: [...keptByFeature.entries()].map(([featureIndex, segments]) => {
      const sourceFeature = sourceFeatures[featureIndex]
      const lines = stitchBoundarySegments(segments)
      return {
        ...sourceFeature,
        geometry: {
          type: lines.length === 1 ? 'LineString' : 'MultiLineString',
          coordinates: lines.length === 1 ? lines[0] : lines,
        },
      }
    }),
  }
  childResult.report.hierarchyOwnership.finalExactParentOwnedSegmentCount = removedSegmentCount
}

function assignHierarchyBoundaryOwnership(layerName, childResult, parentResults) {
  const baseMinZoom = ['admin1', 'chinaProvince'].includes(layerName) ? 4 : 7
  const childRecords = collectBoundarySegments(
    childResult.collection,
    layerName,
    BOUNDARY_DEDUPLICATION.zoom,
  )
  const parentIndexes = []
  for (let zoom = baseMinZoom; zoom <= BOUNDARY_DEDUPLICATION.zoom; zoom += 1) {
    const index = createBoundarySpatialIndex()
    for (const parentResult of parentResults) {
      const parentLayerName = parentResult.report?.hierarchyOwnership?.layerName ?? 'country'
      for (const record of collectBoundarySegments(
        parentResult.collection,
        parentLayerName,
        zoom,
      )) {
        addBoundarySpatialRecord(index, record)
      }
    }
    parentIndexes.push({ zoom, index })
  }
  const segmentsByFeature = new Map()
  const report = {
    auditZoom: BOUNDARY_DEDUPLICATION.zoom,
    inputSegmentCount: childResult.report.inputSegmentCount,
    keptSegmentCount: 0,
    removedWithinExact: childResult.report.removedWithinExact,
    removedWithinNear: 0,
    removedAgainst: {},
    removedByCountry: { ...childResult.report.removedByCountry },
    samples: [],
  }
  let parentOwnedThroughMaxZoomArcCount = 0
  let topologyNodedParentOwnedSubarcCount = 0
  let topologyNodedPartialArcCount = 0
  for (const sourceRecord of childRecords) {
    const transfer = transferBoundarySubarcsToParent(sourceRecord, parentIndexes)
    const keptSegments = transfer.records.map((record) => [record.start, record.end])
    if (transfer.intervalCount) {
      topologyNodedParentOwnedSubarcCount += transfer.intervalCount
      if (keptSegments.length) topologyNodedPartialArcCount += 1
      const firstMatch = transfer.matches[0]
      incrementBoundaryRemoval(
        report,
        sourceRecord,
        firstMatch?.kind ?? 'near',
        firstMatch?.record.layerName ?? 'parent',
        firstMatch?.record,
      )
    }
    if (!keptSegments.length) {
      parentOwnedThroughMaxZoomArcCount += 1
      continue
    }
    const group = segmentsByFeature.get(sourceRecord.featureIndex) ?? {
      featureIndex: sourceRecord.featureIndex,
      segments: [],
    }
    group.segments.push(...keptSegments)
    segmentsByFeature.set(sourceRecord.featureIndex, group)
    report.keptSegmentCount += keptSegments.length
  }
  const features = [...segmentsByFeature.values()].map((group) => {
    const sourceFeature = childResult.collection.features[group.featureIndex]
    const lines = stitchBoundarySegments(group.segments)
    return {
      ...sourceFeature,
      tippecanoe: { ...(sourceFeature.tippecanoe ?? {}), minzoom: baseMinZoom },
      properties: {
        ...(sourceFeature.properties ?? {}),
        boundary_min_zoom: baseMinZoom,
      },
      geometry: {
        type: lines.length === 1 ? 'LineString' : 'MultiLineString',
        coordinates: lines.length === 1 ? lines[0] : lines,
      },
    }
  })
  return {
    collection: { type: 'FeatureCollection', features },
    report: {
      ...report,
      hierarchyOwnership: {
        layerName,
        ownerLayers: parentResults.map(
          (parentResult) => parentResult.report?.hierarchyOwnership?.layerName ?? 'country',
        ),
        baseMinZoom,
        deferredArcCount: 0,
        parentOwnedThroughMaxZoomArcCount,
        topologyNodedParentOwnedSubarcCount,
        topologyNodedPartialArcCount,
        reassignedExactArcCount: Object.values(report.removedAgainst).reduce(
          (sum, counts) => sum + counts.exact,
          0,
        ),
        reassignedNearArcCount: Object.values(report.removedAgainst).reduce(
          (sum, counts) => sum + counts.near,
          0,
        ),
        policy: 'topology-noded-subarc-transfer-to-visible-parent',
      },
      partialNearSegmentRemoval: false,
    },
  }
}

function transferBoundarySubarcsToParent(sourceRecord, parentIndexes) {
  let records = [sourceRecord]
  const matches = []
  let intervalCount = 0
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false
    const next = []
    for (const record of records) {
      const ownershipByZoom = parentIndexes.map(({ zoom, index }) =>
        boundaryParentOwnedIntervals(boundaryRecordAtZoom(record, zoom), index, 1.75, 1),
      )
      const ownership = {
        intervals: mergeBoundaryIntervals(
          ownershipByZoom.flatMap((candidate) => candidate.intervals),
        ),
        matches: ownershipByZoom.flatMap((candidate) => candidate.matches),
      }
      if (!ownership.intervals.length) {
        next.push(record)
        continue
      }
      changed = true
      intervalCount += ownership.intervals.length
      matches.push(...ownership.matches)
      for (const [start, end] of subtractBoundaryIntervals(record, ownership.intervals)) {
        next.push(
          boundarySubrecord(
            record,
            snapBoundaryCoordinateToParents(start, record, parentIndexes),
            snapBoundaryCoordinateToParents(end, record, parentIndexes),
          ),
        )
      }
    }
    records = next
    if (!changed || !records.length) break
  }
  return { records, matches, intervalCount }
}

function snapBoundaryCoordinateToParents(coordinate, sourceRecord, parentIndexes) {
  let best = null
  for (const { zoom, index } of parentIndexes) {
    const pixel = boundaryWorldPixel(coordinate, zoom)
    const probe = {
      ...boundaryRecordAtZoom(sourceRecord, zoom),
      pixelStart: pixel,
      pixelEnd: pixel,
      pixelLength: 0,
    }
    for (const candidate of queryBoundarySpatialIndex(index, probe, 1.75)) {
      if (!boundaryRecordsCanRepresentSameLine(sourceRecord, candidate)) continue
      const vector = subtractPoint(candidate.pixelEnd, candidate.pixelStart)
      const lengthSquared = dotPoint(vector, vector)
      if (!lengthSquared) continue
      const ratio = Math.max(
        0,
        Math.min(1, dotPoint(subtractPoint(pixel, candidate.pixelStart), vector) / lengthSquared),
      )
      const projected = [
        candidate.pixelStart[0] + vector[0] * ratio,
        candidate.pixelStart[1] + vector[1] * ratio,
      ]
      const distance = pointDistance(pixel, projected)
      if (distance > 1.75 || (best && best.normalizedDistance <= distance / 1.75)) continue
      best = {
        normalizedDistance: distance / 1.75,
        coordinate: interpolateBoundaryCoordinate(candidate.start, candidate.end, ratio),
      }
    }
  }
  return best?.coordinate ?? coordinate
}

function boundaryRecordAtZoom(record, zoom) {
  const pixelStart = boundaryWorldPixel(record.start, zoom)
  const pixelEnd = boundaryWorldPixel(record.end, zoom)
  return {
    ...record,
    pixelStart,
    pixelEnd,
    pixelLength: pointDistance(pixelStart, pixelEnd),
  }
}

function boundarySubrecord(source, start, end) {
  const pixelStart = boundaryWorldPixel(start)
  const pixelEnd = boundaryWorldPixel(end)
  return {
    ...source,
    start,
    end,
    pixelStart,
    pixelEnd,
    pixelLength: pointDistance(pixelStart, pixelEnd),
    exactKey: boundarySegmentKey(start, end),
  }
}

function boundaryParentOwnedIntervals(
  record,
  parentIndex,
  tolerancePx = BOUNDARY_DEDUPLICATION.tolerancePx,
  minOverlapPx = BOUNDARY_DEDUPLICATION.minOverlapPx,
) {
  const intervals = []
  const matches = []
  for (const candidate of queryBoundarySpatialIndex(parentIndex, record, tolerancePx)) {
    if (record.exactKey === candidate.exactKey) {
      intervals.push([0, 1])
      matches.push({ kind: 'exact', record: candidate })
      continue
    }
    if (!boundaryRecordsCanRepresentSameLine(record, candidate)) continue
    if (!boundarySegmentsAreNearCoincident(record, candidate, tolerancePx, minOverlapPx, 0.7)) {
      continue
    }
    const interval = boundaryCoincidentIntervalOnRecord(record, candidate, minOverlapPx)
    if (!interval) continue
    intervals.push(interval)
    matches.push({ kind: 'near', record: candidate })
  }
  return { intervals: mergeBoundaryIntervals(intervals), matches }
}

function boundaryCoincidentIntervalOnRecord(
  record,
  candidate,
  minOverlapPx = BOUNDARY_DEDUPLICATION.minOverlapPx,
) {
  const vector = subtractPoint(record.pixelEnd, record.pixelStart)
  const length = record.pixelLength
  if (!length) return null
  const axis = [vector[0] / length, vector[1] / length]
  const projections = [candidate.pixelStart, candidate.pixelEnd].map((point) =>
    dotPoint(subtractPoint(point, record.pixelStart), axis),
  )
  const start = Math.max(0, Math.min(...projections))
  const end = Math.min(length, Math.max(...projections))
  return end - start >= minOverlapPx ? [start / length, end / length] : null
}

function mergeBoundaryIntervals(intervals) {
  const sorted = intervals
    .map(([start, end]) => [Math.max(0, start), Math.min(1, end)])
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1])
  const merged = []
  for (const interval of sorted) {
    const previous = merged.at(-1)
    if (!previous || interval[0] > previous[1] + 1e-9) merged.push([...interval])
    else previous[1] = Math.max(previous[1], interval[1])
  }
  return merged
}

function subtractBoundaryIntervals(record, intervals) {
  if (!intervals.length) return [[record.start, record.end]]
  const retained = []
  let cursor = 0
  for (const [start, end] of intervals) {
    if (start > cursor + 1e-9) retained.push([cursor, start])
    cursor = Math.max(cursor, end)
  }
  if (cursor < 1 - 1e-9) retained.push([cursor, 1])
  return retained
    .map(([start, end]) => [
      interpolateBoundaryCoordinate(record.start, record.end, start),
      interpolateBoundaryCoordinate(record.start, record.end, end),
    ])
    .filter(([start, end]) => {
      const length = pointDistance(boundaryWorldPixel(start), boundaryWorldPixel(end))
      return Number.isFinite(length) && length >= BOUNDARY_DEDUPLICATION.minOverlapPx
    })
}

function interpolateBoundaryCoordinate(start, end, ratio) {
  return [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio]
}

function deduplicateExactBoundaryCollection(layerName, collection) {
  const records = collectBoundarySegments(collection, layerName, BOUNDARY_DEDUPLICATION.zoom)
  const seen = new Set()
  const keptByFeature = new Map()
  const removedByCountry = {}
  let removedWithinExact = 0
  for (const record of records) {
    if (seen.has(record.exactKey)) {
      removedWithinExact += 1
      const country = record.countryKey || '__unknown__'
      const counts = removedByCountry[country] ?? { exact: 0, near: 0 }
      counts.exact += 1
      removedByCountry[country] = counts
      continue
    }
    seen.add(record.exactKey)
    const lines = keptByFeature.get(record.featureIndex) ?? []
    lines.push([record.start, record.end])
    keptByFeature.set(record.featureIndex, lines)
  }
  const features = [...keptByFeature.entries()].map(([featureIndex, segments]) => {
    const feature = collection.features[featureIndex]
    const lines = stitchBoundarySegments(segments)
    return {
      ...feature,
      geometry: {
        type: lines.length === 1 ? 'LineString' : 'MultiLineString',
        coordinates: lines.length === 1 ? lines[0] : lines,
      },
    }
  })
  return {
    collection: { type: 'FeatureCollection', features },
    report: {
      auditZooms: [BOUNDARY_DEDUPLICATION.zoom],
      inputSegmentCount: records.length,
      keptSegmentCount: records.length - removedWithinExact,
      removedWithinExact,
      removedWithinNear: 0,
      removedAgainst: {},
      removedByCountry,
      partialNearSegmentRemoval: false,
    },
  }
}

function cleanBoundaryCollectionAtZooms(layerName, collection, higherPrioritySources, zooms) {
  const stages = []
  let current = collection
  for (const zoom of zooms) {
    const result = cleanBoundaryCollection(layerName, current, higherPrioritySources, zoom)
    current = result.collection
    stages.push(result.report)
  }
  const removedAgainst = {}
  const removedByCountry = {}
  for (const stage of stages) {
    for (const [name, counts] of Object.entries(stage.removedAgainst)) {
      const target = removedAgainst[name] ?? { exact: 0, near: 0 }
      target.exact += counts.exact
      target.near += counts.near
      removedAgainst[name] = target
    }
    for (const [country, counts] of Object.entries(stage.removedByCountry)) {
      const target = removedByCountry[country] ?? { exact: 0, near: 0 }
      target.exact += counts.exact
      target.near += counts.near
      removedByCountry[country] = target
    }
  }
  return {
    collection: current,
    report: {
      auditZooms: zooms,
      stages,
      inputSegmentCount: stages[0]?.inputSegmentCount ?? 0,
      keptSegmentCount: stages.at(-1)?.keptSegmentCount ?? 0,
      removedWithinExact: stages.reduce((sum, stage) => sum + stage.removedWithinExact, 0),
      removedWithinNear: stages.reduce((sum, stage) => sum + stage.removedWithinNear, 0),
      removedAgainst,
      removedByCountry,
    },
  }
}

function cleanBoundaryCollection(
  layerName,
  collection,
  higherPrioritySources,
  auditZoom = 8,
  options = {},
) {
  const records = collectBoundarySegments(collection, layerName, auditZoom)
  const higherPriorityIndex = createBoundarySpatialIndex()
  for (const source of higherPrioritySources) {
    for (const record of collectBoundarySegments(source.collection, source.name, auditZoom)) {
      addBoundarySpatialRecord(higherPriorityIndex, record)
    }
  }
  const withinIndex = createBoundarySpatialIndex()
  const removed = new Set()
  const report = {
    auditZoom,
    inputSegmentCount: records.length,
    keptSegmentCount: 0,
    removedWithinExact: 0,
    removedWithinNear: 0,
    removedAgainst: {},
    removedByCountry: {},
    legalParentJunctionNearCount: 0,
    samples: [],
  }
  const longestFirst = [...records].sort(
    (left, right) => right.pixelLength - left.pixelLength || left.id - right.id,
  )
  for (const record of longestFirst) {
    const hasLegalParentJunction =
      options.ignoreLegalParentJunctions &&
      boundaryRecordHasLegalParentJunction(record, higherPriorityIndex)
    if (hasLegalParentJunction) report.legalParentJunctionNearCount += 1
    const higherMatch = hasLegalParentJunction
      ? null
      : findBoundaryCoincidence(record, higherPriorityIndex, (candidate) =>
          boundaryRecordsCanRepresentSameLine(record, candidate),
        )
    if (higherMatch) {
      removed.add(record.id)
      incrementBoundaryRemoval(
        report,
        record,
        higherMatch.kind,
        higherMatch.record.layerName,
        higherMatch.record,
      )
      continue
    }
    const withinMatch = options.skipWithin
      ? null
      : findBoundaryCoincidence(
          record,
          withinIndex,
          (candidate) =>
            candidate.exactKey === record.exactKey ||
            (candidate.featureIndex !== record.featureIndex &&
              candidate.semanticPair === record.semanticPair),
        )
    if (withinMatch) {
      removed.add(record.id)
      incrementBoundaryRemoval(report, record, withinMatch.kind, 'within', withinMatch.record)
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
    const stitchedLines = stitchBoundarySegments(lines)
    features.push({
      ...feature,
      geometry: {
        type: stitchedLines.length === 1 ? 'LineString' : 'MultiLineString',
        coordinates: stitchedLines.length === 1 ? stitchedLines[0] : stitchedLines,
      },
    })
  }
  report.keptSegmentCount = records.length - removed.size
  return { collection: { type: 'FeatureCollection', features }, report }
}

function stitchBoundarySegments(segments) {
  const endpointIndex = new Map()
  const entries = segments.map(([start, end], index) => {
    const startKey = boundaryCoordinateKey(start)
    const endKey = boundaryCoordinateKey(end)
    for (const key of [startKey, endKey]) {
      const values = endpointIndex.get(key) ?? []
      values.push(index)
      endpointIndex.set(key, values)
    }
    return { start, end, startKey, endKey }
  })
  const remaining = new Set(entries.map((_, index) => index))
  const lines = []
  while (remaining.size) {
    const seedIndex =
      [...remaining].find((index) => {
        const entry = entries[index]
        return (
          (endpointIndex.get(entry.startKey)?.length ?? 0) !== 2 ||
          (endpointIndex.get(entry.endKey)?.length ?? 0) !== 2
        )
      }) ?? remaining.values().next().value
    const seed = entries[seedIndex]
    const startKey =
      (endpointIndex.get(seed.startKey)?.length ?? 0) !== 2 ? seed.startKey : seed.endKey
    const line = []
    let currentKey = startKey
    while (true) {
      const nextIndex = (endpointIndex.get(currentKey) ?? []).find((index) => remaining.has(index))
      if (nextIndex == null) break
      const entry = entries[nextIndex]
      remaining.delete(nextIndex)
      const forward = entry.startKey === currentKey
      const currentPoint = forward ? entry.start : entry.end
      const nextPoint = forward ? entry.end : entry.start
      if (!line.length) line.push(currentPoint)
      line.push(nextPoint)
      currentKey = forward ? entry.endKey : entry.startKey
    }
    if (line.length >= 2) lines.push(line)
  }
  return lines
}

function boundaryRecordsCanRepresentSameLine(left, right) {
  if (left.layerName === right.layerName) {
    return (
      left.exactKey === right.exactKey ||
      (left.featureIndex !== right.featureIndex && left.semanticPair === right.semanticPair)
    )
  }
  const countryRecord =
    left.layerName === 'country' ? left : right.layerName === 'country' ? right : null
  if (countryRecord) {
    const childRecord = countryRecord === left ? right : left
    return boundaryOwnerKeys(countryRecord.semanticPair).includes(childRecord.countryKey)
  }
  return Boolean(left.countryKey && left.countryKey === right.countryKey)
}

function boundaryOwnerKeys(semanticPair) {
  return String(semanticPair ?? '')
    .split('|~|')
    .map((value) => value.trim())
    .filter(Boolean)
}

function incrementBoundaryRemoval(report, record, kind, against, matchedRecord = null) {
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
  if (report.samples.length < 80) {
    report.samples.push({
      kind,
      against,
      layerName: record.layerName,
      countryKey: record.countryKey,
      semanticPair: record.semanticPair,
      start: record.start,
      end: record.end,
      pixelLength: roundBoundaryMetric(record.pixelLength),
      matchedLayerName: matchedRecord?.layerName ?? '',
      matchedCountryKey: matchedRecord?.countryKey ?? '',
      matchedSemanticPair: matchedRecord?.semanticPair ?? '',
      matchedStart: matchedRecord?.start ?? null,
      matchedEnd: matchedRecord?.end ?? null,
      matchedPixelLength: roundBoundaryMetric(matchedRecord?.pixelLength),
    })
  }
}

function roundBoundaryMetric(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : null
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
  return Object.fromEntries(
    Object.entries(merged).sort(([left], [right]) => left.localeCompare(right)),
  )
}

function collectBoundarySegments(collection, layerName, auditZoom = 8) {
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
        const pixelStart = boundaryWorldPixel(start, auditZoom)
        const pixelEnd = boundaryWorldPixel(end, auditZoom)
        const pixelLength = pointDistance(pixelStart, pixelEnd)
        if (!Number.isFinite(pixelLength) || pixelLength <= 1e-6) continue
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
          parentGeoKey: String(properties.parent_geo_key ?? ''),
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

function boundaryWorldPixel([longitude, latitude], zoom = BOUNDARY_DEDUPLICATION.zoom) {
  const size = BOUNDARY_DEDUPLICATION.tileSize * 2 ** zoom
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

function queryBoundarySpatialIndex(
  index,
  record,
  tolerancePx = BOUNDARY_DEDUPLICATION.tolerancePx,
) {
  const ids = new Set()
  for (const key of boundaryGridKeys(record, tolerancePx)) {
    for (const id of index.cells.get(key) ?? []) ids.add(id)
  }
  return [...ids].map((id) => index.records[id])
}

function boundaryGridKeys(record, tolerance = BOUNDARY_DEDUPLICATION.tolerancePx) {
  const cellSize = BOUNDARY_DEDUPLICATION.gridSizePx
  const minX = Math.floor(
    (Math.min(record.pixelStart[0], record.pixelEnd[0]) - tolerance) / cellSize,
  )
  const maxX = Math.floor(
    (Math.max(record.pixelStart[0], record.pixelEnd[0]) + tolerance) / cellSize,
  )
  const minY = Math.floor(
    (Math.min(record.pixelStart[1], record.pixelEnd[1]) - tolerance) / cellSize,
  )
  const maxY = Math.floor(
    (Math.max(record.pixelStart[1], record.pixelEnd[1]) + tolerance) / cellSize,
  )
  const keys = []
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) keys.push(`${x}:${y}`)
  }
  return keys
}

function findBoundaryCoincidence(
  record,
  index,
  predicate = () => true,
  tolerancePx = BOUNDARY_DEDUPLICATION.tolerancePx,
  minOverlapPx = BOUNDARY_DEDUPLICATION.minOverlapPx,
  minCandidateOverlapRatio = BOUNDARY_DEDUPLICATION.minCandidateOverlapRatio,
  acceptMatch = () => true,
) {
  for (const candidate of queryBoundarySpatialIndex(index, record, tolerancePx)) {
    if (!predicate(candidate)) continue
    if (record.exactKey === candidate.exactKey) {
      const match = { kind: 'exact', record: candidate }
      if (acceptMatch(match)) return match
      continue
    }
    if (
      boundarySegmentsAreNearCoincident(
        record,
        candidate,
        tolerancePx,
        minOverlapPx,
        minCandidateOverlapRatio,
      )
    ) {
      const match = { kind: 'near', record: candidate }
      if (acceptMatch(match)) return match
    }
  }
  return null
}

function boundaryNearMatchIsLegalParentJunction(child, match) {
  if (match.kind !== 'near') return false
  const parent = match.record
  const expectedParentLayer =
    child.layerName === 'admin2' ? 'admin1' : child.layerName === 'chinaCity' ? 'chinaProvince' : ''
  if (!expectedParentLayer || parent.layerName !== expectedParentLayer) return false
  if (!child.parentGeoKey || !boundaryOwnerKeys(parent.semanticPair).includes(child.parentGeoKey)) {
    return false
  }
  const tolerance = BOUNDARY_DEDUPLICATION.tolerancePx
  const startConnected =
    pointToSegmentDistance(child.pixelStart, parent.pixelStart, parent.pixelEnd) <= tolerance
  const endConnected =
    pointToSegmentDistance(child.pixelEnd, parent.pixelStart, parent.pixelEnd) <= tolerance
  // A child edge may meet its visible parent at one shallow-angle endpoint.
  // Two connected endpoints mean that the whole child arc is parent-owned.
  return startConnected !== endConnected
}

function boundaryRecordHasLegalParentJunction(record, parentIndex) {
  for (const candidate of queryBoundarySpatialIndex(
    parentIndex,
    record,
    BOUNDARY_DEDUPLICATION.tolerancePx,
  )) {
    if (!boundaryRecordsCanRepresentSameLine(record, candidate)) continue
    if (record.exactKey === candidate.exactKey) continue
    if (
      !boundarySegmentsAreNearCoincident(record, candidate) ||
      !boundaryNearMatchIsLegalParentJunction(record, { kind: 'near', record: candidate })
    ) {
      continue
    }
    return true
  }
  return false
}

function boundarySegmentsAreNearCoincident(
  left,
  right,
  tolerancePx = BOUNDARY_DEDUPLICATION.tolerancePx,
  minOverlapPx = BOUNDARY_DEDUPLICATION.minOverlapPx,
  minCandidateOverlapRatio = BOUNDARY_DEDUPLICATION.minCandidateOverlapRatio,
) {
  const leftVector = subtractPoint(left.pixelEnd, left.pixelStart)
  const rightVector = subtractPoint(right.pixelEnd, right.pixelStart)
  const leftLength = left.pixelLength
  const rightLength = right.pixelLength
  const cosine = Math.abs(dotPoint(leftVector, rightVector) / (leftLength * rightLength))
  const minimumCosine = Math.cos((BOUNDARY_DEDUPLICATION.maxAngleDegrees * Math.PI) / 180)
  if (cosine < minimumCosine) return false
  const reference = leftLength >= rightLength ? left : right
  const candidate = reference === left ? right : left
  const referenceVector = subtractPoint(reference.pixelEnd, reference.pixelStart)
  const referenceLength = Math.hypot(referenceVector[0], referenceVector[1])
  const axis = [referenceVector[0] / referenceLength, referenceVector[1] / referenceLength]
  const candidateStart = subtractPoint(candidate.pixelStart, reference.pixelStart)
  const candidateEnd = subtractPoint(candidate.pixelEnd, reference.pixelStart)
  const candidateStartProjection = dotPoint(candidateStart, axis)
  const candidateEndProjection = dotPoint(candidateEnd, axis)
  const overlapStart = Math.max(0, Math.min(candidateStartProjection, candidateEndProjection))
  const overlapEnd = Math.min(
    referenceLength,
    Math.max(candidateStartProjection, candidateEndProjection),
  )
  const overlap = Math.max(0, overlapEnd - overlapStart)
  if (overlap < minOverlapPx) return false
  if (overlap / Math.min(leftLength, rightLength) < minCandidateOverlapRatio) {
    return false
  }
  const overlapStartPoint = [
    reference.pixelStart[0] + axis[0] * overlapStart,
    reference.pixelStart[1] + axis[1] * overlapStart,
  ]
  const overlapEndPoint = [
    reference.pixelStart[0] + axis[0] * overlapEnd,
    reference.pixelStart[1] + axis[1] * overlapEnd,
  ]
  return (
    pointToInfiniteLineDistance(overlapStartPoint, candidate.pixelStart, candidate.pixelEnd) <=
      tolerancePx &&
    pointToInfiniteLineDistance(overlapEndPoint, candidate.pixelStart, candidate.pixelEnd) <=
      tolerancePx
  )
}

function subtractPoint(left, right) {
  return [left[0] - right[0], left[1] - right[1]]
}

function dotPoint(left, right) {
  return left[0] * right[0] + left[1] * right[1]
}

function pointDistance(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1])
}

function pointToInfiniteLineDistance(point, lineStart, lineEnd) {
  const vector = subtractPoint(lineEnd, lineStart)
  const length = Math.hypot(vector[0], vector[1])
  if (!length) return Number.POSITIVE_INFINITY
  return (
    Math.abs(vector[0] * (lineStart[1] - point[1]) - (lineStart[0] - point[0]) * vector[1]) / length
  )
}

function auditTolerantBoundaryOverlaps(collections) {
  const names = Object.keys(collections)
  const layers = {}
  let totalDuplicateLikeSegmentCount = 0
  for (const name of names) {
    const within = cleanBoundaryCollection(name, collections[name], []).report
    const exact = within.removedWithinExact
    const near = within.removedWithinNear
    layers[name] = { exact, near, total: exact + near, samples: within.samples }
    totalDuplicateLikeSegmentCount += exact + near
  }
  const pairs = []
  for (let leftIndex = 0; leftIndex < names.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < names.length; rightIndex += 1) {
      const left = names[leftIndex]
      const right = names[rightIndex]
      if (!renderedBoundaryRangesOverlap(left, right)) {
        pairs.push({
          left,
          right,
          exact: 0,
          near: 0,
          total: 0,
          simultaneouslyVisible: false,
          samples: [],
        })
        continue
      }
      const report = cleanBoundaryCollection(
        right,
        collections[right],
        [{ name: left, collection: collections[left] }],
        BOUNDARY_DEDUPLICATION.zoom,
        { ignoreLegalParentJunctions: true },
      ).report
      const against = report.removedAgainst[left] ?? { exact: 0, near: 0 }
      const total = against.exact + against.near
      pairs.push({
        left,
        right,
        exact: against.exact,
        near: against.near,
        total,
        legalParentJunctionNearCount: report.legalParentJunctionNearCount,
        simultaneouslyVisible: true,
        samples: report.samples.filter((sample) => sample.against === left),
      })
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

function renderedBoundaryRangesOverlap(left, right) {
  const leftRange = RENDERED_BOUNDARY_LAYER_RANGES[left]
  const rightRange = RENDERED_BOUNDARY_LAYER_RANGES[right]
  if (!leftRange || !rightRange) return true
  return Math.max(leftRange[0], rightRange[0]) <= Math.min(leftRange[1], rightRange[1])
}

function buildBoundaryLegalEndpointManifest(collections) {
  const sourceLayers = {
    preview_presentation_admin1_boundaries: {
      name: 'admin1',
      collection: collections.admin1,
    },
    preview_presentation_admin2_boundaries: {
      name: 'admin2',
      collection: collections.admin2,
    },
    preview_china_province_boundaries: {
      name: 'chinaProvince',
      collection: collections.chinaProvince,
    },
    preview_china_city_boundaries: {
      name: 'chinaCity',
      collection: collections.chinaCity,
    },
  }
  const zooms = {}
  for (let zoom = 0; zoom <= 8; zoom += 1) {
    const layers = {}
    for (const [layerName, source] of Object.entries(sourceLayers)) {
      const range = RENDERED_BOUNDARY_LAYER_RANGES[source.name]
      if (!range || zoom < range[0] || zoom > range[1]) continue
      const endpoints = new Map()
      for (const feature of source.collection.features ?? []) {
        if (!sourceBoundaryFeatureVisible(layerName, feature, zoom)) continue
        for (const line of lineCoordinates(feature.geometry)) {
          for (let index = 1; index < line.length; index += 1) {
            for (const point of [line[index - 1], line[index]]) {
              const key = boundaryCoordinateKey(point)
              if (!key) continue
              const entry = endpoints.get(key) ?? { degree: 0, point }
              entry.degree += 1
              endpoints.set(key, entry)
            }
          }
        }
      }
      layers[layerName] = [...endpoints.values()]
        .filter((entry) => entry.degree === 1)
        .map((entry) => entry.point)
    }
    zooms[zoom] = layers
  }
  return {
    policy: 'source-topology-degree-one-endpoints-only',
    coordinatePrecision: 5,
    zooms,
  }
}

function sourceBoundaryFeatureVisible(layerName, feature, zoom) {
  const minzoom = Number(feature.tippecanoe?.minzoom ?? 0)
  const maxzoom = Number(feature.tippecanoe?.maxzoom ?? 8)
  if (zoom < minzoom || zoom > maxzoom) return false
  if (layerName === 'preview_presentation_admin1_boundaries') {
    const starts = {
      adm1_le25: 3.85,
      adm1_26_80: 4.25,
      adm1_81_160: 4.75,
      adm1_gt160: 5.25,
      china: 3.85,
    }
    return zoom >= Number(starts[feature.properties?.detail_profile] ?? 99)
  }
  return true
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
      if (!renderedBoundaryRangesOverlap(left, right)) {
        pairs.push({ left, right, coincidentSegmentCount: 0, simultaneouslyVisible: false })
        continue
      }
      const coincidentSegmentCount = setIntersectionSize(segmentSets[left], segmentSets[right])
      totalCoincidentSegmentCount += coincidentSegmentCount
      pairs.push({ left, right, coincidentSegmentCount, simultaneouslyVisible: true })
    }
  }
  return {
    precision: 5,
    segmentCounts: Object.fromEntries(names.map((name) => [name, segmentSets[name].size])),
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

function enrichPresentationRegionIndex(baseIndex, collections) {
  const baseRegions = (baseIndex.regions ?? [])
    .filter((entry) => entry.presentation_index !== true)
    .map((entry) => ({ ...entry }))
  const regionByKey = new Map(
    baseRegions.map((entry) => [`${entry.level}|${entry.geo_key}`, entry]),
  )
  const admin1NameIndex = new Map()
  for (const entry of baseRegions.filter((candidate) => candidate.level === 'admin1')) {
    for (const alias of indexSearchAliases(entry)) {
      const key = `${entry.country_key}|${normalizeAdministrativeIndexName(alias)}`
      if (key.endsWith('|')) continue
      const values = admin1NameIndex.get(key) ?? new Set()
      values.add(entry)
      admin1NameIndex.set(key, values)
    }
  }
  const labelsByKey = new Map(
    [
      ...(collections.admin1Labels?.features ?? []),
      ...(collections.admin2Labels?.features ?? []),
    ].map((feature) => [String(feature.properties?.geo_key ?? ''), feature]),
  )
  let enrichedAdmin1Count = 0
  let addedAdmin2Count = 0
  for (const [presentationLevel, polygons] of [
    ['adm1', collections.admin1Polygons],
    ['adm2', collections.admin2Polygons],
  ]) {
    for (const feature of polygons?.features ?? []) {
      const props = feature.properties ?? {}
      const geoKey = String(props.geo_key ?? '')
      const countryKey = String(props.country_key ?? '')
      if (!geoKey || !countryKey) continue
      const level = presentationLevel === 'adm2' ? 'city' : 'admin1'
      const exact = regionByKey.get(`${level}|${geoKey}`)
      let existing = exact
      if (!existing && level === 'admin1') {
        const candidates = new Set()
        for (const alias of [props.display_name_en, props.display_name_local, props.display_name]) {
          const normalized = normalizeAdministrativeIndexName(alias)
          if (!normalized) continue
          for (const candidate of admin1NameIndex.get(`${countryKey}|${normalized}`) ?? []) {
            candidates.add(candidate)
          }
        }
        if (candidates.size === 1) existing = [...candidates][0]
      }
      const bbox = geometryBbox(feature.geometry)
      if (!bbox) continue
      const labelFeature = labelsByKey.get(geoKey)
      const labelPoint =
        labelFeature?.geometry?.coordinates ?? representativePoint(feature.geometry)
      const displayNameZh = props.name_zh_verified
        ? cleanPresentationLabel(props.display_name_zh)
        : ''
      const displayNameEn = cleanPresentationLabel(props.display_name_en)
      const displayNameLocal = cleanPresentationLabel(props.display_name_local)
      const searchAliases = uniqueCleanIndexLabels([
        displayNameZh,
        displayNameEn,
        displayNameLocal,
        props.display_name,
        props.source_geo_key,
      ])
      const names = {
        display_name: displayNameZh || displayNameLocal || displayNameEn,
        display_name_zh: displayNameZh,
        display_name_en: displayNameEn,
        display_name_local: displayNameLocal,
        name_zh_source: String(props.name_zh_source ?? ''),
        name_zh_reference_key: String(props.name_zh_reference_key ?? ''),
        search_aliases: uniqueCleanIndexLabels([
          ...(existing?.search_aliases ?? []),
          ...searchAliases,
        ]),
        name: displayNameEn || displayNameLocal,
      }
      if (existing) {
        Object.assign(existing, names)
        if (level === 'city') {
          existing.boundary_min_zoom = PRESENTATION_ADMIN2_BOUNDARY_ZOOM
          existing.label_min_zoom = presentationLabelMinZoom(
            PRESENTATION_ADMIN2_ZOOM[String(props.detail_profile ?? '')],
          )
        }
        if (level === 'admin1') enrichedAdmin1Count += 1
        continue
      }
      const detailProfile = String(props.detail_profile ?? '')
      const entry = {
        level,
        geo_key: geoKey,
        parent_geo_key: String(props.parent_geo_key ?? ''),
        country_key: countryKey,
        ...names,
        center: labelPoint,
        label_point: labelPoint,
        area: Math.max(0.000001, Number(geometryArea(feature.geometry).toFixed(6))),
        bbox: bbox.map((value) => Number(value.toFixed(6))),
        boundary_min_zoom: PRESENTATION_ADMIN2_BOUNDARY_ZOOM,
        label_min_zoom: presentationLabelMinZoom(PRESENTATION_ADMIN2_ZOOM[detailProfile]),
        source_level: String(props.source_level ?? ''),
        presentation_index: true,
      }
      baseRegions.push(entry)
      regionByKey.set(`${level}|${geoKey}`, entry)
      if (level === 'city') addedAdmin2Count += 1
    }
  }
  const admin2ByCountry = new Map()
  for (const entry of baseRegions.filter((candidate) => candidate.level === 'city')) {
    admin2ByCountry.set(entry.country_key, (admin2ByCountry.get(entry.country_key) ?? 0) + 1)
  }
  return {
    ...baseIndex,
    generatedAt: new Date().toISOString(),
    regions: baseRegions,
    presentation: {
      enrichedAdmin1Count,
      addedAdmin2Count,
      admin2Count: [...admin2ByCountry.values()].reduce((sum, count) => sum + count, 0),
      brazilAdmin2Count: admin2ByCountry.get('brazil') ?? 0,
      indiaAdmin2Count: admin2ByCountry.get('india') ?? 0,
      admin2BoundaryMinZoom: PRESENTATION_ADMIN2_BOUNDARY_ZOOM,
      corruptVisibleLabelCount: baseRegions.filter(
        (entry) => entry.display_name && !cleanPresentationLabel(entry.display_name),
      ).length,
      hiddenLabelCount: baseRegions.filter((entry) => !cleanPresentationLabel(entry.display_name))
        .length,
    },
  }
}

function validateEnrichedRegionIndex(index) {
  const presentation = index.presentation ?? {}
  if (presentation.brazilAdmin2Count < 5569) {
    throw new Error(`Brazil ADM2 coverage is below 5,569: ${presentation.brazilAdmin2Count}`)
  }
  if (presentation.indiaAdmin2Count < 735) {
    throw new Error(`India ADM2 coverage is below 735: ${presentation.indiaAdmin2Count}`)
  }
  if (presentation.corruptVisibleLabelCount !== 0) {
    throw new Error(
      `Region index contains ${presentation.corruptVisibleLabelCount} corrupt visible labels`,
    )
  }
  const invalidAdm2Zooms = (index.regions ?? []).filter(
    (entry) =>
      entry.level === 'city' &&
      (entry.boundary_min_zoom !== PRESENTATION_ADMIN2_BOUNDARY_ZOOM ||
        !Number.isFinite(entry.label_min_zoom) ||
        entry.label_min_zoom < entry.boundary_min_zoom),
  )
  if (invalidAdm2Zooms.length) {
    throw new Error(`Region index contains ${invalidAdm2Zooms.length} invalid ADM2 zoom policies`)
  }
}

function indexSearchAliases(entry) {
  return uniqueCleanIndexLabels([
    entry.display_name,
    entry.display_name_zh,
    entry.display_name_en,
    entry.display_name_local,
    entry.name,
    ...(entry.search_aliases ?? []),
  ])
}

function uniqueCleanIndexLabels(values) {
  return [...new Set(values.map(cleanPresentationLabel).filter(Boolean))]
}

function normalizeAdministrativeIndexName(value) {
  return cleanPresentationLabel(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ')
    .replace(
      /\b(?:autonomous community|autonomous region|governorate|governate|voivodeship|prefecture|department|departement|territory|province|republic|district|oblast|region|county|state|krai)\s*$/,
      '',
    )
    .replace(/\s+/g, '')
}

function validateBoundarySourceManifest(manifest) {
  if (manifest?.schema_version !== 1) {
    throw new Error('Boundary source manifest has an unsupported schema version')
  }
  for (const source of manifest.generated_geometry_sources ?? []) {
    if (
      !String(source.id ?? '').trim() ||
      !/^https:\/\//.test(String(source.url ?? '')) ||
      !String(source.license ?? '').trim() ||
      !/^[a-f0-9]{64}$/.test(String(source.sha256 ?? ''))
    ) {
      throw new Error(`Boundary source manifest entry is incomplete: ${source.id ?? 'unknown'}`)
    }
  }
  for (const reference of manifest.validation_references ?? []) {
    if (!/^https:\/\//.test(String(reference.url ?? '')) || reference.ingested !== false) {
      throw new Error(
        `Validation-only source must use HTTPS and ingested=false: ${reference.id ?? 'unknown'}`,
      )
    }
  }
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
