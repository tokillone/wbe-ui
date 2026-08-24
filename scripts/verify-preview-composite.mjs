#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { VectorTile } from '@mapbox/vector-tile'
import Protobuf from 'pbf'

import { CONTINENT_COUNTRY_SAMPLES } from './preview-map-audit-config.mjs'
import { applyControlledLabelPointOverrides } from './preview-label-overrides.mjs'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const archivePath = resolve(
  process.env.PREVIEW_COMPOSITE_OUTPUT || `${rootDir}/public/tiles/wbe-preview-composite.pmtiles`,
)

assert(existsSync(archivePath), `Missing ${archivePath}`)
execFileSync(process.execPath, [`${rootDir}/scripts/audit-preview-map.mjs`], { stdio: 'inherit' })
execFileSync('pmtiles', ['verify', '--quiet', archivePath], { stdio: 'inherit' })
const header = JSON.parse(
  execFileSync('pmtiles', ['show', '--header-json', archivePath], { encoding: 'utf8' }),
)
const metadata = JSON.parse(
  execFileSync('pmtiles', ['show', '--metadata', archivePath], { encoding: 'utf8' }),
)
const layers = new Set((metadata.vector_layers ?? []).map((layer) => layer.id))
const requiredLayers = [
  'earth',
  'water',
  'roads',
  'places',
  'preview_country_overview',
  'preview_country_boundaries',
  'preview_presentation_admin1_boundaries',
  'preview_presentation_admin1_labels',
  'preview_presentation_admin2_boundaries',
  'preview_presentation_admin2_labels',
  'preview_china_province_boundaries',
  'preview_china_city_boundaries',
  'preview_region_outlines',
  'preview_region_display_outlines',
  'preview_region_polygons',
  'preview_country_labels',
]

assert(header.minzoom === 0, `Expected min zoom 0, got ${header.minzoom}`)
assert(header.maxzoom === 8, `Expected max zoom 8, got ${header.maxzoom}`)
requiredLayers.forEach((layer) => assert(layers.has(layer), `Missing vector layer: ${layer}`))
assert(!layers.has('preview_labels'), 'Legacy mixed preview_labels layer must not be present')
assert(
  !layers.has('preview_localized_cities'),
  'Ordinary localized city-place labels must not be present',
)
for (const legacyLayer of [
  'preview_admin1_boundaries',
  'preview_vietnam_admin1_boundaries',
  'preview_global_admin2_boundaries',
  'preview_admin1_labels',
  'preview_city_labels',
  'preview_global_admin2_fallback_labels',
]) {
  assert(!layers.has(legacyLayer), `Legacy mixed visual layer must not be present: ${legacyLayer}`)
}

verifyAllCountryLabels()
verifyPresentationAdministration(metadata)
verifyRegionOutlineCoverage(metadata)
verifyRegionDisplayOutlines(metadata)
verifyRegionPolygons(metadata)
console.log(
  `Preview composite verified: Z${header.minzoom}-Z${header.maxzoom}, ${layers.size} vector layers, all country labels and six-continent samples present.`,
)

