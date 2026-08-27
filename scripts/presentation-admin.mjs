import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildPresentationNameResolver, cleanPresentationLabel } from './presentation-names.mjs'

export const PRESENTATION_ADMIN1_ZOOM = Object.freeze({
  adm1_le25: 3.85,
  adm1_26_80: 4.25,
  adm1_81_160: 4.75,
  adm1_gt160: 5.25,
  china: 3.85,
})

export const PRESENTATION_ADMIN2_ZOOM = Object.freeze({
  sparse: 6.35,
  standard: 6.85,
  dense: 7.3,
  veryDense: 7.7,
  china: 6.35,
})

export const PRESENTATION_ADMIN2_BOUNDARY_ZOOM = 6.35

const ADMIN1_EXCEPTIONS = Object.freeze({
  china: { rule: 'local-china-province-standard', sourceLevel: 'local_CHN_admin1' },
  france: { rule: '13-mainland-regions', sourceLevel: 'CGAZ_ADM1' },
  italy: { rule: '20-regions-promoted-from-cgaz-adm2', sourceLevel: 'CGAZ_ADM2' },
  unitedkingdom: { rule: 'four-constituent-countries', sourceLevel: 'CGAZ_ADM1' },
  unitedsofamerica: { rule: 'state-level', sourceLevel: 'CGAZ_ADM1' },
  spain: { rule: 'autonomous-communities', sourceLevel: 'CGAZ_ADM1' },
})

const ADMIN1_GEO_KEY_OVERRIDES = Object.freeze({
  // The pinned CGAZ feature is named like the territory, while the official
  // Census municipality is Northern Islands. Keep the presentation parent key
  // aligned with the canonical ADM1 key used by its election districts.
  'northernmarianaislands|northernmarianaislands': 'northernmarianaislands|northernislands',
})

const ADMIN2_PROFILE_OVERRIDES = Object.freeze({
  unitedsofamerica: 'dense',
  unitedkingdom: 'dense',
  romania: 'veryDense',
  netherlands: 'veryDense',
  croatia: 'veryDense',
  france: 'standard',
  italy: 'standard',
  china: 'china',
})

const EGYPT_ADM1_REGRESSION = Object.freeze([
  { aliases: ['asyut', 'assiut'], expectedChinese: '艾斯尤特' },
  { aliases: ['sohag', 'suhaj'], expectedChinese: '索哈杰' },
  { aliases: ['qena', 'qina'], expectedChinese: '基纳' },
  { aliases: ['aswan'], expectedChinese: '阿斯旺' },
  { aliases: ['redsea'], expectedChinese: '红海' },
])

export function admin1DetailProfile(unitCount) {
  if (unitCount <= 25) return 'adm1_le25'
  if (unitCount <= 80) return 'adm1_26_80'
  if (unitCount <= 160) return 'adm1_81_160'
  return 'adm1_gt160'
}

export function admin2DetailProfile({ countryKey, unitCount, areaKm2 }) {
  const override = ADMIN2_PROFILE_OVERRIDES[countryKey]
  if (override) return override
  const density = areaKm2 > 0 ? unitCount / (areaKm2 / 100000) : 0
  if (unitCount > 2000 || density >= 150) return 'veryDense'
  if (unitCount > 800 || density >= 50) return 'dense'
  if (unitCount <= 25 || density < 1) return 'sparse'
  return 'standard'
}

