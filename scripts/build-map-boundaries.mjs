#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { applyControlledLabelPointOverrides } from './preview-label-overrides.mjs'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const geoDir = resolve(rootDir, 'public/geo')
const renderDir = resolve(geoDir, 'render')
const reportPath = resolve(renderDir, 'boundary-quality-report.json')
const indexPath = resolve(renderDir, 'region-index.json')
const specialAdminPath = resolve(renderDir, 'china-special-admin-envelopes.geojson')
const specialAdminLinePath = resolve(renderDir, 'china-special-admin-envelopes-lines.geojson')
const coastalDisplayPath = resolve(renderDir, 'china-coastal-display-envelopes.geojson')
const detailedChinaLandSourcePath = resolve(rootDir, 'scripts/data/china-land-detail.geojson')
const controlledLabelsPath = resolve(rootDir, 'scripts/data/preview-map/controlled-labels.geojson')
const mapshaperBin = resolve(rootDir, 'node_modules/.bin/mapshaper')
const checkOnly = new Set(process.argv.slice(2)).has('--check')

const specs = [
  // Coastlines are expressed by the land/water fill transition. Only shared
  // land borders are emitted as administrative lines.
  { file: 'world-countries.geojson', level: 'country', mergeChina: true, lineMode: 'internal' },
  {
    file: 'world-admin1.geojson',
    level: 'admin1',
    lineMode: 'internal',
    // Normalize sub-metre source slivers once in the canonical polygon output.
    // Both the static line network and interactive outlines are derived from
    // this same result, so this cannot introduce a render/hit-test offset.
    snapInterval: 0.00001,
    excludeCountryKeys: new Set(['china', 'hongkongsar', 'macausar', 'macaosar', 'taiwan']),
  },
  {
    file: 'china-provinces.geojson',
    level: 'admin1',
    lineMode: 'internal',
  },
  {
    file: 'china-cities.geojson',
    level: 'city',
    mainlandOnly: true,
    lineMode: 'internal',
    cleanTogether: true,
  },
]

if (!checkOnly && !existsSync(mapshaperBin)) {
  throw new Error('Mapshaper is required. Run npm install before rebuilding map boundaries.')
}

mkdirSync(renderDir, { recursive: true })
const workDir = resolve(tmpdir(), `wbe-boundaries-${process.pid}`)
if (!checkOnly) mkdirSync(workDir, { recursive: true })

const report = {
  generatedAt: new Date().toISOString(),
  generator: 'mapshaper -clean rewind',
  renderDirectory: 'public/geo/render',
  sources: [],
  totals: {
    sourceFeatures: 0,
    renderedFeatures: 0,
    removedNonMainlandCities: 0,
    duplicateGeoKeysMerged: 0,
    selfIntersectionsAfterClean: 0,
    spikeVerticesRemoved: 0,
    duplicateLineSegments: 0,
  },
}
const renderedCollections = new Map()
const renderedLineCollections = new Map()
const detailedChinaLandGeometry = readJson(detailedChinaLandSourcePath).features?.[0]?.geometry
const controlledLabelPoints = loadControlledLabelPoints()
if (!detailedChinaLandGeometry) throw new Error('Missing detailed China land geometry')