function verifyPresentationAdministration(metadata) {
  const compositeReport = readJson(
    `${rootDir}/public/tiles/generated/preview-composite-report.json`,
  )
  const report = compositeReport.presentationAdministration
  assert(report, 'Missing presentation administration report')
  assert(report.labelCoverage?.admin1?.rate === 1, 'Incomplete presentation ADM1 labels')
  assert(report.labelCoverage?.admin2?.rate === 1, 'Incomplete presentation ADM2 labels')
  assert(
    report.nameCoverage?.admin1?.unverifiedChineseFieldCount === 0 &&
      report.nameCoverage?.admin2?.unverifiedChineseFieldCount === 0,
    'Presentation labels contain unverified Chinese names',
  )
  assert(
    report.nameResolution?.snapshot?.cldrVersion === '48',
    'Presentation labels were not built from the pinned CLDR 48 snapshot',
  )
  assert(
    report.languageTransitionAudit?.chinaAdmin1NonChineseDisplayCount === 0 &&
      report.languageTransitionAudit?.chinaAdmin2NonChineseDisplayCount === 0,
    'China presentation labels contain a Latin-only transition fallback',
  )
  assert(
    report.edgeAudit?.coincidentSegmentCount === 0,
    `ADM1/ADM2 coincident edges: ${report.edgeAudit?.coincidentSegmentCount}`,
  )
  assert(
    compositeReport.renderedBoundaryOverlapAudit?.totalCoincidentSegmentCount === 0,
    `Cross-layer coincident edges: ${compositeReport.renderedBoundaryOverlapAudit?.totalCoincidentSegmentCount}`,
  )
  assert(
    compositeReport.tolerantBoundaryOverlapAudit?.totalDuplicateLikeSegmentCount === 0,
    `Duplicate-like rendered edges: ${compositeReport.tolerantBoundaryOverlapAudit?.totalDuplicateLikeSegmentCount}`,
  )
  assert(
    compositeReport.renderedBoundaryCleanup?.zoom === 8 &&
      compositeReport.renderedBoundaryCleanup?.tolerancePx === 1.25 &&
      compositeReport.renderedBoundaryCleanup?.maxAngleDegrees === 8,
    'Rendered boundary cleanup tolerance policy is missing or changed',
  )
  const policies = new Map(
    (report.countryPolicies ?? []).map((policy) => [policy.countryKey, policy]),
  )
  for (const [countryKey, expected] of [
    ['france', 13],
    ['italy', 20],
    ['germany', 16],
    ['unitedkingdom', 4],
  ]) {
    assert(
      policies.get(countryKey)?.admin1Count === expected,
      `Unexpected presentation ADM1 count for ${countryKey}`,
    )
  }
  for (const countryKey of [
    'france',
    'germany',
    'italy',
    'spain',
    'switzerland',
    'unitedkingdom',
  ]) {
    const policy = policies.get(countryKey)
    assert(
      policy?.admin1VerifiedChineseCount === policy?.admin1Count,
      `Incomplete verified Chinese ADM1 names for ${countryKey}`,
    )
  }
  assert(
    policies.get('unitedsofamerica')?.admin1VerifiedChineseCount >= 50,
    'Expected verified Chinese names for all US states',
  )
  for (const countryKey of ['romania', 'netherlands', 'croatia']) {
    assert(
      policies.get(countryKey)?.admin2DetailProfile === 'veryDense',
      `Expected veryDense ADM2 profile for ${countryKey}`,
    )
  }
  for (const countryKey of ['unitedsofamerica', 'unitedkingdom']) {
    assert(
      policies.get(countryKey)?.admin2DetailProfile === 'dense',
      `Expected dense ADM2 profile for ${countryKey}`,
    )
  }
  for (const countryKey of ['france', 'italy']) {
    assert(
      policies.get(countryKey)?.admin2DetailProfile === 'standard',
      `Expected standard ADM2 profile for ${countryKey}`,
    )
  }

  const requiredFields = [
    'country_key',
    'geo_key',
    'parent_geo_key',
    'presentation_level',
    'detail_profile',
    'source_level',
  ]
  for (const layerName of [
    'preview_presentation_admin1_boundaries',
    'preview_presentation_admin1_labels',
    'preview_presentation_admin2_boundaries',
    'preview_presentation_admin2_labels',
  ]) {
    const layer = (metadata.vector_layers ?? []).find((candidate) => candidate.id === layerName)
    const fields = new Set(Object.keys(layer?.fields ?? {}))
    requiredFields.forEach((field) => {
      assert(fields.has(field), `${layerName} is missing ${field}`)
    })
  }
  for (const layerName of [
    'preview_presentation_admin1_labels',
    'preview_presentation_admin2_labels',
  ]) {
    const layer = (metadata.vector_layers ?? []).find((candidate) => candidate.id === layerName)
    const fields = new Set(Object.keys(layer?.fields ?? {}))
    for (const field of [
      'display_name_local',
      'display_name_zh',
      'display_name_en',
      'name_zh_source',
      'name_zh_verified',
    ]) {
      assert(fields.has(field), `${layerName} is missing ${field}`)
    }
  }
}

