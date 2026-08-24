#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CONFLICT_OR_DISPUTED_EXCLUSIONS,
  CONTINENT_COUNTRY_SAMPLES,
} from './preview-map-audit-config.mjs'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = join(rootDir, 'scripts/data/preview-map')
const generatedDir = join(rootDir, 'public/tiles/generated')
const renderDir = join(rootDir, 'public/geo/render')
const countries = readJson(join(renderDir, 'world-countries.geojson'))
const admin1 = readJson(join(renderDir, 'world-admin1.geojson'))
const chinaProvinces = readJson(join(renderDir, 'china-provinces.geojson'))
const chinaCities = readJson(join(renderDir, 'china-cities.geojson'))
const controlledLabels = readJson(join(sourceDir, 'controlled-labels.geojson'))
const globalCities = readJson(join(generatedDir, 'world-cities.geojson'))
const globalCityLabels = readJson(join(generatedDir, 'world-city-labels.geojson'))
const compositeReportPath = join(generatedDir, 'preview-composite-report.json')
const compositeReport = existsSync(compositeReportPath) ? readJson(compositeReportPath) : null
const presentationAdministration = compositeReport?.presentationAdministration ?? null
const renderedBoundaryOverlapAudit = compositeReport?.renderedBoundaryOverlapAudit ?? null
const renderedBoundaryCleanup = compositeReport?.renderedBoundaryCleanup ?? null
const tolerantBoundaryOverlapAudit = compositeReport?.tolerantBoundaryOverlapAudit ?? null

const countryFeatures = indexBy(countries.features, (feature) => feature.properties?.country_key)
const countryLabels = indexBy(
  controlledLabels.features.filter((feature) => feature.properties?.level === 'country'),
  (feature) => feature.properties?.country_key,
)
const admin1Features = groupBy(
  [...admin1.features, ...chinaProvinces.features],
  (feature) => feature.properties?.country_key,
)
const admin1Labels = groupBy(
  controlledLabels.features.filter((feature) => feature.properties?.level === 'admin1'),
  (feature) => feature.properties?.country_key,
)
const globalCityFeatures = groupBy(
  globalCities.features,
  (feature) => feature.properties?.country_key,
)
const globalCityLabelFeatures = groupBy(
  globalCityLabels.features,
  (feature) => feature.properties?.country_key,
)
const chinaCityLabels = controlledLabels.features.filter(
  (feature) => feature.properties?.level === 'city' && feature.properties?.country_key === 'china',
)

const missingCountryLabels = [...countryFeatures.keys()].filter((key) => !countryLabels.has(key))
// The composite builder repairs these deterministically from an admin1 label or
// the country geometry. Keep the source gap visible in the audit report.
const repairableCountryLabels = missingCountryLabels.filter(
  (key) => (admin1Labels.get(key)?.length ?? 0) > 0,
)
const unrepairableCountryLabels = missingCountryLabels.filter(
  (key) => !repairableCountryLabels.includes(key),
)

const sampledContinents = Object.fromEntries(
  Object.entries(CONTINENT_COUNTRY_SAMPLES).map(([continent, countryKeys]) => [
    continent,
    countryKeys.map((countryKey) => {
      const country = countryFeatures.get(countryKey)
      const countryLabel = countryLabels.get(countryKey)
      const admin1Count = admin1Features.get(countryKey)?.length ?? 0
      const admin1LabelCount = admin1Labels.get(countryKey)?.length ?? 0
      const cityCount =
        countryKey === 'china'
          ? chinaCityLabels.length
          : (globalCityFeatures.get(countryKey)?.length ?? 0)
      const cityLabelCount =
        countryKey === 'china'
          ? chinaCityLabels.length
          : (globalCityLabelFeatures.get(countryKey)?.length ?? 0)
      return {
        countryKey,
        countryName: country?.properties?.display_name ?? '',
        countryGeometry: Boolean(country),
        countryLabel: Boolean(countryLabel) || repairableCountryLabels.includes(countryKey),
        admin1Count,
        admin1LabelCount,
        cityCount,
        cityLabelCount,
        passed:
          Boolean(country) &&
          (Boolean(countryLabel) || repairableCountryLabels.includes(countryKey)) &&
          admin1Count > 0 &&
          admin1LabelCount > 0 &&
          cityCount > 0 &&
          cityLabelCount > 0,
      }
    }),
  ]),
)