export function buildPresentationAdministration(options) {
  const {
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
    nameQualityReportPath,
  } = options

  const cgazAdmin1Path = join(workDir, 'presentation-cgaz-adm1.geojson')
  run(mapshaperBin, [
    cgazAdmin1ShapePath,
    '-quiet',
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
    cgazAdmin1Path,
  ])

  const countries = readJson(worldCountriesPath)
  const cgazAdmin1 = readJson(cgazAdmin1Path)
  const businessAdmin1 = readJson(worldAdmin1Path)
  const chinaProvinces = readJson(chinaProvincesPath)
  const chinaCities = readJson(chinaCitiesPath)
  const worldCities = readJson(worldCitiesPath)
  const nameResolver = buildPresentationNameResolver({
    countries,
    controlledLabels,
    canonicalAdmin1: businessAdmin1,
    cldrSnapshotPath,
    officialOverridesPath: officialNameOverridesPath,
  })
  const countryKeyByIso = new Map(
    (countries.features ?? []).flatMap((feature) => {
      const iso = String(feature.properties?.['ISO3166-1-Alpha-3'] ?? '').toUpperCase()
      const countryKey = canonicalCountryKey(feature.properties?.country_key)
      return iso && iso !== '-99' && countryKey ? [[iso, countryKey]] : []
    }),
  )
  countryKeyByIso.set('FRA', 'france')
  countryKeyByIso.set('NOR', 'norway')
  countryKeyByIso.set('XKX', 'kosovo')
  countryKeyByIso.set('TWN', 'china')

  const admin1Features = []
  const admin1Candidates = []
  const admin1Keys = new Set()
  const sourceSelection = new Map()
  const addAdmin1 = (feature, metadata) => {
    const countryKey = metadata.countryKey
    const displayNameLocal = cleanPresentationLabel(
      metadata.displayNameLocal ?? metadata.displayNameEn ?? '',
    )
    const displayNameEn = cleanPresentationLabel(metadata.displayNameEn ?? displayNameLocal)
    if (!countryKey || !renderablePolygonGeometry(feature.geometry)) return
    admin1Candidates.push({
      feature,
      metadata,
      countryKey,
      displayNameLocal,
      displayNameEn,
      sourceAliases: sourceNameAliases(feature.properties),
      sourceGeoKey: String(metadata.sourceGeoKey ?? ''),
    })
  }

  const materializeAdmin1 = () => {
    const candidates = admin1Candidates.map((candidate) => {
      const generatedGeoKey = `${candidate.countryKey}|${normalizeKey(candidate.displayNameEn || candidate.displayNameLocal || candidate.sourceAliases[0]) || 'region'}`
      const baseGeoKey = ADMIN1_GEO_KEY_OVERRIDES[generatedGeoKey] ?? generatedGeoKey
      const geoKey = uniqueGeoKey(baseGeoKey, admin1Keys)
      return {
        ...candidate,
        geoKey,
        spatialKey: candidate.sourceGeoKey || geoKey,
      }
    })
    nameResolver.prepareSpatialMatches(
      candidates.map((candidate) => ({
        countryKey: candidate.countryKey,
        spatialKey: candidate.spatialKey,
        geometry: candidate.feature.geometry,
      })),
    )
    for (const candidate of candidates) {
      const {
        feature,
        metadata,
        countryKey,
        displayNameLocal,
        displayNameEn,
        sourceAliases,
        sourceGeoKey,
        geoKey,
        spatialKey,
      } = candidate
      const names = nameResolver.resolve({
        countryKey,
        presentationLevel: 'adm1',
        geoKey,
        sourceGeoKey,
        localName: displayNameLocal,
        aliases: [displayNameEn, ...sourceAliases],
        spatialKey,
      })
      admin1Features.push({
        type: 'Feature',
        id: geoKey,
        properties: {
          country_key: countryKey,
          geo_key: geoKey,
          parent_geo_key: countryKey,
          presentation_level: 'adm1',
          detail_profile: '',
          source_level: metadata.sourceLevel,
          source_geo_key: sourceGeoKey,
          display_name: names.display_name_zh || names.display_name_local,
          display_name_local: names.display_name_local,
          display_name_zh: names.display_name_zh,
          display_name_en: names.display_name_en,
          name_zh_source: names.name_zh_source,
          name_zh_verified: names.name_zh_verified,
          name_zh_reference_key: names.name_zh_reference_key ?? '',
          subdivision_code: names.subdivision_code ?? '',
          zh_draft_status: names.zh_draft_status ?? '',
          area_km2: round(geometryAreaKm2(feature.geometry), 3),
          unit_count: 0,
          density_per_100k_km2: 0,
          priority: 0,
        },
        geometry: feature.geometry,
      })
      if (!sourceSelection.has(countryKey)) {
        sourceSelection.set(countryKey, {
          sourceLevel: metadata.sourceLevel,
          rule: ADMIN1_EXCEPTIONS[countryKey]?.rule ?? 'default-cgaz-adm1',
        })
      }
    }
  }

  for (const feature of cgazAdmin1.features ?? []) {
    const iso = String(feature.properties?.shapeGroup ?? '').toUpperCase()
    const countryKey = countryKeyByIso.get(iso)
    if (!countryKey || countryKey === 'china' || countryKey === 'italy') continue
    addAdmin1(feature, {
      countryKey,
      displayNameLocal: feature.properties?.shapeName ?? feature.properties?.shapeID,
      displayNameEn: feature.properties?.shapeName ?? feature.properties?.shapeID,
      sourceLevel: 'CGAZ_ADM1',
      sourceGeoKey: feature.properties?.shapeID,
    })
  }

  for (const feature of worldCities.features ?? []) {
    if (feature.properties?.country_key !== 'italy') continue
    addAdmin1(feature, {
      countryKey: 'italy',
      displayNameLocal: feature.properties?.display_name ?? feature.properties?.name,
      displayNameEn: feature.properties?.name ?? feature.properties?.display_name,
      sourceLevel: 'CGAZ_ADM2',
      sourceGeoKey: feature.properties?.geo_key,
    })
  }

  for (const feature of chinaProvinces.features ?? []) {
    addAdmin1(feature, {
      countryKey: 'china',
      displayNameLocal: feature.properties?.display_name ?? feature.properties?.name,
      displayNameEn: feature.properties?.name ?? feature.properties?.display_name,
      sourceLevel: 'local_CHN_admin1',
      sourceGeoKey: feature.properties?.geo_key,
    })
  }

  const admin1ByCountry = groupBy(admin1Candidates, (candidate) => candidate.countryKey)
  const fallbackAdmin1ByCountry = groupBy(businessAdmin1.features ?? [], (feature) =>
    canonicalCountryKey(feature.properties?.country_key),
  )
  for (const country of countries.features ?? []) {
    const countryKey = canonicalCountryKey(country.properties?.country_key)
    if (!countryKey || admin1ByCountry.has(countryKey)) continue
    const fallbackFeatures = fallbackAdmin1ByCountry.get(countryKey) ?? []
    for (const feature of fallbackFeatures.length ? fallbackFeatures : [country]) {
      addAdmin1(feature, {
        countryKey,
        displayNameLocal:
          feature.properties?.display_name ??
          feature.properties?.name ??
          country.properties?.display_name ??
          countryKey,
        displayNameEn:
          feature.properties?.name ??
          feature.properties?.display_name ??
          country.properties?.display_name ??
          countryKey,
        sourceLevel: fallbackFeatures.length ? 'local_ADM1_fallback' : 'country_promoted',
        sourceGeoKey: feature.properties?.geo_key ?? feature.properties?.region_key,
      })
    }
  }

  materializeAdmin1()
  const manyToOneNameAudit = rejectVerifiedManyToOneNames(admin1Features)

  const finalAdmin1ByCountry = groupBy(admin1Features, (feature) => feature.properties.country_key)
  for (const [countryKey, features] of finalAdmin1ByCountry) {
    const profile = countryKey === 'china' ? 'china' : admin1DetailProfile(features.length)
    features.forEach((feature) => {
      feature.properties.detail_profile = profile
      feature.properties.unit_count = features.length
      feature.properties.priority = labelPriority(feature)
    })
  }

  assertCountryCount(finalAdmin1ByCountry, 'france', 13)
  assertCountryCount(finalAdmin1ByCountry, 'italy', 20)
  assertCountryCount(finalAdmin1ByCountry, 'germany', 16)
  assertCountryCount(finalAdmin1ByCountry, 'unitedkingdom', 4)

  const countryAreaByKey = new Map(
    (countries.features ?? []).map((feature) => [
      canonicalCountryKey(feature.properties?.country_key),
      geometryAreaKm2(feature.geometry),
    ]),
  )
  const admin1SubdivisionCodesByCountry = new Map()
  for (const feature of admin1Features) {
    const props = feature.properties ?? {}
    const subdivisionCode = String(props.subdivision_code ?? '').trim()
    if (!subdivisionCode || props.name_zh_verified !== true) continue
    const codes = admin1SubdivisionCodesByCountry.get(props.country_key) ?? new Set()
    codes.add(subdivisionCode)
    admin1SubdivisionCodesByCountry.set(props.country_key, codes)
  }
  const admin2Candidates = []
  for (const feature of worldCities.features ?? []) {
    const countryKey = canonicalCountryKey(feature.properties?.country_key)
    if (!countryKey || countryKey === 'china' || countryKey === 'italy') continue
    admin2Candidates.push({
      feature,
      countryKey,
      displayNameLocal:
        feature.properties?.display_name_local ??
        feature.properties?.display_name ??
        feature.properties?.name,
      displayNameEn:
        feature.properties?.display_name_en ??
        feature.properties?.name ??
        feature.properties?.display_name,
      displayNameZh: feature.properties?.display_name_zh,
      nameZhSource: feature.properties?.name_zh_source,
      nameZhVerified: feature.properties?.name_zh_verified,
      subdivisionCode: feature.properties?.subdivision_code,
      sourceLevel: feature.properties?.source_level ?? 'CGAZ_ADM2',
      sourceGeoKey: feature.properties?.geo_key,
      edgeSource: 'world-city',
    })
  }
  for (const feature of businessAdmin1.features ?? []) {
    if (feature.properties?.country_key !== 'italy') continue
    admin2Candidates.push({
      feature,
      countryKey: 'italy',
      displayNameLocal: feature.properties?.display_name ?? feature.properties?.name,
      displayNameEn: feature.properties?.name ?? feature.properties?.display_name,
      sourceLevel: 'local_ADM1_promoted_to_presentation_ADM2',
      sourceGeoKey: `italy|${feature.properties?.region_key ?? ''}`,
      edgeSource: 'world-admin1',
    })
  }
  for (const feature of chinaCities.features ?? []) {
    admin2Candidates.push({
      feature,
      countryKey: 'china',
      displayNameLocal: feature.properties?.display_name ?? feature.properties?.name,
      displayNameEn: feature.properties?.name ?? feature.properties?.display_name,
      sourceLevel: 'local_CHN_city',
      sourceGeoKey: feature.properties?.geo_key,
      edgeSource: 'china-city',
    })
  }

  const admin2Features = []
  const admin2Keys = new Set()
  const unmatchedAdmin2 = []
  for (const candidate of admin2Candidates) {
    const parents = finalAdmin1ByCountry.get(candidate.countryKey) ?? []
    const parent = presentationParent(candidate.feature.geometry, parents, candidate.sourceGeoKey)
    if (!parent) {
      unmatchedAdmin2.push(String(candidate.sourceGeoKey ?? candidate.displayNameEn ?? ''))
      continue
    }
    const displayNameLocal = cleanPresentationLabel(
      candidate.displayNameLocal ?? candidate.displayNameEn ?? '',
    )
    const displayNameEn = cleanPresentationLabel(candidate.displayNameEn ?? displayNameLocal)
    if (!renderablePolygonGeometry(candidate.feature.geometry)) continue
    const sourceAliases = sourceNameAliases(candidate.feature.properties)
    const baseGeoKey = `${parent.properties.geo_key}|${normalizeKey(displayNameEn || displayNameLocal || sourceAliases[0]) || 'region'}`
    const sourceGeoKey = String(candidate.sourceGeoKey ?? '')
    const geoKey = uniqueGeoKey(sourceGeoKey || baseGeoKey, admin2Keys)
    const suppliedChinese = cleanPresentationLabel(candidate.displayNameZh ?? '')
    const names =
      suppliedChinese && candidate.nameZhVerified && candidate.nameZhSource
        ? {
            display_name_zh: suppliedChinese,
            display_name_local: displayNameLocal,
            display_name_en: displayNameEn,
            name_zh_source: String(candidate.nameZhSource),
            name_zh_verified: true,
            name_zh_reference_key: sourceGeoKey,
            subdivision_code: String(candidate.subdivisionCode ?? ''),
            zh_draft_status: '',
          }
        : nameResolver.resolve({
            countryKey: candidate.countryKey,
            presentationLevel: 'adm2',
            geoKey,
            sourceGeoKey,
            localName: displayNameLocal,
            aliases: [displayNameEn, ...sourceAliases],
            blockedCldrSubdivisionCodes: admin1SubdivisionCodesByCountry.get(
              candidate.countryKey,
            ),
          })
    admin2Features.push({
      type: 'Feature',
      id: geoKey,
      properties: {
        country_key: candidate.countryKey,
        geo_key: geoKey,
        parent_geo_key: parent.properties.geo_key,
        presentation_level: 'adm2',
        detail_profile: '',
        source_level: candidate.sourceLevel,
        source_geo_key: sourceGeoKey,
        edge_source: candidate.edgeSource,
        display_name: names.display_name_zh || names.display_name_local,
        display_name_local: names.display_name_local,
        display_name_zh: names.display_name_zh,
        display_name_en: names.display_name_en,
        name_zh_source: names.name_zh_source,
        name_zh_verified: names.name_zh_verified,
        name_zh_reference_key: names.name_zh_reference_key ?? '',
        subdivision_code: names.subdivision_code ?? '',
        zh_draft_status: names.zh_draft_status ?? '',
        area_km2: round(geometryAreaKm2(candidate.feature.geometry), 3),
        unit_count: 0,
        density_per_100k_km2: 0,
        priority: 0,
      },
      geometry: candidate.feature.geometry,
    })
  }

  const admin2ByCountry = groupBy(admin2Features, (feature) => feature.properties.country_key)
  for (const [countryKey, features] of admin2ByCountry) {
    const areaKm2 = Number(countryAreaByKey.get(countryKey) ?? 0)
    const density = areaKm2 > 0 ? features.length / (areaKm2 / 100000) : 0
    const profile = admin2DetailProfile({ countryKey, unitCount: features.length, areaKm2 })
    features.forEach((feature) => {
      feature.properties.detail_profile = profile
      feature.properties.unit_count = features.length
      feature.properties.density_per_100k_km2 = round(density, 3)
      feature.properties.priority = labelPriority(feature)
    })
  }

  const admin1BoundaryResult = internalBoundaryCollection(admin1Features, 'adm1')
  const childBySource = new Map(
    admin2Features
      .map((feature) => [
        `${feature.properties.edge_source}|${feature.properties.source_geo_key}`,
        feature,
      ])
      .filter(([, feature]) => feature.properties.source_geo_key),
  )
  const edgeSources = [
    { id: 'world-city', collection: readJson(worldCityEdgesPath) },
    { id: 'world-admin1', collection: readJson(worldAdmin1LinesPath) },
    { id: 'china-city', collection: readJson(chinaCityLinesPath) },
  ]
  const admin2BoundaryResult = filteredAdmin2BoundaryCollection(
    edgeSources,
    childBySource,
    admin1BoundaryResult.segmentKeys,
  )

  const admin1Labels = labelCollection(admin1Features)
  const admin2Labels = labelCollection(admin2Features)
  const countryPolicies = [...new Set([...finalAdmin1ByCountry.keys(), ...admin2ByCountry.keys()])]
    .sort()
    .map((countryKey) => {
      const admin1 = finalAdmin1ByCountry.get(countryKey) ?? []
      const admin2 = admin2ByCountry.get(countryKey) ?? []
      const selection = sourceSelection.get(countryKey) ?? {
        sourceLevel: 'unknown',
        rule: 'unknown',
      }
      return {
        countryKey,
        sourceLevel: selection.sourceLevel,
        exceptionRule: selection.rule,
        admin1Count: admin1.length,
        admin1VerifiedChineseCount: verifiedChineseCount(admin1),
        admin1OriginalFallbackCount: originalNameFallbackCount(admin1),
        admin1DetailProfile: admin1[0]?.properties.detail_profile ?? '',
        admin1MinZoom: PRESENTATION_ADMIN1_ZOOM[admin1[0]?.properties.detail_profile] ?? null,
        admin2Count: admin2.length,
        admin2VerifiedChineseCount: verifiedChineseCount(admin2),
        admin2OriginalFallbackCount: originalNameFallbackCount(admin2),
        admin2DetailProfile: admin2[0]?.properties.detail_profile ?? '',
        admin2BoundaryMinZoom: admin2.length ? PRESENTATION_ADMIN2_BOUNDARY_ZOOM : null,
        admin2LabelMinZoom: admin2.length
          ? presentationLabelMinZoom(PRESENTATION_ADMIN2_ZOOM[admin2[0]?.properties.detail_profile])
          : null,
        // Kept for compatibility with older reports; this is the label threshold.
        admin2MinZoom: PRESENTATION_ADMIN2_ZOOM[admin2[0]?.properties.detail_profile] ?? null,
        admin2DensityPer100kKm2: admin2[0]?.properties.density_per_100k_km2 ?? 0,
      }
    })

  const nameResolution = nameResolver.report()
  const egyptNameRegression = egyptNameRegressionAudit(admin1Features)
  const report = {
    policyVersion: 1,
    defaultAdmin1Source: 'CGAZ_ADM1',
    exceptions: ADMIN1_EXCEPTIONS,
    admin1Count: admin1Features.length,
    admin2Count: admin2Features.length,
    unmatchedAdmin2Count: unmatchedAdmin2.length,
    unmatchedAdmin2Sample: unmatchedAdmin2.slice(0, 20),
    detailZooms: {
      admin1: PRESENTATION_ADMIN1_ZOOM,
      admin2Boundary: PRESENTATION_ADMIN2_BOUNDARY_ZOOM,
      admin2: PRESENTATION_ADMIN2_ZOOM,
    },
    labelCoverage: {
      admin1: labelCoverage(admin1Labels),
      admin2: labelCoverage(admin2Labels),
    },
    nameCoverage: {
      admin1: nameCoverage(admin1Labels),
      admin2: nameCoverage(admin2Labels),
    },
    languageTransitionAudit: {
      chinaAdmin1NonChineseDisplayCount: nonChineseChinaDisplayCount(admin1Labels),
      chinaAdmin2NonChineseDisplayCount: nonChineseChinaDisplayCount(admin2Labels),
    },
    labelSanitizationAudit: {
      corruptVisibleLabelCount: corruptVisibleLabelCount([admin1Labels, admin2Labels]),
      hiddenLabelCount:
        admin1Labels.features.length -
        labelCoverage(admin1Labels).named +
        (admin2Labels.features.length - labelCoverage(admin2Labels).named),
    },
    nameResolution,
    nameRegressionAudit: {
      egypt: egyptNameRegression,
    },
    manyToOneNameAudit,
    edgeAudit: {
      admin1SegmentCount: admin1BoundaryResult.segmentKeys.size,
      admin2SegmentCount: admin2BoundaryResult.segmentKeys.size,
      rejectedCrossParentSegments: admin2BoundaryResult.rejectedCrossParentSegments,
      rejectedCrossSourceParentSegments: admin2BoundaryResult.rejectedCrossSourceParentSegments,
      removedAdm1CoincidentSegments: admin2BoundaryResult.removedAdm1CoincidentSegments,
      removedDuplicateSegments: admin2BoundaryResult.removedDuplicateSegments,
      sourceSharedSegmentCount: admin2BoundaryResult.expectedSourceSegmentKeys.size,
      sourceSharedEdgeMissingCount: admin2BoundaryResult.missingSourceSegmentCount,
      coincidentSegmentCount: intersectionSize(
        admin1BoundaryResult.segmentKeys,
        admin2BoundaryResult.segmentKeys,
      ),
    },
    countryPolicies,
  }
  if (nameQualityReportPath) {
    writeFileSync(nameQualityReportPath, `${JSON.stringify(report, null, 2)}\n`)
  }
  if (
    report.nameCoverage.admin1.unverifiedChineseFieldCount !== 0 ||
    report.nameCoverage.admin2.unverifiedChineseFieldCount !== 0
  ) {
    throw new Error('Presentation administration contains an unverified Chinese name')
  }
  if (report.nameCoverage.admin1.verifiedChineseRate < 0.97) {
    throw new Error(
      `Presentation ADM1 verified Chinese coverage is below 97%: ${report.nameCoverage.admin1.verifiedChineseRate}; ${JSON.stringify({ sourceDistribution: report.nameCoverage.admin1.sourceDistribution, nameResolution: report.nameResolution, fallbackSample: report.nameCoverage.admin1.originalFallbackSample })}`,
    )
  }
  // Exact CLDR names that are already claimed by a verified ADM1 unit are
  // intentionally rejected at ADM2. This prevents names such as Washington
  // County from inheriting the state label 华盛顿州 while retaining verified
  // ADM2 CLDR names whose codes do not collide with the parent level.
  if (report.nameCoverage.admin2.verifiedChineseRate < 0.034) {
    throw new Error(
      `Presentation ADM2 verified Chinese coverage regressed: ${report.nameCoverage.admin2.verifiedChineseRate}`,
    )
  }
  if (report.labelSanitizationAudit.corruptVisibleLabelCount !== 0) {
    throw new Error('Presentation administration contains a visible corrupt label')
  }
  if (report.manyToOneNameAudit.remainingVerifiedDuplicateCount !== 0) {
    throw new Error(
      `Presentation administration contains ${report.manyToOneNameAudit.remainingVerifiedDuplicateCount} verified ADM1 many-to-one name assignments`,
    )
  }
  if (
    report.nameRegressionAudit.egypt.admin1Count !== 27 ||
    report.nameRegressionAudit.egypt.redSeaChineseCount !== 1 ||
    report.nameRegressionAudit.egypt.mismatches.length !== 0
  ) {
    throw new Error(
      `Egypt ADM1 name regression failed: ${JSON.stringify(report.nameRegressionAudit.egypt)}`,
    )
  }
  if (
    report.languageTransitionAudit.chinaAdmin1NonChineseDisplayCount !== 0 ||
    report.languageTransitionAudit.chinaAdmin2NonChineseDisplayCount !== 0
  ) {
    throw new Error('Chinese presentation labels contain a Latin-only fallback')
  }
  if (report.edgeAudit.coincidentSegmentCount !== 0) {
    throw new Error('Presentation ADM1 and ADM2 contain coincident line segments')
  }
  if (report.edgeAudit.sourceSharedEdgeMissingCount !== 0) {
    throw new Error(
      `Presentation ADM2 is missing ${report.edgeAudit.sourceSharedEdgeMissingCount} eligible source shared segments`,
    )
  }

  return {
    collections: {
      admin1Polygons: { type: 'FeatureCollection', features: admin1Features },
      admin1Boundaries: admin1BoundaryResult.collection,
      admin1Labels,
      admin2Polygons: { type: 'FeatureCollection', features: admin2Features },
      admin2Boundaries: admin2BoundaryResult.collection,
      admin2Labels,
    },
    report,
  }
}