try {
  for (const spec of specs) {
    const sourcePath = resolve(geoDir, spec.file)
    const outputPath = resolve(renderDir, spec.file)
    if (!existsSync(sourcePath)) throw new Error(`Missing source boundary: ${spec.file}`)

    const raw = readJson(sourcePath)
    const prepared = prepareCollection(raw, spec)
    if (!checkOnly) {
      runMapshaperByParent(prepared.collection, spec, outputPath)
    }
    if (!existsSync(outputPath)) throw new Error(`Missing rendered boundary: ${spec.file}`)

    const rendered = readJson(outputPath)
    renderedCollections.set(spec.file, rendered)
    const renderedLines = !checkOnly
      ? topologyLineCollection(rendered, spec)
      : readJson(lineAssetPath(spec.file))
    renderedLineCollections.set(spec.file, renderedLines)
    if (!checkOnly) writeJson(lineAssetPath(spec.file), renderedLines)
    const validation = validateCollection(rendered, spec)
    const lineValidation = validateLineCollection(renderedLines)
    const renderedKeys = new Set(
      (rendered.features ?? []).map((feature) => featureGeoKey(feature, spec.level)),
    )
    const droppedGeoKeys = prepared.collection.features
      .map((feature) => featureGeoKey(feature, spec.level))
      .filter((key) => key && !renderedKeys.has(key))
    report.sources.push({
      file: spec.file,
      level: spec.level,
      sourceFeatures: raw.features?.length ?? 0,
      preparedFeatures: prepared.collection.features.length,
      renderedFeatures: rendered.features?.length ?? 0,
      removedNonMainlandCities: prepared.removedNonMainlandCities,
      excludedDuplicateAdministrativeFeatures: prepared.excludedDuplicateAdministrativeFeatures,
      excludedNonMainlandCityGeoKeys: prepared.excludedNonMainlandCityGeoKeys,
      duplicateGeoKeysMerged: prepared.duplicateGeoKeysMerged,
      spikeVerticesRemoved: prepared.spikeVerticesRemoved,
      spikeRepairMetrics: prepared.spikeRepairMetrics,
      droppedGeoKeys,
      lineValidation,
      ...validation,
    })
    report.totals.sourceFeatures += raw.features?.length ?? 0
    report.totals.renderedFeatures += rendered.features?.length ?? 0
    report.totals.removedNonMainlandCities += prepared.removedNonMainlandCities
    report.totals.duplicateGeoKeysMerged += prepared.duplicateGeoKeysMerged
    report.totals.selfIntersectionsAfterClean += validation.selfIntersections.length
    report.totals.spikeVerticesRemoved += prepared.spikeVerticesRemoved
    report.totals.duplicateLineSegments += lineValidation.duplicateSegments.length
  }

  const specialAdmins = !checkOnly
    ? buildSpecialAdminEnvelopes(renderedCollections.get('china-provinces.geojson'))
    : readJson(specialAdminPath)
  const specialAdminLines = !checkOnly
    ? topologyLineCollection(specialAdmins, {
        level: 'admin1',
        lineMode: 'all',
        groupKey: () => '__special_admins__',
      })
    : readJson(specialAdminLinePath)
  if (!checkOnly) {
    writeJson(specialAdminPath, specialAdmins)
    writeJson(specialAdminLinePath, specialAdminLines)
  }
  const clippedCities = !checkOnly
    ? eraseCollection(
        renderedCollections.get('china-cities.geojson'),
        specialAdmins,
        'china-cities-without-special-admin-overlap',
      )
    : renderedCollections.get('china-cities.geojson')
  if (!checkOnly) {
    const citySpec = specs.find((spec) => spec.file === 'china-cities.geojson')
    const clippedCityLines = topologyLineCollection(clippedCities, citySpec)
    writeJson(resolve(renderDir, 'china-cities.geojson'), clippedCities)
    writeJson(lineAssetPath('china-cities.geojson'), clippedCityLines)
    renderedCollections.set('china-cities.geojson', clippedCities)
    renderedLineCollections.set('china-cities.geojson', clippedCityLines)
    const cityReport = report.sources.find((source) => source.file === 'china-cities.geojson')
    Object.assign(cityReport, validateCollection(clippedCities, citySpec), {
      renderedFeatures: clippedCities.features?.length ?? 0,
      lineValidation: validateLineCollection(clippedCityLines),
    })

    // The province and city source files historically used different outer
    // rings. Dissolving the normalized city partition by parent makes their
    // shared hierarchy nodes identical, while retaining the original province
    // properties and non-mainland province geometries.
    const provinceSpec = specs.find((spec) => spec.file === 'china-provinces.geojson')
    const alignedProvinces = deriveChinaProvincesFromCities(
      renderedCollections.get('china-provinces.geojson'),
      clippedCities,
    )
    const alignedProvinceLines = topologyLineCollection(alignedProvinces, provinceSpec)
    writeJson(resolve(renderDir, 'china-provinces.geojson'), alignedProvinces)
    writeJson(lineAssetPath('china-provinces.geojson'), alignedProvinceLines)
    renderedCollections.set('china-provinces.geojson', alignedProvinces)
    renderedLineCollections.set('china-provinces.geojson', alignedProvinceLines)
    const provinceReport = report.sources.find(
      (source) => source.file === 'china-provinces.geojson',
    )
    Object.assign(provinceReport, validateCollection(alignedProvinces, provinceSpec), {
      renderedFeatures: alignedProvinces.features?.length ?? 0,
      lineValidation: validateLineCollection(alignedProvinceLines),
      geometrySource: 'normalized China city partition dissolved by parent_geo_key',
    })
  }
  validateParentRelationships(report)
  report.specialAdminEnvelopes = validateSpecialAdminEnvelopes(
    specialAdmins,
    renderedCollections.get('china-provinces.geojson'),
    clippedCities,
  )
  const coastalDisplayEnvelopes = !checkOnly
    ? buildChinaCoastalDisplayEnvelopes(
        specialAdmins,
        renderedCollections.get('china-cities.geojson'),
      )
    : readJson(coastalDisplayPath)
  if (!checkOnly) writeJson(coastalDisplayPath, coastalDisplayEnvelopes)
  report.coastalDisplayEnvelopes = validateChinaCoastalDisplayEnvelopes(
    coastalDisplayEnvelopes,
    renderedCollections.get('china-cities.geojson'),
  )
  const regionIndex = buildRegionIndex(renderedCollections, specialAdmins)
  if (!checkOnly) writeJson(indexPath, regionIndex)
  const vietnamAnchor = regionIndex.regions.find(
    (region) => region.level === 'country' && region.geo_key === 'vietnam',
  )
  report.controlledLabelAnchors = {
    countryCount: controlledLabelPoints.country.size,
    chinaAdmin1Count: controlledLabelPoints.chinaAdmin1.size,
    vietnam: vietnamAnchor
      ? {
          coordinates: vietnamAnchor.label_point,
          insideGeometry: true,
          source: 'controlled-override',
        }
      : null,
  }
  const failures = report.sources.flatMap((source) => [
    ...source.missingGeoKeys.map((key) => `${source.file}: missing geo_key ${key}`),
    ...source.duplicateGeoKeys.map((key) => `${source.file}: duplicate geo_key ${key}`),
    ...source.nonPolygonGeometries.map((key) => `${source.file}: non-polygon ${key}`),
    ...source.unclosedRings.map((key) => `${source.file}: unclosed ring ${key}`),
    ...source.zeroLengthSegments.map((key) => `${source.file}: zero-length segment ${key}`),
    ...source.selfIntersections.map((key) => `${source.file}: self-intersection ${key}`),
    ...source.lineValidation.antimeridianJumps.map(
      (key) => `${source.file}: antimeridian line jump ${key}`,
    ),
    ...source.lineValidation.duplicateSegments.map(
      (key) => `${source.file}: duplicate line segment ${key}`,
    ),
    ...source.spikeRepairMetrics.excessiveRepairs.map(
      (key) => `${source.file}: excessive spike repair ${key}`,
    ),
  ])
  failures.push(...report.specialAdminEnvelopes.failures)
  failures.push(...report.coastalDisplayEnvelopes.failures)
  if (!checkOnly) writeJson(reportPath, report)
  if (failures.length) {
    failures.slice(0, 30).forEach((failure) => console.error(failure))
    throw new Error(`Boundary quality validation failed with ${failures.length} issue(s)`)
  }
  console.log(
    `${checkOnly ? 'Checked' : 'Built'} ${report.totals.renderedFeatures} cleaned boundary features; ` +
      `${report.totals.removedNonMainlandCities} non-mainland city features excluded.`,
  )
} finally {
  if (!checkOnly) rmSync(workDir, { recursive: true, force: true })
}