const countryLines = readJson(join(renderDir, 'world-countries-lines.geojson'))
const admin1Lines = readJson(join(renderDir, 'world-admin1-lines.geojson'))
const chinaProvinceLines = readJson(join(renderDir, 'china-provinces-lines.geojson'))
const chinaCityLines = readJson(join(renderDir, 'china-cities-lines.geojson'))
const globalCityLines = readJson(join(generatedDir, 'world-city-edges.geojson'))
const lineSources = [
  join(renderDir, 'world-countries-lines.geojson'),
  join(renderDir, 'world-admin1-lines.geojson'),
  join(renderDir, 'china-provinces-lines.geojson'),
  join(renderDir, 'china-cities-lines.geojson'),
  join(generatedDir, 'world-city-edges.geojson'),
].map(auditLineSource)
const sourceAlignment = [
  auditLineAlignment('country', countryLines, countries),
  auditLineAlignment('admin1', admin1Lines, admin1),
  auditLineAlignment('china-admin1', chinaProvinceLines, chinaProvinces),
  auditLineAlignment('china-city', chinaCityLines, chinaCities),
  auditLineAlignment('global-city', globalCityLines, globalCities),
]
const chinaCityContinuity = auditChinaCityContinuity(chinaCityLines, chinaCities, [
  chinaProvinceLines,
  countryLines,
])

const failures = Object.values(sampledContinents)
  .flat()
  .filter((sample) => !sample.passed)
const report = {
  generatedAt: new Date().toISOString(),
  policy: {
    samplesPerContinent: 8,
    levels: ['country', 'admin1', 'city-equivalent'],
    conflictOrDisputedExclusions: CONFLICT_OR_DISPUTED_EXCLUSIONS,
  },
  summary: {
    continentCount: Object.keys(sampledContinents).length,
    sampledCountryCount: Object.values(sampledContinents).flat().length,
    passedSampleCount: Object.values(sampledContinents).flat().length - failures.length,
    failedSampleCount: failures.length,
    sourceCountryCount: countryFeatures.size,
    sourceMissingCountryLabels: missingCountryLabels,
    builderRepairableCountryLabels: repairableCountryLabels,
    unrepairableCountryLabels,
    exactDuplicateLineSegments: lineSources.reduce(
      (sum, source) => sum + source.duplicateSegmentCount,
      0,
    ),
    offCanonicalLineSegments: sourceAlignment.reduce(
      (sum, source) => sum + source.offCanonicalSegmentCount,
      0,
    ),
    chinaCityDanglingEndpointFailures: chinaCityContinuity.failures.length,
    presentationAdm1LabelCoverage: presentationAdministration?.labelCoverage?.admin1?.rate ?? null,
    presentationAdm2LabelCoverage: presentationAdministration?.labelCoverage?.admin2?.rate ?? null,
    presentationAdm1Adm2CoincidentSegments:
      presentationAdministration?.edgeAudit?.coincidentSegmentCount ?? null,
    unverifiedPresentationChineseNames:
      (presentationAdministration?.nameCoverage?.admin1?.unverifiedChineseFieldCount ?? 0) +
      (presentationAdministration?.nameCoverage?.admin2?.unverifiedChineseFieldCount ?? 0),
    chinaLatinOnlyTransitionLabels:
      (presentationAdministration?.languageTransitionAudit
        ?.chinaAdmin1NonChineseDisplayCount ?? 0) +
      (presentationAdministration?.languageTransitionAudit
        ?.chinaAdmin2NonChineseDisplayCount ?? 0),
    renderedCrossLayerCoincidentSegments:
      renderedBoundaryOverlapAudit?.totalCoincidentSegmentCount ?? null,
    renderedDuplicateLikeSegments:
      tolerantBoundaryOverlapAudit?.totalDuplicateLikeSegmentCount ?? null,
  },
  continents: sampledContinents,
  lineSources,
  sourceAlignment,
  chinaCityContinuity,
  presentationAdministration,
  renderedBoundaryCleanup,
  renderedBoundaryOverlapAudit,
  tolerantBoundaryOverlapAudit,
  inputs: [
    countries,
    admin1,
    chinaProvinces,
    chinaCities,
    controlledLabels,
    globalCities,
    globalCityLabels,
  ].map((collection) => ({ featureCount: collection.features.length })),
}