export function writePresentationCollection(workDir, id, collection) {
  const path = join(workDir, `${id}.geojson`)
  writeFileSync(path, `${JSON.stringify(collection)}\n`)
  return { path, count: collection.features?.length ?? 0 }
}

export function presentationLabelMinZoom(profileStart) {
  const start = Number(profileStart)
  return Number.isFinite(start) ? Number(Math.min(8, start + 0.2).toFixed(2)) : null
}

function internalBoundaryCollection(features, presentationLevel) {
  const segmentOwners = new Map()
  for (const feature of features) {
    const owner = feature.properties.geo_key
    for (const ring of geometryRings(feature.geometry)) {
      for (let index = 1; index < ring.length; index += 1) {
        const left = normalizedCoordinate(ring[index - 1])
        const right = normalizedCoordinate(ring[index])
        if (!left || !right || sameCoordinate(left, right)) continue
        if (Math.abs(left[0] - right[0]) > 180) continue
        const key = segmentKey(left, right)
        const record = segmentOwners.get(key) ?? { left, right, owners: new Set() }
        record.owners.add(owner)
        segmentOwners.set(key, record)
      }
    }
  }
  const featureByKey = new Map(features.map((feature) => [feature.properties.geo_key, feature]))
  const groups = new Map()
  const segmentKeys = new Set()
  for (const [key, segment] of segmentOwners) {
    const owners = [...segment.owners].sort()
    if (owners.length < 2) continue
    const leftFeature = featureByKey.get(owners[0])
    const rightFeature = featureByKey.get(owners[1])
    if (!leftFeature || !rightFeature) continue
    if (leftFeature.properties.country_key !== rightFeature.properties.country_key) continue
    const pairKey = `${owners[0]}|~|${owners[1]}`
    const group = groups.get(pairKey) ?? {
      leftFeature,
      rightFeature,
      lines: [],
    }
    group.lines.push([segment.left, segment.right])
    groups.set(pairKey, group)
    segmentKeys.add(key)
  }
  const boundaryFeatures = [...groups.values()].map((group) => {
    const props = group.leftFeature.properties
    return {
      type: 'Feature',
      properties: {
        country_key: props.country_key,
        geo_key: props.geo_key,
        parent_geo_key: props.parent_geo_key,
        left_geo_key: group.leftFeature.properties.geo_key,
        right_geo_key: group.rightFeature.properties.geo_key,
        presentation_level: presentationLevel,
        detail_profile: props.detail_profile,
        source_level: props.source_level,
        unit_count: props.unit_count,
        density_per_100k_km2: props.density_per_100k_km2,
      },
      geometry: {
        type: group.lines.length === 1 ? 'LineString' : 'MultiLineString',
        coordinates: group.lines.length === 1 ? group.lines[0] : group.lines,
      },
    }
  })
  return {
    collection: { type: 'FeatureCollection', features: boundaryFeatures },
    segmentKeys,
  }
}