function verifyRegionOutlineCoverage(metadata) {
  const report = readJson(`${rootDir}/public/tiles/generated/preview-composite-report.json`)
  const coverage = report.regionOutlineCoverage
  assert(coverage, 'Missing region outline coverage report')
  assert(
    coverage.matchRate === 1,
    `Expected complete region outline coverage, got ${coverage.matchRate}`,
  )
  for (const level of ['country', 'admin1', 'city']) {
    assert(
      coverage.expectedByLevel?.[level] === coverage.emittedByLevel?.[level],
      `Incomplete ${level} region outlines`,
    )
  }
  const layer = (metadata.vector_layers ?? []).find(
    (candidate) => candidate.id === 'preview_region_outlines',
  )
  const fields = new Set(Object.keys(layer?.fields ?? {}))
  for (const field of ['region_id', 'level', 'geo_key', 'parent_geo_key', 'country_key']) {
    assert(fields.has(field), `preview_region_outlines is missing ${field}`)
  }
}

function verifyRegionDisplayOutlines(metadata) {
  const report = readJson(`${rootDir}/public/tiles/generated/preview-composite-report.json`)
  const audit = report.regionDisplayOutlineAudit
  assert(audit, 'Missing region display outline audit')
  assert(
    audit.matchRate === 1,
    `Expected complete display outline coverage, got ${audit.matchRate}`,
  )
  assert(
    audit.overlapCount === 0,
    `Expected no display outline overlaps, got ${audit.overlapCount}`,
  )
  for (const geoKey of ['china|hongkong', 'china|aomen', 'china|guangdong|zhuhai']) {
    const focus = audit.focusRegions?.[geoKey]
    assert(focus, `Missing focus display outline: ${geoKey}`)
    assert(focus.componentCountAfter === 1, `Expected one display polygon for ${geoKey}`)
  }
  for (const [continent, samples] of Object.entries(audit.continentSamples ?? {})) {
    assert(samples.length === 8, `Expected eight display-outline samples for ${continent}`)
    samples.forEach((sample) => {
      assert(sample.outlineCount > 0, `Missing display outlines for ${sample.countryKey}`)
    })
  }
  const layer = (metadata.vector_layers ?? []).find(
    (candidate) => candidate.id === 'preview_region_display_outlines',
  )
  const fields = new Set(Object.keys(layer?.fields ?? {}))
  for (const field of [
    'region_id',
    'level',
    'geo_key',
    'parent_geo_key',
    'country_key',
    'display_geometry_mode',
    'component_count_before',
    'component_count_after',
  ]) {
    assert(fields.has(field), `preview_region_display_outlines is missing ${field}`)
  }
}

function verifyRegionPolygons(metadata) {
  const report = readJson(`${rootDir}/public/tiles/generated/preview-composite-report.json`)
  const coverage = report.regionPolygonCoverage
  assert(coverage, 'Missing region polygon coverage report')
  assert(
    coverage.matchRate === 1,
    `Expected complete region polygon coverage, got ${coverage.matchRate}`,
  )
  for (const level of ['country', 'admin1', 'city']) {
    assert(
      coverage.expectedByLevel?.[level] === coverage.emittedByLevel?.[level],
      `Incomplete ${level} region polygons`,
    )
  }
  const layer = (metadata.vector_layers ?? []).find(
    (candidate) => candidate.id === 'preview_region_polygons',
  )
  const fields = new Set(Object.keys(layer?.fields ?? {}))
  for (const field of ['region_id', 'level', 'geo_key', 'parent_geo_key', 'country_key']) {
    assert(fields.has(field), `preview_region_polygons is missing ${field}`)
  }
}