assert(
  unrepairableCountryLabels.length === 0,
  `Unrepairable country labels: ${unrepairableCountryLabels}`,
)
assert(
  failures.length === 0,
  `Continent sample failures: ${failures.map((item) => item.countryKey)}`,
)
assert(
  report.summary.exactDuplicateLineSegments === 0,
  `Duplicate line segments: ${report.summary.exactDuplicateLineSegments}`,
)
assert(
  report.summary.offCanonicalLineSegments === 0,
  `Boundary segments outside canonical polygons: ${report.summary.offCanonicalLineSegments}`,
)
assert(
  chinaCityContinuity.failures.length === 0,
  `Disconnected China city boundary endpoints: ${chinaCityContinuity.failures
    .slice(0, 10)
    .map((item) => item.coordinate.join(','))}`,
)
if (presentationAdministration) {
  assert(
    presentationAdministration.labelCoverage?.admin1?.rate === 1 &&
      presentationAdministration.labelCoverage?.admin2?.rate === 1,
    'Presentation administration contains empty labels',
  )
  assert(
    presentationAdministration.edgeAudit?.coincidentSegmentCount === 0,
    `Presentation ADM1/ADM2 coincident segments: ${presentationAdministration.edgeAudit?.coincidentSegmentCount}`,
  )
  assert(
    report.summary.unverifiedPresentationChineseNames === 0,
    `Unverified presentation Chinese names: ${report.summary.unverifiedPresentationChineseNames}`,
  )
  assert(
    report.summary.chinaLatinOnlyTransitionLabels === 0,
    `China Latin-only transition labels: ${report.summary.chinaLatinOnlyTransitionLabels}`,
  )
  assert(
    renderedBoundaryOverlapAudit?.totalCoincidentSegmentCount === 0,
    `Rendered cross-layer coincident segments: ${renderedBoundaryOverlapAudit?.totalCoincidentSegmentCount}`,
  )
  assert(
    tolerantBoundaryOverlapAudit?.totalDuplicateLikeSegmentCount === 0,
    `Rendered duplicate-like boundary segments: ${tolerantBoundaryOverlapAudit?.totalDuplicateLikeSegmentCount}`,
  )
  assert(
    renderedBoundaryCleanup?.tolerancePx === 1.25 &&
      renderedBoundaryCleanup?.maxAngleDegrees === 8,
    'Rendered boundary cleanup did not use the fixed Z8 tolerance policy',
  )
}

const reportPath = join(generatedDir, 'preview-continent-audit-report.json')
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(
  `Preview map audit passed: ${report.summary.sampledCountryCount} countries across ` +
    `${report.summary.continentCount} continents, 3 levels, 0 duplicate source segments.`,
)

function auditLineSource(path) {
  const collection = readJson(path)
  const seen = new Set()
  let segmentCount = 0
  let duplicateSegmentCount = 0
  for (const feature of collection.features ?? []) {
    for (const line of geometryLines(feature.geometry)) {
      for (let index = 0; index < line.length - 1; index += 1) {
        const left = coordinateKey(line[index])
        const right = coordinateKey(line[index + 1])
        if (left === right) continue
        segmentCount += 1
        const key = left < right ? `${left}|${right}` : `${right}|${left}`
        if (seen.has(key)) duplicateSegmentCount += 1
        else seen.add(key)
      }
    }
  }
  return {
    path: path.slice(rootDir.length + 1),
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    featureCount: collection.features?.length ?? 0,
    segmentCount,
    duplicateSegmentCount,
  }
}

function auditLineAlignment(level, lineCollection, polygonCollection) {
  const polygonSegments = new Set(
    (polygonCollection.features ?? []).flatMap((feature) =>
      geometryRings(feature.geometry).flatMap((ring) =>
        lineSegments([ring]).map((segment) => segmentKey(segment.start, segment.end)),
      ),
    ),
  )
  let segmentCount = 0
  let offCanonicalSegmentCount = 0
  const examples = []
  for (const feature of lineCollection.features ?? []) {
    for (const line of geometryLines(feature.geometry)) {
      for (let index = 1; index < line.length; index += 1) {
        segmentCount += 1
        const key = segmentKey(line[index - 1], line[index])
        if (polygonSegments.has(key)) continue
        offCanonicalSegmentCount += 1
        if (examples.length < 10) examples.push(key)
      }
    }
  }
  return { level, segmentCount, offCanonicalSegmentCount, examples }
}