function prepareCollection(collection, spec) {
  const groups = new Map()
  let removedNonMainlandCities = 0
  const excludedNonMainlandCityGeoKeys = []
  let duplicateGeoKeysMerged = 0
  let excludedDuplicateAdministrativeFeatures = 0
  let spikeVerticesRemoved = 0
  let maxSpikeAreaDriftRatio = 0
  let maxSpikeBboxDriftDegrees = 0
  const excessiveSpikeRepairs = []
  const rejectedSpikeRepairs = []
  for (const feature of collection.features ?? []) {
    const countryKey = canonicalCountryKey(String(feature.properties?.country_key ?? ''))
    if (spec.excludeCountryKeys?.has(countryKey)) {
      excludedDuplicateAdministrativeFeatures += 1
      continue
    }
    if (spec.mainlandOnly && !isMainlandChinaCity(feature.properties ?? {})) {
      removedNonMainlandCities += 1
      excludedNonMainlandCityGeoKeys.push(featureGeoKey(feature, spec.level))
      continue
    }
    const key = spec.mergeChina ? canonicalCountryKey(featureGeoKey(feature, spec.level)) : featureGeoKey(feature, spec.level)
    const groupKey = key || `__missing__${groups.size}`
    if (!groups.has(groupKey)) groups.set(groupKey, [])
    groups.get(groupKey).push(feature)
  }
  const features = []
  for (const [groupKey, group] of groups.entries()) {
    if (group.length > 1) duplicateGeoKeysMerged += group.length - 1
    const polygons = group.flatMap((feature) => geometryPolygons(feature.geometry))
    if (!polygons.length) continue
    const properties = { ...(group[0].properties ?? {}) }
    if (spec.mergeChina && groupKey === 'china') {
      properties.country_key = 'china'
      properties.geo_key = 'china'
      properties.region_key = 'china'
      properties.display_name = '中国'
      properties.name = 'China'
      properties.keys = [...new Set(group.flatMap((feature) => [
        featureGeoKey(feature, 'country'),
        feature.properties?.country_key,
        feature.properties?.display_name,
        feature.properties?.name,
      ]).filter(Boolean).map(String))]
    }
    const sourceGeometry = spec.mergeChina && groupKey === 'china'
      ? structuredClone(detailedChinaLandGeometry)
      : polygons.length === 1
        ? { type: 'Polygon', coordinates: polygons[0] }
        : { type: 'MultiPolygon', coordinates: polygons }
    const repaired = repairGeometrySpikes(sourceGeometry, spec.level)
    let acceptedGeometry = repaired.geometry
    let acceptedRemoved = repaired.removed
    if (repaired.removed) {
      const areaBefore = geometryArea(sourceGeometry)
      const areaAfter = geometryArea(repaired.geometry)
      const areaDriftRatio = areaBefore > 0 ? Math.abs(areaAfter - areaBefore) / areaBefore : 0
      const bboxDriftDegrees = bboxDrift(geometryBbox(sourceGeometry), geometryBbox(repaired.geometry))
      const bboxLimit = spec.level === 'country' ? 0.35 : spec.level === 'admin1' ? 0.12 : 0.06
      if (areaDriftRatio > 0.005 || bboxDriftDegrees > bboxLimit + 1e-9) {
        rejectedSpikeRepairs.push(
          `${groupKey}: area=${areaDriftRatio.toFixed(6)}, bbox=${bboxDriftDegrees.toFixed(6)}`,
        )
        acceptedGeometry = sourceGeometry
        acceptedRemoved = 0
      } else {
        maxSpikeAreaDriftRatio = Math.max(maxSpikeAreaDriftRatio, areaDriftRatio)
        maxSpikeBboxDriftDegrees = Math.max(maxSpikeBboxDriftDegrees, bboxDriftDegrees)
      }
    }
    spikeVerticesRemoved += acceptedRemoved
    features.push({
      type: 'Feature',
      properties,
      geometry: acceptedGeometry,
    })
  }
  return {
    collection: { type: 'FeatureCollection', features },
    removedNonMainlandCities,
    excludedNonMainlandCityGeoKeys,
    duplicateGeoKeysMerged,
    excludedDuplicateAdministrativeFeatures,
    spikeVerticesRemoved,
    spikeRepairMetrics: {
      maxAreaDriftRatio: maxSpikeAreaDriftRatio,
      maxBboxDriftDegrees: maxSpikeBboxDriftDegrees,
      excessiveRepairs: excessiveSpikeRepairs,
      rejectedRepairs: rejectedSpikeRepairs,
    },
  }
}

function runMapshaperByParent(collection, spec, outputPath) {
  const groups = new Map()
  for (const feature of collection.features ?? []) {
    const props = feature.properties ?? {}
    const groupKey = spec.cleanTogether
      ? '__all__'
      : spec.level === 'city'
      ? String(props.parent_geo_key ?? props.province_key ?? 'unassigned')
      : spec.level === 'admin1'
        ? String(props.parent_geo_key ?? props.country_key ?? 'unassigned')
        : '__countries__'
    if (!groups.has(groupKey)) groups.set(groupKey, [])
    groups.get(groupKey).push(feature)
  }
  const cleanedFeatures = []
  let index = 0
  for (const features of groups.values()) {
    const inputPath = resolve(workDir, `group-${spec.level}-${index}.geojson`)
    const groupOutput = resolve(workDir, `group-${spec.level}-${index}-clean.geojson`)
    writeJson(inputPath, { type: 'FeatureCollection', features })
    runMapshaper(inputPath, groupOutput, spec)
    cleanedFeatures.push(...(readJson(groupOutput).features ?? []))
    index += 1
  }
  if (spec.level === 'country') {
    const cleanedKeys = new Set(cleanedFeatures.map((feature) => featureGeoKey(feature, spec.level)))
    const missing = (collection.features ?? []).filter(
      (feature) => !cleanedKeys.has(featureGeoKey(feature, spec.level)),
    )
    for (const [missingIndex, feature] of missing.entries()) {
      const inputPath = resolve(workDir, `group-country-recovery-${missingIndex}.geojson`)
      const recoveryOutput = resolve(
        workDir,
        `group-country-recovery-${missingIndex}-clean.geojson`,
      )
      writeJson(inputPath, { type: 'FeatureCollection', features: [feature] })
      runMapshaper(inputPath, recoveryOutput, { ...spec, preserveOverlaps: true })
      cleanedFeatures.push(...(readJson(recoveryOutput).features ?? []))
    }
  }
  writeJson(outputPath, { type: 'FeatureCollection', features: cleanedFeatures })
}

function deriveChinaProvincesFromCities(provinces, cities) {
  const inputPath = resolve(workDir, 'china-province-city-partition.geojson')
  const outputPath = resolve(workDir, 'china-province-city-dissolved.geojson')
  writeJson(inputPath, cities)
  const result = spawnSync(
    mapshaperBin,
    [
      inputPath,
      '-dissolve',
      'parent_geo_key',
      '-clean',
      'rewind',
      'overlap-rule=max-area',
      'snap-interval=0.000001',
      '-o',
      'format=geojson',
      'precision=0.000001',
      outputPath,
    ],
    { stdio: 'inherit' },
  )
  if (result.status !== 0) {
    throw new Error('Mapshaper failed while deriving China provinces from the city partition')
  }
  const dissolved = readJson(outputPath)
  const geometryByParent = new Map(
    (dissolved.features ?? []).map((feature) => [
      String(feature.properties?.parent_geo_key ?? ''),
      feature.geometry,
    ]),
  )
  const alignedParentKeys = []
  const features = (provinces.features ?? []).map((feature) => {
    const geoKey = featureGeoKey(feature, 'admin1')
    const geometry = geometryByParent.get(geoKey)
    if (!geometry) return feature
    alignedParentKeys.push(geoKey)
    return { ...feature, geometry }
  })
  const missingParents = [...geometryByParent.keys()].filter(
    (parentKey) => parentKey && !alignedParentKeys.includes(parentKey),
  )
  if (missingParents.length) {
    throw new Error(`China city partition has unknown province parents: ${missingParents.join(', ')}`)
  }
  return { type: 'FeatureCollection', features }
}