function filteredAdmin2BoundaryCollection(edgeSources, childBySource, admin1Segments) {
  const features = []
  const segmentKeys = new Set()
  const expectedSourceSegmentKeys = new Set()
  let rejectedCrossParentSegments = 0
  let rejectedCrossSourceParentSegments = 0
  let removedAdm1CoincidentSegments = 0
  let removedDuplicateSegments = 0
  for (const source of edgeSources) {
    for (const feature of source.collection.features ?? []) {
      const left = childBySource.get(`${source.id}|${feature.properties?.left_geo_key ?? ''}`)
      const right = childBySource.get(`${source.id}|${feature.properties?.right_geo_key ?? ''}`)
      if (!left || !right) continue
      const segmentCount = geometryLines(feature.geometry).reduce(
        (sum, line) => sum + Math.max(0, line.length - 1),
        0,
      )
      if (left.properties.parent_geo_key !== right.properties.parent_geo_key) {
        rejectedCrossParentSegments += segmentCount
        continue
      }
      const leftSourceParent = sourceAdministrativeParentKey(left.properties.source_geo_key)
      const rightSourceParent = sourceAdministrativeParentKey(right.properties.source_geo_key)
      if (leftSourceParent && rightSourceParent && leftSourceParent !== rightSourceParent) {
        rejectedCrossParentSegments += segmentCount
        rejectedCrossSourceParentSegments += segmentCount
        continue
      }
      const lines = []
      for (const line of geometryLines(feature.geometry)) {
        for (let index = 1; index < line.length; index += 1) {
          const start = normalizedCoordinate(line[index - 1])
          const end = normalizedCoordinate(line[index])
          if (!start || !end || sameCoordinate(start, end)) continue
          const key = segmentKey(start, end)
          if (admin1Segments.has(key)) {
            removedAdm1CoincidentSegments += 1
            continue
          }
          expectedSourceSegmentKeys.add(key)
          if (segmentKeys.has(key)) {
            removedDuplicateSegments += 1
            continue
          }
          segmentKeys.add(key)
          lines.push([start, end])
        }
      }
      if (!lines.length) continue
      const props = left.properties
      features.push({
        type: 'Feature',
        properties: {
          country_key: props.country_key,
          geo_key: props.geo_key,
          parent_geo_key: props.parent_geo_key,
          left_geo_key: left.properties.geo_key,
          right_geo_key: right.properties.geo_key,
          presentation_level: 'adm2',
          detail_profile: props.detail_profile,
          source_level: props.source_level,
          unit_count: props.unit_count,
          density_per_100k_km2: props.density_per_100k_km2,
        },
        geometry: {
          type: lines.length === 1 ? 'LineString' : 'MultiLineString',
          coordinates: lines.length === 1 ? lines[0] : lines,
        },
      })
    }
  }
  const missingSourceSegmentCount = [...expectedSourceSegmentKeys].filter(
    (key) => !segmentKeys.has(key),
  ).length
  return {
    collection: { type: 'FeatureCollection', features },
    segmentKeys,
    rejectedCrossParentSegments,
    rejectedCrossSourceParentSegments,
    removedAdm1CoincidentSegments,
    removedDuplicateSegments,
    expectedSourceSegmentKeys,
    missingSourceSegmentCount,
  }
}