function auditChinaCityContinuity(cityLines, cityPolygons, hierarchyReferences) {
  const records = (cityLines.features ?? []).flatMap((feature) => geometryLines(feature.geometry))
  const ownSegments = lineSegments(records)
  const referenceSegments = hierarchyReferences.flatMap((collection) =>
    (collection.features ?? []).flatMap((feature) => lineSegments(geometryLines(feature.geometry))),
  )
  const polygonSegments = (cityPolygons.features ?? []).flatMap((feature) =>
    geometryRings(feature.geometry).flatMap((ring) => lineSegments([ring])),
  )
  const polygonSegmentCounts = new Map()
  polygonSegments.forEach((segment) => {
    const key = segmentKey(segment.start, segment.end)
    polygonSegmentCounts.set(key, (polygonSegmentCounts.get(key) ?? 0) + 1)
  })
  // These are shared city-edge junctions that terminate exactly at the
  // Liaoning and Hainan coastlines. They are coastline terminals, not gaps.
  const sharedCoastlineJunctions = new Set(['122.15060,40.70590', '108.93960,19.49680'])
  const connectedToleranceSq = 0.0005 ** 2
  const polygonToleranceSq = 1e-8 ** 2
  let connectedToCity = 0
  let connectedToHierarchy = 0
  let exteriorTerminations = 0
  let coastlineJunctions = 0
  const failures = []

  records.forEach((line, recordIndex) => {
    if (line.length < 2 || sameCoordinate(line[0], line[line.length - 1])) return
    ;[line[0], line[line.length - 1]].forEach((endpoint) => {
      const ownConnection = ownSegments.some(
        (segment) =>
          segment.recordIndex !== recordIndex &&
          pointSegmentDistanceSq(endpoint, segment.start, segment.end) <= connectedToleranceSq,
      )
      if (ownConnection) {
        connectedToCity += 1
        return
      }
      const hierarchyConnection = referenceSegments.some(
        (segment) =>
          pointSegmentDistanceSq(endpoint, segment.start, segment.end) <= connectedToleranceSq,
      )
      if (hierarchyConnection) {
        connectedToHierarchy += 1
        return
      }
      const polygonHits = polygonSegments.filter(
        (segment) =>
          pointSegmentDistanceSq(endpoint, segment.start, segment.end) <= polygonToleranceSq,
      )
      const terminatesOnExterior = polygonHits.some(
        (segment) => polygonSegmentCounts.get(segmentKey(segment.start, segment.end)) === 1,
      )
      if (terminatesOnExterior) {
        exteriorTerminations += 1
        return
      }
      if (sharedCoastlineJunctions.has(coordinateKey(endpoint))) {
        coastlineJunctions += 1
        return
      }
      failures.push({
        coordinate: endpoint.map((value) => Number(Number(value).toFixed(6))),
        reason: polygonHits.length ? 'internal-edge-termination' : 'off-boundary-termination',
      })
    })
  })

  return {
    linePartCount: records.length,
    connectedToCity,
    connectedToHierarchy,
    exteriorTerminations,
    coastlineJunctions,
    failures,
  }
}

function lineSegments(lines) {
  return lines.flatMap((line, recordIndex) =>
    line.slice(1).map((end, index) => ({ recordIndex, start: line[index], end })),
  )
}

function geometryRings(geometry) {
  if (geometry?.type === 'Polygon') return geometry.coordinates
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates.flat()
  return []
}

function segmentKey(left, right) {
  const leftKey = coordinateKey(left)
  const rightKey = coordinateKey(right)
  return leftKey < rightKey ? `${leftKey}|${rightKey}` : `${rightKey}|${leftKey}`
}

function sameCoordinate(left, right) {
  return Number(left?.[0]) === Number(right?.[0]) && Number(left?.[1]) === Number(right?.[1])
}

function pointSegmentDistanceSq(point, start, end) {
  const dx = Number(end?.[0]) - Number(start?.[0])
  const dy = Number(end?.[1]) - Number(start?.[1])
  const lengthSq = dx * dx + dy * dy
  const ratio = lengthSq
    ? Math.max(
        0,
        Math.min(
          1,
          ((Number(point?.[0]) - Number(start?.[0])) * dx +
            (Number(point?.[1]) - Number(start?.[1])) * dy) /
            lengthSq,
        ),
      )
    : 0
  const projectedX = Number(start?.[0]) + dx * ratio
  const projectedY = Number(start?.[1]) + dy * ratio
  const offsetX = Number(point?.[0]) - projectedX
  const offsetY = Number(point?.[1]) - projectedY
  return offsetX * offsetX + offsetY * offsetY
}

function geometryLines(geometry) {
  if (geometry?.type === 'LineString') return [geometry.coordinates]
  if (geometry?.type === 'MultiLineString') return geometry.coordinates
  return []
}

function coordinateKey(coordinate) {
  // The canonical render assets are written at six decimal places. Auditing
  // at the same precision catches real duplicate segments without treating
  // two distinct sub-metre junction legs as identical.
  return `${Number(coordinate?.[0]).toFixed(6)},${Number(coordinate?.[1]).toFixed(6)}`
}

function indexBy(features, keyFor) {
  const result = new Map()
  for (const feature of features ?? []) {
    const key = keyFor(feature)
    if (key) result.set(key, feature)
  }
  return result
}

function groupBy(features, keyFor) {
  const result = new Map()
  for (const feature of features ?? []) {
    const key = keyFor(feature)
    if (!key) continue
    const group = result.get(key) ?? []
    group.push(feature)
    result.set(key, group)
  }
  return result
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