function runMapshaper(inputPath, outputPath, spec) {
  const result = spawnSync(
    mapshaperBin,
    [
      inputPath,
      '-clean',
      'rewind',
      ...(spec.preserveOverlaps ? ['allow-overlaps'] : ['overlap-rule=max-area']),
      `snap-interval=${spec.snapInterval ?? 0.000001}`,
      '-o',
      'format=geojson',
      'precision=0.000001',
      'bbox',
      outputPath,
    ],
    { stdio: 'inherit' },
  )
  if (result.status !== 0) throw new Error(`Mapshaper failed for ${inputPath}`)
}

function repairGeometrySpikes(geometry, level) {
  const maxLegDegrees = level === 'country' ? 0.35 : level === 'admin1' ? 0.12 : 0.06
  let removed = 0
  const repairPolygon = (polygon) =>
    polygon.map((ring) => {
      const repaired = repairRingSpikes(ring, maxLegDegrees)
      removed += repaired.removed
      return repaired.ring
    })
  if (geometry?.type === 'Polygon') {
    return { geometry: { ...geometry, coordinates: repairPolygon(geometry.coordinates) }, removed }
  }
  if (geometry?.type === 'MultiPolygon') {
    return {
      geometry: { ...geometry, coordinates: geometry.coordinates.map(repairPolygon) },
      removed,
    }
  }
  return { geometry, removed }
}

function repairRingSpikes(ring, maxLegDegrees) {
  if (!Array.isArray(ring) || ring.length < 4) return { ring, removed: 0 }
  const points = []
  for (const value of ring) {
    const point = normalizeCoordinate(value)
    if (!point || samePoint(points[points.length - 1], point)) continue
    points.push(point)
  }
  if (points.length > 1 && samePoint(points[0], points[points.length - 1])) points.pop()
  let removed = 0
  let changed = true
  while (changed && points.length >= 4) {
    changed = false
    for (let index = 0; index < points.length; index += 1) {
      const previous = points[(index - 1 + points.length) % points.length]
      const current = points[index]
      const next = points[(index + 1) % points.length]
      const leftLeg = pointDistance(previous, current)
      const rightLeg = pointDistance(current, next)
      const shortcut = pointDistance(previous, next)
      if (
        leftLeg <= maxLegDegrees &&
        rightLeg <= maxLegDegrees &&
        shortcut <= Math.min(leftLeg, rightLeg) * 0.22 &&
        interiorAngleDegrees(previous, current, next) < 10
      ) {
        points.splice(index, 1)
        removed += 1
        changed = true
        break
      }
    }
  }
  return { ring: [...points, points[0]], removed }
}

function interiorAngleDegrees(left, center, right) {
  const ax = left[0] - center[0]
  const ay = left[1] - center[1]
  const bx = right[0] - center[0]
  const by = right[1] - center[1]
  const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by)
  if (!denominator) return 180
  const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / denominator))
  return (Math.acos(cosine) * 180) / Math.PI
}

function lineAssetPath(file) {
  return resolve(renderDir, file.replace(/\.geojson$/, '-lines.geojson'))
}