function labelCollection(features) {
  return {
    type: 'FeatureCollection',
    features: features.map((feature) => {
      const point = geometryInteriorPoint(feature.geometry)
      if (!point)
        throw new Error(`Unable to create presentation label: ${feature.properties.geo_key}`)
      return {
        type: 'Feature',
        id: feature.properties.geo_key,
        properties: { ...feature.properties },
        geometry: { type: 'Point', coordinates: point },
      }
    }),
  }
}

function presentationParent(geometry, parents, sourceGeoKey = '') {
  const sourceKey = String(sourceGeoKey ?? '').trim()
  const sourceParentKey = sourceAdministrativeParentKey(sourceKey)
  const sourceMatched = parents.find((parent) => {
    const geoKey = String(parent.properties?.geo_key ?? '')
    const parentSourceKey = String(parent.properties?.source_geo_key ?? '')
    return (
      (sourceParentKey && (geoKey === sourceParentKey || parentSourceKey === sourceParentKey)) ||
      (sourceKey && (geoKey === sourceKey || parentSourceKey === sourceKey))
    )
  })
  if (sourceMatched) return sourceMatched
  const point = geometryInteriorPoint(geometry)
  if (point) {
    const inside = parents
      .filter((parent) => pointInGeometry(point, parent.geometry))
      .sort((left, right) => geometryAreaKm2(left.geometry) - geometryAreaKm2(right.geometry))[0]
    if (inside) return inside
  }
  const childBbox = geometryBbox(geometry)
  if (!childBbox) return null
  return (
    parents
      .map((parent) => ({
        parent,
        overlap: bboxOverlapArea(childBbox, geometryBbox(parent.geometry)),
      }))
      .filter((item) => item.overlap > 0)
      .sort((left, right) => right.overlap - left.overlap)[0]?.parent ?? null
  )
}