function verifyAllCountryLabels() {
  const countries = readJson(`${rootDir}/public/geo/render/world-countries.geojson`)
  const rawControlled = readJson(`${rootDir}/scripts/data/preview-map/controlled-labels.geojson`)
  const { collection: controlled } = applyControlledLabelPointOverrides(rawControlled)
  const points = new Map(
    controlled.features
      .filter((feature) => feature.properties?.level === 'country')
      .map((feature) => [feature.properties?.country_key, feature.geometry?.coordinates]),
  )
  const admin1Fallbacks = new Map(
    controlled.features
      .filter((feature) => feature.properties?.level === 'admin1')
      .map((feature) => [feature.properties?.country_key, feature.geometry?.coordinates]),
  )
  const expectedByTile = new Map()
  for (const country of countries.features ?? []) {
    const countryKey = country.properties?.country_key
    const point = points.get(countryKey) ?? admin1Fallbacks.get(countryKey)
    assert(countryKey && point, `Missing source or repair point for country label: ${countryKey}`)
    const [x, y] = lonLatToTile(point[0], point[1], 4)
    const tileKey = `4/${x}/${y}`
    const expected = expectedByTile.get(tileKey) ?? new Set()
    expected.add(countryKey)
    expectedByTile.set(tileKey, expected)
  }

  const renderedCountryKeys = new Set()
  for (const [tileKey, expected] of expectedByTile) {
    const [z, x, y] = tileKey.split('/').map(Number)
    const features = countryFeaturesInTile(z, x, y)
    for (const countryKey of expected) {
      const feature = features.get(countryKey)
      assert(feature, `Missing country label ${countryKey} in tile ${tileKey}`)
      assert(
        String(feature.display_name ?? feature.display_name_en ?? '').trim(),
        `Empty country name ${countryKey} in tile ${tileKey}`,
      )
      renderedCountryKeys.add(countryKey)
    }
  }

  const vietnamPoint = points.get('vietnam')
  assert(
    vietnamPoint?.[0] === 107.85 && vietnamPoint?.[1] === 16,
    `Unexpected Vietnam controlled anchor: ${JSON.stringify(vietnamPoint)}`,
  )
  const sampledKeys = new Set(Object.values(CONTINENT_COUNTRY_SAMPLES).flat())
  sampledKeys.forEach((countryKey) => {
    assert(renderedCountryKeys.has(countryKey), `Missing continent sample label: ${countryKey}`)
  })
  assert(
    renderedCountryKeys.size === countries.features.length,
    `Expected ${countries.features.length} country labels, got ${renderedCountryKeys.size}`,
  )
}

function countryFeaturesInTile(z, x, y) {
  const tileBuffer = execFileSync(
    'pmtiles',
    ['tile', '--quiet', archivePath, String(z), String(x), String(y)],
    { encoding: null },
  )
  const tile = new VectorTile(new Protobuf(gunzipSync(tileBuffer)))
  const layer = tile.layers.preview_country_labels
  assert(layer, `Missing preview_country_labels in tile ${z}/${x}/${y}`)
  return new Map(
    Array.from({ length: layer.length }, (_, index) => {
      const properties = layer.feature(index).properties
      return [String(properties.geo_key ?? ''), properties]
    }).filter(([countryKey]) => countryKey),
  )
}

function lonLatToTile(longitude, latitude, zoom) {
  const scale = 2 ** zoom
  const x = Math.floor(((longitude + 180) / 360) * scale)
  const limitedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude))
  const radians = (limitedLatitude * Math.PI) / 180
  const y = Math.floor(
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * scale,
  )
  return [Math.max(0, Math.min(scale - 1, x)), Math.max(0, Math.min(scale - 1, y))]
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