function topologyLineCollection(collection, spec) {
  const groupedFeatures = new Map()
  for (const feature of collection.features ?? []) {
    const props = feature.properties ?? {}
    const groupKey = spec.groupKey
      ? spec.groupKey(feature)
      : spec.level === 'country'
        ? '__countries__'
        : spec.level === 'city'
          ? String(props.parent_geo_key ?? props.province_key ?? 'unassigned')
          : String(props.parent_geo_key ?? props.country_key ?? 'unassigned')
    if (!groupedFeatures.has(groupKey)) groupedFeatures.set(groupKey, [])
    groupedFeatures.get(groupKey).push(feature)
  }

  const outputFeatures = []
  for (const [groupKey, features] of groupedFeatures.entries()) {
    const segments = new Map()
    for (const feature of features) {
      const owner = featureGeoKey(feature, spec.level)
      for (const ring of geometryRings(feature.geometry)) {
        if (!Array.isArray(ring)) continue
        for (let index = 1; index < ring.length; index += 1) {
          const left = normalizeCoordinate(ring[index - 1])
          const right = normalizeCoordinate(ring[index])
          if (!left || !right || samePoint(left, right)) continue
          if (Math.abs(left[0] - right[0]) > 180) continue
          const leftKey = coordinateKey(left)
          const rightKey = coordinateKey(right)
          const key = leftKey < rightKey ? `${leftKey}>${rightKey}` : `${rightKey}>${leftKey}`
          const existing = segments.get(key)
          if (existing) {
            existing.owners.add(owner)
          } else {
            segments.set(key, { left, right, owners: new Set([owner]) })
          }
        }
      }
    }

    const boundaryGroups = new Map()
    for (const segment of segments.values()) {
      const owners = [...segment.owners].filter(Boolean).sort()
      if (spec.lineMode === 'internal' && owners.length < 2) continue
      const pairKey = owners.join('|~|') || '__outer__'
      if (!boundaryGroups.has(pairKey)) boundaryGroups.set(pairKey, [])
      boundaryGroups.get(pairKey).push(segment)
    }

    for (const [pairKey, boundarySegments] of boundaryGroups.entries()) {
      const owners = pairKey === '__outer__' ? [] : pairKey.split('|~|')
      const lines = stitchSegments(boundarySegments)
      if (!lines.length) continue
      const firstProps = features[0]?.properties ?? {}
      outputFeatures.push({
        type: 'Feature',
        properties: {
          boundary_group: groupKey,
          parent_geo_key: spec.level === 'city' ? groupKey : String(firstProps.parent_geo_key ?? ''),
          country_key: String(firstProps.country_key ?? ''),
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
    const startKey =
      endpointIndex.get(seed.leftKey)?.length !== 2 ? seed.leftKey : seed.rightKey
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

function normalizeCoordinate(value) {
  if (!Array.isArray(value) || value.length < 2) return null
  const point = [roundCoord(Number(value[0])), roundCoord(Number(value[1]))]
  return point.every(Number.isFinite) ? point : null
}

function coordinateKey(point) {
  return `${roundCoord(point[0])},${roundCoord(point[1])}`
}

function buildSpecialAdminEnvelopes(provinces) {
  const specialKeys = new Set(['china|hongkong', 'china|aomen'])
  const envelopeFeatures = (provinces?.features ?? []).flatMap((feature) => {
    const geoKey = featureGeoKey(feature, 'admin1')
    if (!specialKeys.has(geoKey)) return []
    const points = []
    visitCoordinates(feature.geometry?.coordinates, points)
    const hull = convexHull(points)
    if (hull.length < 4) return []
    return [{
      type: 'Feature',
      properties: {
        ...(feature.properties ?? {}),
        display_only: true,
        is_special_admin: true,
      },
      geometry: { type: 'Polygon', coordinates: [hull] },
    }]
  })
  const rawEnvelopes = { type: 'FeatureCollection', features: envelopeFeatures }
  const blockers = {
    type: 'FeatureCollection',
    features: (provinces?.features ?? []).filter(
      (feature) => !specialKeys.has(featureGeoKey(feature, 'admin1')),
    ),
  }
  if (!blockers.features.length || !rawEnvelopes.features.length) return rawEnvelopes
  const envelopeInput = resolve(workDir, 'special-admin-envelopes.geojson')
  const blockerInput = resolve(workDir, 'special-admin-blockers.geojson')
  const envelopeOutput = resolve(workDir, 'special-admin-envelopes-clean.geojson')
  writeJson(envelopeInput, rawEnvelopes)
  writeJson(blockerInput, blockers)
  const result = spawnSync(
    mapshaperBin,
    [
      envelopeInput,
      '-erase',
      blockerInput,
      'remove-slivers',
      '-clean',
      'rewind',
      'snap-interval=0.000001',
      '-o',
      'format=geojson',
      'precision=0.000001',
      envelopeOutput,
    ],
    { stdio: 'inherit' },
  )
  if (result.status !== 0) throw new Error('Mapshaper failed while clipping special admin envelopes')
  const clipped = readJson(envelopeOutput)
  return {
    type: 'FeatureCollection',
    features: (clipped.features ?? []).flatMap((feature) => {
      const polygon = largestGeometryPolygon(feature.geometry)
      return polygon
        ? [{ ...feature, geometry: { type: 'Polygon', coordinates: polygon } }]
        : []
    }),
  }
}

function buildChinaCoastalDisplayEnvelopes(specialAdmins, cities) {
  const features = (specialAdmins?.features ?? []).map((feature) => ({
    ...feature,
    properties: {
      ...(feature.properties ?? {}),
      display_only: true,
      display_geometry_mode: 'curated-special-admin-envelope',
      component_count_before: geometryPolygons(feature.geometry).length,
      component_count_after: 1,
    },
  }))
  const zhuhai = (cities?.features ?? []).find(
    (feature) => featureGeoKey(feature, 'city') === 'china|guangdong|zhuhai',
  )
  if (!zhuhai) throw new Error('Missing canonical Zhuhai city geometry')
  const points = []
  visitCoordinates(zhuhai.geometry?.coordinates, points)
  const hull = convexHull(points)
  if (hull.length < 4) throw new Error('Unable to create Zhuhai coastal display envelope')
  const rawZhuhai = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          ...(zhuhai.properties ?? {}),
          display_only: true,
          display_geometry_mode: 'curated-coastal-envelope',
          component_count_before: geometryPolygons(zhuhai.geometry).length,
          component_count_after: 1,
        },
        geometry: { type: 'Polygon', coordinates: [hull] },
      },
    ],
  }
  const zhuhaiBlockers = {
    type: 'FeatureCollection',
    features: [
      ...(cities?.features ?? []).filter(
        (feature) => featureGeoKey(feature, 'city') !== 'china|guangdong|zhuhai',
      ),
      ...(specialAdmins?.features ?? []),
    ],
  }
  const clippedZhuhai = eraseDisplayEnvelope(
    rawZhuhai,
    zhuhaiBlockers,
    'china-zhuhai-coastal-display-envelope',
  )
  const polygon = largestGeometryPolygon(clippedZhuhai.features?.[0]?.geometry)
  if (!polygon) throw new Error('Zhuhai coastal display envelope was erased completely')
  features.push({
    ...rawZhuhai.features[0],
    geometry: { type: 'Polygon', coordinates: polygon },
  })
  return { type: 'FeatureCollection', features }
}

function eraseDisplayEnvelope(collection, eraser, name) {
  if (!collection?.features?.length || !eraser?.features?.length) return collection
  const inputPath = resolve(workDir, `${name}-input.geojson`)
  const eraserPath = resolve(workDir, `${name}-eraser.geojson`)
  const outputPath = resolve(workDir, `${name}.geojson`)
  writeJson(inputPath, collection)
  writeJson(eraserPath, eraser)
  const result = spawnSync(
    mapshaperBin,
    [
      inputPath,
      '-erase',
      eraserPath,
      'remove-slivers',
      '-clean',
      'rewind',
      'gap-fill-area=0',
      'snap-interval=0.000001',
      '-o',
      'format=geojson',
      'precision=0.000001',
      outputPath,
    ],
    { stdio: 'inherit' },
  )
  if (result.status !== 0) throw new Error(`Mapshaper failed while erasing ${name}`)
  return readJson(outputPath)
}

function validateChinaCoastalDisplayEnvelopes(envelopes, cities) {
  const expectedKeys = [
    'china|aomen',
    'china|guangdong|zhuhai',
    'china|hongkong',
  ]
  const features = envelopes?.features ?? []
  const keys = features
    .map((feature) =>
      featureGeoKey(feature, String(feature.properties?.level ?? '') === 'city' ? 'city' : 'admin1'),
    )
    .sort()
  const failures = []
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    failures.push(`coastal display envelopes: expected ${expectedKeys.join(', ')}, got ${keys.join(', ')}`)
  }
  for (const feature of features) {
    const level = String(feature.properties?.level ?? '') === 'city' ? 'city' : 'admin1'
    const key = featureGeoKey(feature, level)
    if (feature.geometry?.type !== 'Polygon') {
      failures.push(`coastal display envelope is not Polygon: ${key}`)
    }
    const otherEnvelopes = features.filter((candidate) => candidate !== feature)
    if (otherEnvelopes.some((candidate) => geometriesOverlapArea(feature.geometry, candidate.geometry))) {
      failures.push(`coastal display envelopes overlap: ${key}`)
    }
    const cityBlockers = (cities?.features ?? []).filter(
      (city) => featureGeoKey(city, 'city') !== key,
    )
    if (cityBlockers.some((city) => geometriesOverlapArea(feature.geometry, city.geometry))) {
      failures.push(`coastal display envelope overlaps another city: ${key}`)
    }
  }
  return {
    featureCount: features.length,
    geoKeys: keys,
    singlePolygonCount: features.filter((feature) => feature.geometry?.type === 'Polygon').length,
    failures,
  }
}

function eraseCollection(collection, eraser, name) {
  if (!collection?.features?.length || !eraser?.features?.length) return collection
  const inputPath = resolve(workDir, `${name}-input.geojson`)
  const eraserPath = resolve(workDir, `${name}-eraser.geojson`)
  const outputPath = resolve(workDir, `${name}.geojson`)
  writeJson(inputPath, collection)
  writeJson(eraserPath, eraser)
  const result = spawnSync(
    mapshaperBin,
    [
      inputPath,
      '-erase',
      eraserPath,
      'remove-slivers',
      '-clean',
      'rewind',
      'snap-interval=0.000001',
      '-o',
      'format=geojson',
      'precision=0.000001',
      outputPath,
    ],
    { stdio: 'inherit' },
  )
  if (result.status !== 0) throw new Error(`Mapshaper failed while erasing ${name}`)
  return readJson(outputPath)
}

function convexHull(values) {
  const unique = [...new Map(
    values
      .map(normalizeCoordinate)
      .filter(Boolean)
      .map((point) => [coordinateKey(point), point]),
  ).values()].sort((left, right) => left[0] - right[0] || left[1] - right[1])
  if (unique.length < 3) return []
  const cross = (origin, left, right) =>
    (left[0] - origin[0]) * (right[1] - origin[1]) -
    (left[1] - origin[1]) * (right[0] - origin[0])
  const lower = []
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop()
    }
    lower.push(point)
  }
  const upper = []
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop()
    }
    upper.push(point)
  }
  lower.pop()
  upper.pop()
  const hull = [...lower, ...upper]
  return hull.length >= 3 ? [...hull, hull[0]] : []
}