function sourceAdministrativeParentKey(sourceGeoKey) {
  const parts = String(sourceGeoKey ?? '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length >= 2 ? parts.slice(0, -1).join('|') : ''
}

function sourceNameAliases(props = {}) {
  return [
    props.shapeName,
    props.display_name,
    props.display_name_en,
    props.name,
    props.region_key,
    props.geo_key?.split('|').pop(),
  ]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
}

function labelPriority(feature) {
  const area = Math.max(0, Number(feature.properties.area_km2 ?? 0))
  return -Math.round(Math.sqrt(area) * 100)
}

function labelCoverage(collection) {
  const total = collection.features?.length ?? 0
  const named = (collection.features ?? []).filter((feature) =>
    String(
      feature.properties?.display_name_zh ||
        feature.properties?.display_name_local ||
        feature.properties?.display_name_en ||
        '',
    ).trim(),
  ).length
  return { total, named, rate: total ? round(named / total, 6) : 0 }
}

function nameCoverage(collection) {
  const features = collection.features ?? []
  const total = features.length
  const verifiedChinese = features.filter(
    (feature) =>
      feature.properties?.name_zh_verified === true &&
      String(feature.properties?.display_name_zh ?? '').trim(),
  ).length
  const originalFallback = features.filter(
    (feature) => !String(feature.properties?.display_name_zh ?? '').trim(),
  ).length
  const unverifiedChineseFieldCount = features.filter(
    (feature) =>
      String(feature.properties?.display_name_zh ?? '').trim() &&
      feature.properties?.name_zh_verified !== true,
  ).length
  const sourceDistribution = {}
  for (const feature of features) {
    const source = String(feature.properties?.name_zh_source ?? 'missing')
    sourceDistribution[source] = (sourceDistribution[source] ?? 0) + 1
  }
  return {
    total,
    verifiedChinese,
    verifiedChineseRate: total ? round(verifiedChinese / total, 6) : 0,
    originalFallback,
    originalFallbackRate: total ? round(originalFallback / total, 6) : 0,
    unverifiedChineseFieldCount,
    sourceDistribution,
    originalFallbackSample: features
      .filter((feature) => !String(feature.properties?.display_name_zh ?? '').trim())
      .slice(0, 500)
      .map((feature) => ({
        countryKey: feature.properties?.country_key,
        geoKey: feature.properties?.geo_key,
        sourceGeoKey: feature.properties?.source_geo_key,
        displayNameLocal: feature.properties?.display_name_local,
        displayNameEn: feature.properties?.display_name_en,
      })),
    originalFallbackByCountry: Object.fromEntries(
      [
        ...groupBy(
          features.filter((feature) => !String(feature.properties?.display_name_zh ?? '').trim()),
          (feature) => feature.properties?.country_key,
        ),
      ]
        .map(([countryKey, countryFeatures]) => [countryKey, countryFeatures.length])
        .sort(
          (left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])),
        ),
    ),
  }
}