function largestGeometryPolygon(geometry) {
  return geometryPolygons(geometry).sort((left, right) => polygonArea(right) - polygonArea(left))[0]
}

function validateSpecialAdminEnvelopes(envelopes, provinces, cities) {
  const expectedKeys = ['china|aomen', 'china|hongkong']
  const keys = (envelopes.features ?? []).map((feature) => featureGeoKey(feature, 'admin1')).sort()
  const blockers = (provinces?.features ?? []).filter((feature) => !expectedKeys.includes(featureGeoKey(feature, 'admin1')))
  const failures = []
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    failures.push(`special admin envelopes: expected ${expectedKeys.join(', ')}, got ${keys.join(', ')}`)
  }
  for (const feature of envelopes.features ?? []) {
    const key = featureGeoKey(feature, 'admin1')
    if (feature.geometry?.type !== 'Polygon') failures.push(`special admin envelope is not Polygon: ${key}`)
    if (blockers.some((blocker) => geometriesOverlapArea(feature.geometry, blocker.geometry))) {
      failures.push(`special admin envelope overlaps another province: ${key}`)
    }
    if ((cities?.features ?? []).some((city) => geometriesOverlapArea(feature.geometry, city.geometry))) {
      failures.push(`special admin envelope overlaps a mainland city: ${key}`)
    }
  }
  return { featureCount: envelopes.features?.length ?? 0, geoKeys: keys, failures }
}

function validateLineCollection(collection) {
  const seen = new Set()
  const duplicateSegments = []
  const antimeridianJumps = []
  for (const [featureIndex, feature] of (collection.features ?? []).entries()) {
    const geometry = feature.geometry ?? {}
    const lines = geometry.type === 'LineString'
      ? [geometry.coordinates]
      : geometry.type === 'MultiLineString'
        ? geometry.coordinates
        : []
    for (const [lineIndex, line] of lines.entries()) {
      for (let index = 1; index < (line?.length ?? 0); index += 1) {
        const left = normalizeCoordinate(line[index - 1])
        const right = normalizeCoordinate(line[index])
        if (!left || !right) continue
        const leftKey = coordinateKey(left)
        const rightKey = coordinateKey(right)
        const key = leftKey < rightKey ? `${leftKey}>${rightKey}` : `${rightKey}>${leftKey}`
        if (seen.has(key)) duplicateSegments.push(`${featureIndex}:${lineIndex}:${index}`)
        seen.add(key)
        if (Math.abs(left[0] - right[0]) > 180) {
          antimeridianJumps.push(`${featureIndex}:${lineIndex}:${index}`)
        }
      }
    }
  }
  return { duplicateSegments, antimeridianJumps, segmentCount: seen.size }
}