function verifiedChineseCount(features) {
  return features.filter(
    (feature) =>
      feature.properties?.name_zh_verified === true &&
      String(feature.properties?.display_name_zh ?? '').trim(),
  ).length
}

function originalNameFallbackCount(features) {
  return features.filter((feature) => !String(feature.properties?.display_name_zh ?? '').trim())
    .length
}

function nonChineseChinaDisplayCount(collection) {
  return (collection.features ?? []).filter((feature) => {
    const props = feature.properties ?? {}
    if (props.country_key !== 'china') return false
    const displayName = props.display_name_zh || props.display_name_local || props.display_name_en
    return !hasCjk(displayName)
  }).length
}

function corruptVisibleLabelCount(collections) {
  return collections
    .flatMap((collection) => collection.features ?? [])
    .filter((feature) =>
      [
        feature.properties?.display_name,
        feature.properties?.display_name_zh,
        feature.properties?.display_name_local,
        feature.properties?.display_name_en,
      ]
        .filter(Boolean)
        .some((value) => !cleanPresentationLabel(value)),
    ).length
}

function egyptNameRegressionAudit(features) {
  const egypt = features.filter((feature) => feature.properties?.country_key === 'egypt')
  const records = egypt.map((feature) => ({
    englishKey: normalizeKey(
      feature.properties?.display_name_en || feature.properties?.display_name_local,
    ).replace(/(?:governorate|governate|province|region)$/, ''),
    chinese: String(feature.properties?.display_name_zh ?? ''),
    source: String(feature.properties?.name_zh_source ?? ''),
  }))
  const mismatches = []
  for (const expected of EGYPT_ADM1_REGRESSION) {
    const matches = records.filter((record) => expected.aliases.includes(record.englishKey))
    if (matches.length !== 1 || matches[0].chinese !== expected.expectedChinese) {
      mismatches.push({ expected, matches })
    }
  }
  return {
    admin1Count: egypt.length,
    redSeaChineseCount: records.filter((record) => record.chinese === '红海').length,
    mismatches,
  }
}

function rejectVerifiedManyToOneNames(features) {
  const groups = groupBy(
    features.filter(
      (feature) =>
        feature.properties?.name_zh_verified === true &&
        String(feature.properties?.display_name_zh ?? '').trim(),
    ),
    (feature) => `${feature.properties.country_key}|${feature.properties.display_name_zh}`,
  )
  const rejectedGroups = []
  for (const [key, group] of groups) {
    const normalizedSourceNames = new Set(
      group.map((feature) =>
        normalizeKey(
          feature.properties?.display_name_en || feature.properties?.display_name_local || '',
        ),
      ),
    )
    if (normalizedSourceNames.size < 2) continue
    rejectedGroups.push({
      key,
      geoKeys: group.map((feature) => feature.properties?.geo_key),
      sources: group.map((feature) => feature.properties?.name_zh_source),
    })
    for (const feature of group) {
      const props = feature.properties
      props.display_name_zh = ''
      props.display_name = props.display_name_local || props.display_name_en || ''
      props.name_zh_verified = false
      props.name_zh_source = 'rejected-many-to-one'
      props.name_zh_reference_key = ''
    }
  }
  const remainingVerifiedDuplicateCount = [
    ...groupBy(
      features.filter(
        (feature) =>
          feature.properties?.name_zh_verified === true &&
          String(feature.properties?.display_name_zh ?? '').trim(),
      ),
      (feature) => `${feature.properties.country_key}|${feature.properties.display_name_zh}`,
    ).values(),
  ].filter(
    (group) =>
      new Set(
        group.map((feature) =>
          normalizeKey(
            feature.properties?.display_name_en || feature.properties?.display_name_local || '',
          ),
        ),
      ).size > 1,
  ).length
  return {
    rejectedGroupCount: rejectedGroups.length,
    rejectedFeatureCount: rejectedGroups.reduce((sum, group) => sum + group.geoKeys.length, 0),
    remainingVerifiedDuplicateCount,
    rejectedSample: rejectedGroups.slice(0, 20),
  }
}