function buildRegionIndex(collections, specialAdmins) {
  const specialByKey = new Map(
    (specialAdmins.features ?? []).map((feature) => [featureGeoKey(feature, 'admin1'), feature]),
  )
  const sourceLevels = [
    ['world-countries.geojson', 'country'],
    ['world-admin1.geojson', 'admin1'],
    ['china-provinces.geojson', 'admin1'],
    ['china-cities.geojson', 'city'],
  ]
  const matchedControlledAdmin1Keys = new Set()
  const matchedControlledCountryKeys = new Set()
  const regions = sourceLevels.flatMap(([file, level]) =>
    (collections.get(file)?.features ?? []).flatMap((feature) => {
      const displayFeature = specialByKey.get(featureGeoKey(feature, level)) ?? feature
      const bbox = geometryBbox(displayFeature.geometry)
      const geoKey = featureGeoKey(feature, level)
      if (!bbox || !geoKey) return []
      const props = feature.properties ?? {}
      const center = geometryRepresentativePoint(displayFeature.geometry, bbox)
      const countryKey = canonicalCountryKey(
        String(props.country_key ?? geoKey.split('|')[0] ?? ''),
      )
      const controlledLabelPoint =
        level === 'country'
          ? controlledLabelPoints.country.get(geoKey)
          : level === 'admin1' && countryKey === 'china'
            ? controlledLabelPoints.chinaAdmin1.get(geoKey)
            : null
      if (controlledLabelPoint && !pointInGeometry(controlledLabelPoint, displayFeature.geometry)) {
        throw new Error(`Controlled ${level} label is outside its geometry: ${geoKey}`)
      }
      if (controlledLabelPoint && level === 'country') matchedControlledCountryKeys.add(geoKey)
      if (controlledLabelPoint && level === 'admin1') matchedControlledAdmin1Keys.add(geoKey)
      const labelPoint = controlledLabelPoint ?? center
      return [
        {
          level,
          geo_key: geoKey,
          parent_geo_key: String(props.parent_geo_key ?? ''),
          country_key: countryKey,
          display_name: String(props.display_name ?? props.name ?? geoKey),
          name: String(props.name ?? props.display_name ?? geoKey),
          center,
          label_point: labelPoint,
          area: roundCoord(geometryArea(displayFeature.geometry)),
          bbox: bbox.map(roundCoord),
        },
      ]
    }),
  )
  const unmatchedControlledCountryKeys = [...controlledLabelPoints.country.keys()].filter(
    (geoKey) => !matchedControlledCountryKeys.has(geoKey),
  )
  if (unmatchedControlledCountryKeys.length) {
    throw new Error(
      `Controlled country labels have no rendered geometry: ${unmatchedControlledCountryKeys.join(', ')}`,
    )
  }
  const unmatchedControlledAdmin1Keys = [...controlledLabelPoints.chinaAdmin1.keys()].filter(
    (geoKey) => !matchedControlledAdmin1Keys.has(geoKey),
  )
  if (unmatchedControlledAdmin1Keys.length) {
    throw new Error(
      `Controlled China admin1 labels have no rendered geometry: ${unmatchedControlledAdmin1Keys.join(', ')}`,
    )
  }
  return { generatedAt: new Date().toISOString(), regions }
}

function loadControlledLabelPoints() {
  if (!existsSync(controlledLabelsPath)) {
    throw new Error(`Missing controlled labels: ${controlledLabelsPath}`)
  }
  const rawLabels = readJson(controlledLabelsPath)
  const { collection: labels } = applyControlledLabelPointOverrides(rawLabels)
  const country = new Map()
  const chinaAdmin1 = new Map()
  for (const feature of labels.features ?? []) {
    const props = feature.properties ?? {}
    const isCountry = props.level === 'country'
    const isChinaAdmin1 =
      props.level === 'admin1' && canonicalCountryKey(String(props.country_key ?? '')) === 'china'
    if (!isCountry && !isChinaAdmin1) continue
    const geoKey = String(props.geo_key ?? '')
    const point =
      feature.geometry?.type === 'Point' ? normalizeCoordinate(feature.geometry.coordinates) : null
    if (!geoKey || !point) {
      throw new Error(`Invalid controlled ${props.level} label: ${geoKey || '<missing geo_key>'}`)
    }
    const points = isCountry ? country : chinaAdmin1
    if (points.has(geoKey)) {
      throw new Error(`Duplicate controlled ${props.level} label: ${geoKey}`)
    }
    points.set(geoKey, point.map(roundCoord))
  }
  if (!country.size) throw new Error('No controlled country labels found')
  if (!chinaAdmin1.size) throw new Error('No controlled China admin1 labels found')
  return { country, chinaAdmin1 }
}

function validateCollection(collection, spec) {
  const geoKeys = new Set()
  const result = {
    missingGeoKeys: [],
    duplicateGeoKeys: [],
    nonPolygonGeometries: [],
    unclosedRings: [],
    zeroLengthSegments: [],
    selfIntersections: [],
    maxSegmentDegrees: 0,
  }
  for (const [featureIndex, feature] of (collection.features ?? []).entries()) {
    const key = featureGeoKey(feature, spec.level)
    const label = key || `feature-${featureIndex}`
    if (!key) result.missingGeoKeys.push(label)
    if (geoKeys.has(key)) result.duplicateGeoKeys.push(label)
    geoKeys.add(key)
    if (!['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) {
      result.nonPolygonGeometries.push(label)
      continue
    }
    for (const [ringIndex, ring] of geometryRings(feature.geometry).entries()) {
      if (ring.length < 4 || !samePoint(ring[0], ring[ring.length - 1])) {
        result.unclosedRings.push(`${label}#${ringIndex}`)
      }
      for (let index = 1; index < ring.length; index += 1) {
        const segmentLength = pointDistance(ring[index - 1], ring[index])
        result.maxSegmentDegrees = Math.max(result.maxSegmentDegrees, segmentLength)
        if (segmentLength === 0) result.zeroLengthSegments.push(`${label}#${ringIndex}:${index}`)
      }
      if (ringSelfIntersects(ring)) result.selfIntersections.push(`${label}#${ringIndex}`)
    }
  }
  return result
}

function validateParentRelationships(targetReport) {
  const provinceCollection = readJson(resolve(renderDir, 'china-provinces.geojson'))
  const cityCollection = readJson(resolve(renderDir, 'china-cities.geojson'))
  const provinceKeys = new Set(
    provinceCollection.features.map((feature) => featureGeoKey(feature, 'admin1')),
  )
  const orphanCities = cityCollection.features.flatMap((feature) => {
    const parent = String(feature.properties?.parent_geo_key ?? '').trim()
    return parent && provinceKeys.has(parent) ? [] : [featureGeoKey(feature, 'city')]
  })
  targetReport.parentRelationships = { orphanChinaCities: orphanCities }
  if (orphanCities.length) {
    throw new Error(`Found ${orphanCities.length} China city boundaries without a province parent`)
  }
}

function ringSelfIntersects(ring) {
  const count = ring.length - 1
  if (count < 4) return false
  const gridSize = Math.max(4, Math.ceil(Math.sqrt(count)))
  const xs = ring.map((point) => point[0])
  const ys = ring.map((point) => point[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const cellWidth = Math.max((maxX - minX) / gridSize, 1e-9)
  const cellHeight = Math.max((maxY - minY) / gridSize, 1e-9)
  const cells = new Map()
  for (let index = 0; index < count; index += 1) {
    const left = ring[index]
    const right = ring[index + 1]
    const x0 = Math.floor((Math.min(left[0], right[0]) - minX) / cellWidth)
    const x1 = Math.floor((Math.max(left[0], right[0]) - minX) / cellWidth)
    const y0 = Math.floor((Math.min(left[1], right[1]) - minY) / cellHeight)
    const y1 = Math.floor((Math.max(left[1], right[1]) - minY) / cellHeight)
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        const cellKey = `${x}|${y}`
        if (!cells.has(cellKey)) cells.set(cellKey, [])
        cells.get(cellKey).push(index)
      }
    }
  }
  const checked = new Set()
  for (const indices of cells.values()) {
    for (let leftIndex = 0; leftIndex < indices.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < indices.length; rightIndex += 1) {
        const first = indices[leftIndex]
        const second = indices[rightIndex]
        if (Math.abs(first - second) <= 1 || (first === 0 && second === count - 1)) continue
        const pairKey = `${first}|${second}`
        if (checked.has(pairKey)) continue
        checked.add(pairKey)
        if (segmentsProperlyIntersect(ring[first], ring[first + 1], ring[second], ring[second + 1])) {
          return true
        }
      }
    }
  }
  return false
}