function assertCountryCount(index, countryKey, expected) {
  const actual = index.get(countryKey)?.length ?? 0
  if (actual !== expected) {
    throw new Error(`Expected ${expected} presentation ADM1 units for ${countryKey}, got ${actual}`)
  }
}

function geometryInteriorPoint(geometry) {
  const polygons = geometryPolygons(geometry).sort(
    (left, right) => polygonAreaDegrees(right) - polygonAreaDegrees(left),
  )
  for (const polygon of polygons) {
    const point = polygonInteriorPoint(polygon)
    // Degenerate source slivers can have no strict mathematical interior at
    // five-decimal tile precision. Their first boundary vertex is still a
    // deterministic non-empty label anchor and is returned as the last resort.
    if (point) return point.map((value) => round(value, 6))
  }
  return null
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
  if (pointInPolygon(middle, polygon)) return middle
  for (let yStep = 1; yStep < 10; yStep += 1) {
    for (let xStep = 1; xStep < 10; xStep += 1) {
      const candidate = [
        bbox[0] + ((bbox[2] - bbox[0]) * xStep) / 10,
        bbox[1] + ((bbox[3] - bbox[1]) * yStep) / 10,
      ]
      if (pointInPolygon(candidate, polygon)) return candidate
    }
  }
  return ring[0] ?? null
}

function pointInGeometry(point, geometry) {
  return geometryPolygons(geometry).some((polygon) => pointInPolygon(point, polygon))
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

function geometryAreaKm2(geometry) {
  return geometryPolygons(geometry).reduce((sum, polygon) => {
    const outer = sphericalRingArea(polygon[0] ?? [])
    const holes = (polygon.slice(1) ?? []).reduce(
      (holeSum, ring) => holeSum + sphericalRingArea(ring),
      0,
    )
    return sum + Math.max(0, outer - holes)
  }, 0)
}

function sphericalRingArea(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 0
  const radians = Math.PI / 180
  let sum = 0
  for (let index = 1; index < ring.length; index += 1) {
    const left = ring[index - 1]
    const right = ring[index]
    let longitudeDelta = (right[0] - left[0]) * radians
    if (longitudeDelta > Math.PI) longitudeDelta -= Math.PI * 2
    if (longitudeDelta < -Math.PI) longitudeDelta += Math.PI * 2
    sum += longitudeDelta * (2 + Math.sin(left[1] * radians) + Math.sin(right[1] * radians))
  }
  return Math.abs((sum * 6371.0088 ** 2) / 2)
}

function polygonAreaDegrees(polygon) {
  return (polygon ?? []).reduce(
    (sum, ring, index) => sum + (index === 0 ? 1 : -1) * ringArea(ring),
    0,
  )
}

function ringArea(ring) {
  let sum = 0
  for (let index = 1; index < (ring?.length ?? 0); index += 1) {
    sum += ring[index - 1][0] * ring[index][1] - ring[index][0] * ring[index - 1][1]
  }
  return Math.abs(sum / 2)
}

function geometryBbox(geometry) {
  const points = geometryRings(geometry).flat()
  if (!points.length) return null
  return points.reduce(
    (bbox, point) => [
      Math.min(bbox[0], point[0]),
      Math.min(bbox[1], point[1]),
      Math.max(bbox[2], point[0]),
      Math.max(bbox[3], point[1]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  )
}

function bboxOverlapArea(left, right) {
  if (!left || !right) return 0
  return (
    Math.max(0, Math.min(left[2], right[2]) - Math.max(left[0], right[0])) *
    Math.max(0, Math.min(left[3], right[3]) - Math.max(left[1], right[1]))
  )
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

function geometryPolygons(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates]
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates
  return []
}

function geometryRings(geometry) {
  return geometryPolygons(geometry).flat()
}

function geometryLines(geometry) {
  if (geometry?.type === 'LineString') return [geometry.coordinates]
  if (geometry?.type === 'MultiLineString') return geometry.coordinates
  return []
}

function polygonGeometry(geometry) {
  return geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon'
}

function renderablePolygonGeometry(geometry) {
  return (
    polygonGeometry(geometry) &&
    geometryPolygons(geometry).some((polygon) =>
      (polygon?.[0] ?? []).some(
        (point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]),
      ),
    )
  )
}

function normalizedCoordinate(point) {
  if (!Array.isArray(point) || point.length < 2) return null
  const longitude = Number(Number(point[0]).toFixed(5))
  const latitude = Number(Number(point[1]).toFixed(5))
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null
}

function segmentKey(left, right) {
  const leftKey = `${left[0].toFixed(5)},${left[1].toFixed(5)}`
  const rightKey = `${right[0].toFixed(5)},${right[1].toFixed(5)}`
  return leftKey < rightKey ? `${leftKey}|${rightKey}` : `${rightKey}|${leftKey}`
}

function sameCoordinate(left, right) {
  return left[0] === right[0] && left[1] === right[1]
}

function uniqueGeoKey(base, keys) {
  let candidate = base
  let suffix = 2
  while (keys.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  keys.add(candidate)
  return candidate
}

function canonicalCountryKey(value) {
  const key = normalizeKey(value)
  if (['taiwan', 'hongkongsar', 'macausar', 'macaosar'].includes(key)) return 'china'
  return key
}

function normalizeKey(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function hasCjk(value) {
  return /[\u3400-\u9fff]/.test(String(value ?? ''))
}

function groupBy(values, keyGetter) {
  const groups = new Map()
  for (const value of values) {
    const key = keyGetter(value)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(value)
  }
  return groups
}

function intersectionSize(left, right) {
  let count = 0
  for (const value of left) if (right.has(value)) count += 1
  return count
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(Number(value) * factor) / factor
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}