function segmentsProperlyIntersect(a, b, c, d) {
  if (!bboxIntersects(a, b, c, d)) return false
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)
  return o1 * o2 < 0 && o3 * o4 < 0
}

function bboxIntersects(a, b, c, d) {
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

function isMainlandChinaCity(props) {
  const values = [props.geo_key, props.parent_geo_key, props.province_key, ...(props.keys ?? [])]
    .map((value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ''))
  return !values.some((value) =>
    ['hongkong', 'macao', 'macau', 'taiwan', '香港', '澳门', '台湾'].some((blocked) =>
      value.includes(blocked),
    ),
  )
}

function featureGeoKey(feature, level) {
  const props = feature.properties ?? {}
  const explicit = String(props.geo_key ?? '').trim()
  if (explicit) return explicit
  if (level === 'country') return String(props.country_key ?? props.region_key ?? '').trim()
  return `${String(props.country_key ?? '').trim()}|${String(props.region_key ?? '').trim()}`
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

function geometryRings(geometry) {
  return geometryPolygons(geometry).flatMap((polygon) => polygon)
}

function samePoint(left, right) {
  return left?.[0] === right?.[0] && left?.[1] === right?.[1]
}

function pointDistance(left, right) {
  return Math.hypot(right[0] - left[0], right[1] - left[1])
}

function canonicalCountryKey(value) {
  const key = String(value ?? '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
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

function geometryArea(geometry) {
  return geometryPolygons(geometry).reduce((sum, polygon) => sum + polygonArea(polygon), 0)
}

function polygonArea(polygon) {
  if (!Array.isArray(polygon) || !polygon.length) return 0
  const ringArea = (ring) => {
    let area = 0
    for (let index = 0; index < ring.length - 1; index += 1) {
      const left = ring[index]
      const right = ring[index + 1]
      area += Number(left?.[0] ?? 0) * Number(right?.[1] ?? 0) - Number(right?.[0] ?? 0) * Number(left?.[1] ?? 0)
    }
    return Math.abs(area / 2)
  }
  return Math.max(0, ringArea(polygon[0] ?? []) - polygon.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0))
}

function geometryRepresentativePoint(geometry, suppliedBbox = geometryBbox(geometry)) {
  const polygon = largestGeometryPolygon(geometry)
  if (!polygon || !suppliedBbox) return suppliedBbox ? bboxCenter(suppliedBbox) : null
  const ring = polygon[0] ?? []
  const centroid = ringCentroid(ring)
  const bboxMiddle = bboxCenter(suppliedBbox)
  for (const candidate of [centroid, bboxMiddle]) {
    if (candidate && pointInPolygonGeometry(candidate, polygon)) return candidate.map(roundCoord)
  }
  const [west, south, east, north] = suppliedBbox
  const steps = 8
  for (let x = 1; x < steps; x += 1) {
    for (let y = 1; y < steps; y += 1) {
      const candidate = [west + ((east - west) * x) / steps, south + ((north - south) * y) / steps]
      if (pointInPolygonGeometry(candidate, polygon)) return candidate.map(roundCoord)
    }
  }
  return normalizeCoordinate(ring[0]) ?? bboxMiddle.map(roundCoord)
}

function ringCentroid(ring) {
  let twiceArea = 0
  let x = 0
  let y = 0
  for (let index = 0; index < ring.length - 1; index += 1) {
    const left = ring[index]
    const right = ring[index + 1]
    const cross = left[0] * right[1] - right[0] * left[1]
    twiceArea += cross
    x += (left[0] + right[0]) * cross
    y += (left[1] + right[1]) * cross
  }
  return Math.abs(twiceArea) > 1e-12 ? [x / (3 * twiceArea), y / (3 * twiceArea)] : null
}

function bboxCenter(bbox) {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
}

function pointInGeometry(point, geometry) {
  return geometryPolygons(geometry).some((polygon) => pointInPolygonGeometry(point, polygon))
}

function pointInPolygonGeometry(point, polygon) {
  if (!pointInRing(point, polygon[0] ?? [])) return false
  return polygon.slice(1).every((ring) => !pointInRing(point, ring))
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

function geometriesOverlapArea(leftGeometry, rightGeometry) {
  const leftBbox = geometryBbox(leftGeometry)
  const rightBbox = geometryBbox(rightGeometry)
  if (!leftBbox || !rightBbox || !bboxRangesOverlap(leftBbox, rightBbox)) return false
  // The eraser and the six-decimal GeoJSON writer can leave intersections that
  // differ by a few nanodegrees along a shared edge. Those are zero-area numeric
  // remnants, not polygon overlap. Interior representative points still catch
  // meaningful containment while allowing the Hong Kong/Macau display envelopes
  // to share a boundary with Guangdong and Zhuhai.
  const leftPoint = geometryRepresentativePoint(leftGeometry, leftBbox)
  const rightPoint = geometryRepresentativePoint(rightGeometry, rightBbox)
  return Boolean(
    (leftPoint && pointInGeometry(leftPoint, rightGeometry)) ||
    (rightPoint && pointInGeometry(rightPoint, leftGeometry)),
  )
}

function bboxRangesOverlap(left, right) {
  return left[0] < right[2] && left[2] > right[0] && left[1] < right[3] && left[3] > right[1]
}

function bboxDrift(left, right) {
  if (!left || !right) return Infinity
  return Math.max(...left.map((value, index) => Math.abs(value - right[index])))
}

function visitCoordinates(value, points) {
  if (!Array.isArray(value)) return
  if (typeof value[0] === 'number' && typeof value[1] === 'number') {
    points.push([value[0], value[1]])
    return
  }
  value.forEach((item) => visitCoordinates(item, points))
}

function roundCoord(value) {
  return Math.round(value * 1e6) / 1e6
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value)}\n`)
}
