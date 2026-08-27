import { readFileSync } from 'node:fs'

import polygonClipping from 'polygon-clipping'

const COUNTRY_ISO2_OVERRIDES = Object.freeze({
  france: 'FR',
  kosovo: 'XK',
  norway: 'NO',
})

const CANONICAL_COUNTRY_KEY_ALIASES = Object.freeze({
  capeverde: 'caboverde',
  czechrepublic: 'czechia',
  macedonia: 'northmacedonia',
  ssudan: 'southsudan',
  swaziland: 'eswatini',
})

const MIN_SPATIAL_COVERAGE = 0.8
const MIN_SPATIAL_RUNNER_UP_GAP = 0.2
const ADMINISTRATIVE_SUFFIXES = Object.freeze([
  'autonomous community',
  'autonomous district',
  'autonomous okrug',
  'autonomous province',
  'autonomous region',
  'federal district',
  'federal subject',
  'capital region',
  'metropolitan region',
  'special administrative region',
  'governorate',
  'governate',
  'voivodeship',
  'prefecture',
  'department',
  'departement',
  'territory',
  'atoll',
  'islands',
  'island',
  'province',
  'republic',
  'district',
  'oblast',
  'region',
  'county',
  'state',
  'municipality',
  'city',
  'krai',
  'kraj',
  'novads',
])

const ADMINISTRATIVE_PREFIXES = Object.freeze([
  'autonomous district of',
  'autonomous region of',
  'district of',
  'province of',
  'region of',
  'canton of',
  'canton',
  'city of',
])

export function buildPresentationNameResolver({
  countries,
  controlledLabels,
  canonicalAdmin1 = { type: 'FeatureCollection', features: [] },
  cldrSnapshotPath,
  officialOverridesPath,
}) {
  const snapshot = readJson(cldrSnapshotPath)
  const overrides = readJson(officialOverridesPath)
  validateCldrSnapshot(snapshot)
  validateOfficialOverrides(overrides)
  const iso2ByCountry = countryIso2Index(countries)
  const cldrByCountryAndName = cldrNameIndex(snapshot)
  const cldrByCode = new Map((snapshot.entries ?? []).map((entry) => [entry.code, entry]))
  const officialByKey = officialOverrideIndex(overrides)
  const officialCldrAliasByKey = officialCldrAliasIndex(overrides)
  for (const alias of overrides.cldr_code_aliases ?? []) {
    if (!cldrByCode.get(alias.subdivision_code)?.display_name_zh) {
      throw new Error(
        `Official CLDR code alias has no Chinese CLDR 48 entry: ${alias.subdivision_code}`,
      )
    }
  }
  const chinaByName = controlledChinaNameIndex(controlledLabels)
  const canonicalAdmin1Index = buildCanonicalAdmin1Index(canonicalAdmin1)
  const sourceCounts = new Map()
  const preparedSpatialMatches = new Map()
  const verifiedChineseClaims = new Map()
  let ambiguousNameMatchCount = 0
  let ambiguousSpatialMatchCount = 0
  let normalizedNameMatchCount = 0
  let normalizedCldrMatchCount = 0
  let crossLevelCldrRejectCount = 0
  const crossLevelCldrRejectSample = []
  let spatialMatchCount = 0
  let rejectedSpatialMatchCount = 0
  let corruptRejectedCount = 0
  let hiddenLabelCount = 0

  function prepareSpatialMatches(candidates) {
    preparedSpatialMatches.clear()
    const scores = []
    for (const candidate of candidates ?? []) {
      const countryKey = String(candidate.countryKey ?? '').trim()
      const spatialKey = String(candidate.spatialKey ?? '').trim()
      const sourceGeometry = candidate.geometry
      const sourceArea = planarGeometryArea(sourceGeometry)
      const sourceBounds = geometryBounds(sourceGeometry)
      if (!countryKey || !spatialKey || sourceArea <= 0 || !sourceBounds) continue
      for (const record of canonicalAdmin1Index.byCountry.get(countryKey) ?? []) {
        if (!boundsIntersect(sourceBounds, record.bounds)) continue
        const intersectionArea = planarIntersectionArea(sourceGeometry, record.geometry)
        if (intersectionArea <= 0) continue
        const sourceCoverage = intersectionArea / sourceArea
        const canonicalCoverage = intersectionArea / record.area
        scores.push({
          countryKey,
          spatialKey,
          record,
          sourceCoverage,
          canonicalCoverage,
          score: Math.min(sourceCoverage, canonicalCoverage),
        })
      }
    }

    const bySource = groupScores(scores, (score) => `${score.countryKey}|${score.spatialKey}`)
    const byCanonical = groupScores(scores, (score) => `${score.countryKey}|${score.record.id}`)
    for (const [sourceKey, sourceScores] of bySource) {
      const eligible = sourceScores
        .filter(
          (score) =>
            score.sourceCoverage >= MIN_SPATIAL_COVERAGE &&
            score.canonicalCoverage >= MIN_SPATIAL_COVERAGE,
        )
        .sort((left, right) => right.score - left.score)
      if (!eligible.length) {
        if (sourceScores.length) rejectedSpatialMatchCount += 1
        continue
      }
      const best = eligible[0]
      const runnerUp = eligible[1]
      if (runnerUp && best.score - runnerUp.score < MIN_SPATIAL_RUNNER_UP_GAP) {
        ambiguousSpatialMatchCount += 1
        rejectedSpatialMatchCount += 1
        continue
      }
      const canonicalScores = (byCanonical.get(`${best.countryKey}|${best.record.id}`) ?? [])
        .filter(
          (score) =>
            score.sourceCoverage >= MIN_SPATIAL_COVERAGE &&
            score.canonicalCoverage >= MIN_SPATIAL_COVERAGE,
        )
        .sort((left, right) => right.score - left.score)
      const canonicalBest = canonicalScores[0]
      const canonicalRunnerUp = canonicalScores[1]
      if (
        canonicalBest?.spatialKey !== best.spatialKey ||
        (canonicalRunnerUp &&
          canonicalBest.score - canonicalRunnerUp.score < MIN_SPATIAL_RUNNER_UP_GAP)
      ) {
        ambiguousSpatialMatchCount += 1
        rejectedSpatialMatchCount += 1
        continue
      }
      preparedSpatialMatches.set(sourceKey, best.record)
    }
  }

  function resolve({
    countryKey,
    presentationLevel,
    geoKey,
    sourceGeoKey,
    localName,
    aliases = [],
    spatialKey,
    blockedCldrSubdivisionCodes,
  }) {
    const rawNames = [localName, ...aliases]
    const rejected = rawNames.filter(
      (value) => String(value ?? '').trim() && !cleanPresentationLabel(value),
    )
    corruptRejectedCount += new Set(rejected.map(String)).size
    const local = firstCleanLabel(rawNames)
    const english = firstCleanLabel([...aliases, localName])
    const official = officialOverride(
      officialByKey,
      countryKey,
      presentationLevel,
      geoKey,
      sourceGeoKey,
      rawNames,
    )
    if (official) {
      return resolved(
        local,
        english,
        official.display_name_zh,
        'official-override',
        true,
        {
          subdivision_code: official.subdivision_code ?? '',
          name_zh_reference_key:
            official.subdivision_code ?? official.source_geo_key ?? official.geo_key ?? '',
        },
        claimContext(),
      )
    }

    if (countryKey === 'china') {
      const chinaName = [geoKey, sourceGeoKey, ...rawNames]
        .map((value) => chinaByName.get(`${presentationLevel}|${normalizeName(value)}`))
        .find(Boolean)
      if (chinaName) {
        return resolved(local, english, chinaName, 'china-standard', true, {}, claimContext())
      }
    }

    const officialCldrAlias = officialCldrCodeAlias(
      officialCldrAliasByKey,
      countryKey,
      presentationLevel,
      geoKey,
      sourceGeoKey,
    )
    const officialCldrEntry = cldrByCode.get(officialCldrAlias?.subdivision_code)
    if (officialCldrEntry?.display_name_zh) {
      return resolved(
        local,
        english,
        officialCldrEntry.display_name_zh,
        'official-cldr-code-alias',
        true,
        {
          subdivision_code: officialCldrEntry.code,
          zh_draft_status: officialCldrEntry.zh_draft_status,
          name_zh_reference_key: officialCldrEntry.code,
        },
        claimContext(),
      )
    }

    const countryCode = iso2ByCountry.get(countryKey)
    const cldr = exactCldrMatch(cldrByCountryAndName, countryCode, rawNames)
    const crossLevelCldrConflict = Boolean(
      presentationLevel === 'adm2' &&
        cldr?.entry?.code &&
        blockedCldrSubdivisionCodes?.has(cldr.entry.code),
    )
    if (crossLevelCldrConflict) {
      crossLevelCldrRejectCount += 1
      if (crossLevelCldrRejectSample.length < 50) {
        crossLevelCldrRejectSample.push({
          countryKey,
          geoKey,
          sourceGeoKey,
          localName: local,
          subdivisionCode: cldr.entry.code,
          rejectedChinese: cldr.entry.display_name_zh,
        })
      }
      return resolved(
        local,
        english,
        '',
        'cross-level-cldr-rejected',
        false,
        {},
        claimContext(),
      )
    } else if (cldr?.entry?.display_name_zh) {
      normalizedCldrMatchCount += Number(cldr.normalized)
      return resolved(
        local,
        english,
        cldr.entry.display_name_zh,
        `unicode-cldr-${snapshot.cldr_version}`,
        true,
        {
          subdivision_code: cldr.entry.code,
          zh_draft_status: cldr.entry.zh_draft_status,
          name_zh_reference_key: cldr.entry.code,
        },
        claimContext(),
      )
    }

    if (presentationLevel === 'adm1') {
      const canonicalNameMatch = uniqueCanonicalNameMatch(
        canonicalAdmin1Index.byCountryAndName,
        countryKey,
        rawNames,
      )
      if (canonicalNameMatch.ambiguous) ambiguousNameMatchCount += 1
      if (canonicalNameMatch.feature?.displayNameZh) {
        normalizedNameMatchCount += Number(canonicalNameMatch.normalized)
        return resolved(
          local,
          english,
          canonicalNameMatch.feature.displayNameZh,
          'canonical-admin1-unique-name',
          true,
          { name_zh_reference_key: canonicalNameMatch.feature.id },
          claimContext(),
        )
      }

      const spatialMatch = preparedSpatialMatches.get(
        `${countryKey}|${String(spatialKey ?? sourceGeoKey ?? geoKey)}`,
      )
      if (spatialMatch?.displayNameZh) {
        spatialMatchCount += 1
        return resolved(
          local,
          english,
          spatialMatch.displayNameZh,
          'canonical-admin1-unique-spatial',
          true,
          { name_zh_reference_key: spatialMatch.id },
          claimContext(),
        )
      }
    }
    return resolved(local, english, '', 'original-local', false, {}, claimContext())

    function claimContext() {
      return {
        countryKey,
        presentationLevel,
        sourceIdentity: String(sourceGeoKey ?? geoKey ?? localName ?? ''),
        normalizedSourceName: normalizeAdministrativeName(local || english),
      }
    }
  }

  function resolved(local, english, chinese, source, verified, extra = {}, claim = {}) {
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1)
    const displayNameZh = cleanPresentationLabel(chinese)
    if (!local && !english && !displayNameZh) hiddenLabelCount += 1
    if (verified && displayNameZh && claim.presentationLevel === 'adm1') {
      const claimKey = `${claim.countryKey}|${displayNameZh}`
      const claims = verifiedChineseClaims.get(claimKey) ?? new Map()
      claims.set(claim.sourceIdentity, claim.normalizedSourceName)
      verifiedChineseClaims.set(claimKey, claims)
    }
    return {
      display_name_local: local,
      display_name_zh: displayNameZh,
      display_name_en: english,
      name_zh_source: source,
      name_zh_verified: Boolean(verified && displayNameZh),
      ...extra,
    }
  }

  return {
    prepareSpatialMatches,
    resolve,
    report() {
      const duplicateVerifiedNameAssignments = [...verifiedChineseClaims.entries()]
        .filter(([, claims]) => new Set(claims.values()).size > 1)
        .map(([key, claims]) => ({
          key,
          sources: [...claims.entries()].map(([sourceIdentity, normalizedSourceName]) => ({
            sourceIdentity,
            normalizedSourceName,
          })),
        }))
      return {
        snapshot: {
          cldrVersion: snapshot.cldr_version,
          sha256: snapshot.sources,
          entryCount: snapshot.entries?.length ?? 0,
        },
        officialOverrideCount: overrides.entries?.length ?? 0,
        officialCldrCodeAliasCount: overrides.cldr_code_aliases?.length ?? 0,
        sourceCounts: Object.fromEntries([...sourceCounts.entries()].sort()),
        ambiguousNameMatchCount,
        ambiguousSpatialMatchCount,
        normalizedCldrMatchCount,
        crossLevelCldrRejectCount,
        crossLevelCldrRejectSample,
        normalizedNameMatchCount,
        spatialMatchCount,
        rejectedSpatialMatchCount,
        duplicateVerifiedNameAssignmentCount: duplicateVerifiedNameAssignments.length,
        duplicateVerifiedNameAssignmentSample: duplicateVerifiedNameAssignments.slice(0, 12),
        spatialPolicy: {
          minimumBidirectionalCoverage: MIN_SPATIAL_COVERAGE,
          minimumRunnerUpGap: MIN_SPATIAL_RUNNER_UP_GAP,
          mutualBestRequired: true,
        },
        corruptRejectedCount,
        hiddenLabelCount,
      }
    },
  }
}

export function cleanPresentationLabel(value) {
  const label = String(value ?? '')
    .normalize('NFC')
    .trim()
  if (!label) return ''
  if (/[?\uFFFD\u0000-\u001F\u007F-\u009F]/u.test(label)) return ''
  if (/(?:Ã[\u0080-\u00ff]|Â[\u0080-\u00ff]|â[\u0080-\u00ff]{1,2}|ðŸ)/u.test(label)) return ''
  return label
}

function firstCleanLabel(values) {
  for (const value of values) {
    const clean = cleanPresentationLabel(value)
    if (clean) return clean
  }
  return ''
}

function buildCanonicalAdmin1Index(collection) {
  const byCountry = new Map()
  const byCountryAndName = new Map()
  const canonicalFeatures = (collection.features ?? []).map((feature, index) => {
    const props = feature.properties ?? {}
    const rawCountryKey = String(props.country_key ?? '').trim()
    const countryKey = CANONICAL_COUNTRY_KEY_ALIASES[rawCountryKey] ?? rawCountryKey
    return { feature, index, props, countryKey }
  })
  const primaryNamesByCountry = new Map()
  for (const { props, countryKey } of canonicalFeatures) {
    if (!countryKey) continue
    const names = primaryNamesByCountry.get(countryKey) ?? new Set()
    for (const value of [props.region_key, props.geo_key]) {
      const normalized = normalizeName(
        String(value ?? '')
          .split('|')
          .pop(),
      )
      if (normalized) names.add(normalized)
    }
    primaryNamesByCountry.set(countryKey, names)
  }
  for (const { feature, index, props, countryKey } of canonicalFeatures) {
    if (!countryKey || !feature.geometry) continue
    const aliases = canonicalFeatureAliases(props, primaryNamesByCountry.get(countryKey))
    const displayNameZh =
      canonicalFeatureChineseAliases(props).map(cleanPresentationLabel).find(hasCjk) ?? ''
    if (!displayNameZh) continue
    const record = {
      id: String(props.geo_key ?? props.region_key ?? `${countryKey}|${index}`),
      displayNameZh,
      geometry: feature.geometry,
      area: planarGeometryArea(feature.geometry),
      bounds: geometryBounds(feature.geometry),
    }
    if (record.area <= 0 || !record.bounds) continue
    const countryRecords = byCountry.get(countryKey) ?? []
    countryRecords.push(record)
    byCountry.set(countryKey, countryRecords)
    for (const alias of aliases) {
      for (const normalized of new Set([
        normalizeName(alias),
        normalizeAdministrativeName(alias),
      ])) {
        if (!normalized) continue
        const key = `${countryKey}|${normalized}`
        const records = byCountryAndName.get(key) ?? new Map()
        records.set(record.id, record)
        byCountryAndName.set(key, records)
      }
    }
  }
  return { byCountry, byCountryAndName }
}

function canonicalFeatureAliases(props, countryPrimaryNames = new Set()) {
  const ownPrimaryNames = new Set(
    [props.region_key, props.geo_key]
      .map((value) =>
        normalizeName(
          String(value ?? '')
            .split('|')
            .pop(),
        ),
      )
      .filter(Boolean),
  )
  const keys = Array.isArray(props.keys) ? props.keys : String(props.keys ?? '').split('|')
  const keyAliases = keys.flatMap((value) => {
    const text = String(value ?? '').trim()
    const separator = text.indexOf('|')
    return separator >= 0 ? [text, text.slice(separator + 1)] : [text]
  })
  return [props.display_name, props.display_name_zh, props.name, props.region_key, ...keyAliases]
    .map((value) => String(value ?? '').trim())
    .filter((value) => {
      const normalized = normalizeName(String(value).split('|').pop())
      return !countryPrimaryNames.has(normalized) || ownPrimaryNames.has(normalized)
    })
    .filter(Boolean)
}

function canonicalFeatureChineseAliases(props) {
  const keys = Array.isArray(props.keys) ? props.keys : String(props.keys ?? '').split('|')
  return [
    props.display_name_zh,
    props.display_name,
    ...keys.map(
      (value) =>
        String(value ?? '')
          .split('|')
          .pop() ?? '',
    ),
  ]
}

function uniqueCanonicalNameMatch(index, countryKey, aliases) {
  const matches = new Map()
  let ambiguous = false
  let normalized = false
  for (const alias of aliases) {
    const exactKey = normalizeName(alias)
    const administrativeKey = normalizeAdministrativeName(alias)
    for (const key of new Set([exactKey, administrativeKey])) {
      if (!key) continue
      const records = index.get(`${countryKey}|${key}`)
      if (!records) continue
      if (records.size > 1) ambiguous = true
      if (key !== exactKey) normalized = true
      for (const [id, record] of records) matches.set(id, record)
    }
  }
  return {
    feature: matches.size === 1 ? [...matches.values()][0] : undefined,
    ambiguous: ambiguous || matches.size > 1,
    normalized,
  }
}

function countryIso2Index(countries) {
  const result = new Map()
  for (const feature of countries.features ?? []) {
    const props = feature.properties ?? {}
    const countryKey = String(props.country_key ?? '')
    const sourceCode = String(props['ISO3166-1-Alpha-2'] ?? '').toUpperCase()
    const code = COUNTRY_ISO2_OVERRIDES[countryKey] ?? sourceCode
    if (countryKey && /^[A-Z]{2}$/.test(code)) result.set(countryKey, code)
  }
  return result
}

function cldrNameIndex(snapshot) {
  const result = new Map()
  for (const entry of snapshot.entries ?? []) {
    if (!entry.country_code || !entry.display_name_en) continue
    for (const normalized of new Set([
      normalizeName(entry.display_name_en),
      normalizeAdministrativeName(entry.display_name_en),
    ])) {
      if (!normalized) continue
      const key = `${entry.country_code}|${normalized}`
      const matches = result.get(key) ?? []
      matches.push(entry)
      result.set(key, matches)
    }
  }
  return result
}

function exactCldrMatch(index, countryCode, aliases) {
  if (!countryCode) return undefined
  const matches = new Map()
  let normalized = false
  for (const alias of aliases) {
    const exactKey = normalizeName(alias)
    const administrativeKey = normalizeAdministrativeName(alias)
    for (const key of new Set([exactKey, administrativeKey])) {
      for (const entry of index.get(`${countryCode}|${key}`) ?? []) {
        matches.set(entry.code, entry)
        if (key !== exactKey) normalized = true
      }
    }
  }
  return matches.size === 1 ? { entry: [...matches.values()][0], normalized } : undefined
}

function officialOverrideIndex(overrides) {
  const result = new Map()
  for (const entry of overrides.entries ?? []) {
    const presentationLevel = entry.presentation_level ?? overrides.default_presentation_level
    for (const value of [entry.geo_key, entry.source_geo_key, entry.local_name]) {
      const normalized = normalizeName(value)
      if (normalized) {
        result.set(`${entry.country_key}|${presentationLevel}|${normalized}`, entry)
      }
    }
  }
  return result
}

function officialCldrAliasIndex(overrides) {
  const result = new Map()
  for (const entry of overrides.cldr_code_aliases ?? []) {
    const level = entry.presentation_level ?? overrides.default_presentation_level
    for (const value of [entry.geo_key, entry.source_geo_key]) {
      const normalized = normalizeName(value)
      if (normalized) result.set(`${entry.country_key}|${level}|${normalized}`, entry)
    }
  }
  return result
}

function officialCldrCodeAlias(index, countryKey, presentationLevel, geoKey, sourceGeoKey) {
  for (const value of [sourceGeoKey, geoKey]) {
    const match = index.get(`${countryKey}|${presentationLevel}|${normalizeName(value)}`)
    if (match) return match
  }
  return undefined
}

function officialOverride(index, countryKey, presentationLevel, geoKey, sourceGeoKey, aliases) {
  for (const value of [geoKey, sourceGeoKey, ...aliases]) {
    const match = index.get(`${countryKey}|${presentationLevel}|${normalizeName(value)}`)
    if (match) return match
  }
  return undefined
}

function controlledChinaNameIndex(collection) {
  const result = new Map()
  for (const feature of collection.features ?? []) {
    const props = feature.properties ?? {}
    if (props.country_key !== 'china') continue
    const presentationLevel = props.level === 'city' ? 'adm2' : 'adm1'
    const chinese = [props.display_name_zh, props.display_name]
      .map((value) => String(value ?? '').trim())
      .find(hasCjk)
    if (!chinese) continue
    for (const value of [props.geo_key, props.display_name_en, props.display_name, props.name]) {
      const normalized = normalizeName(value)
      if (normalized) result.set(`${presentationLevel}|${normalized}`, chinese)
    }
  }
  return result
}

function validateOfficialOverrides(overrides) {
  for (const entry of overrides.entries ?? []) {
    const presentationLevel = entry.presentation_level ?? overrides.default_presentation_level
    if (!['adm1', 'adm2'].includes(presentationLevel)) {
      throw new Error(
        `Official name override has an invalid presentation level: ${presentationLevel}`,
      )
    }
    if (!String(entry.geo_key ?? entry.source_geo_key ?? '').trim()) {
      throw new Error('Official name override requires geo_key or source_geo_key')
    }
    for (const field of [
      'country_key',
      'display_name_zh',
      'authority',
      'source_url',
      'retrieved_at',
    ]) {
      if (!String(entry[field] ?? '').trim()) {
        throw new Error(`Official name override is missing ${field}`)
      }
    }
    if (!/^https:\/\//.test(entry.source_url)) {
      throw new Error(`Official name override must use an HTTPS source: ${entry.source_url}`)
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.retrieved_at)) {
      throw new Error(`Official name override has an invalid retrieved_at: ${entry.retrieved_at}`)
    }
  }
  const provenance = overrides.cldr_code_alias_provenance ?? {}
  if ((overrides.cldr_code_aliases?.length ?? 0) > 0) {
    if (
      provenance.verification_status !== 'verified' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(provenance.retrieved_at ?? '')) ||
      !Array.isArray(provenance.source_urls) ||
      provenance.source_urls.some((url) => !/^https:\/\//.test(String(url)))
    ) {
      throw new Error('Official CLDR code aliases require verified shared provenance')
    }
  }
  for (const entry of overrides.cldr_code_aliases ?? []) {
    for (const field of ['country_key', 'source_geo_key', 'source_name', 'subdivision_code']) {
      if (!String(entry[field] ?? '').trim()) {
        throw new Error(`Official CLDR code alias is missing ${field}`)
      }
    }
    if (entry.verified !== true) {
      throw new Error(`Official CLDR code alias is not verified: ${entry.source_geo_key}`)
    }
  }
}

function validateCldrSnapshot(snapshot) {
  if (snapshot.cldr_version !== '48') {
    throw new Error(`Expected Unicode CLDR 48, got ${snapshot.cldr_version ?? 'unknown'}`)
  }
  for (const locale of ['en', 'zh']) {
    const source = snapshot.sources?.[locale]
    if (!/^https:\/\//.test(source?.url ?? '') || !/^[a-f0-9]{64}$/.test(source?.sha256 ?? '')) {
      throw new Error(`CLDR ${locale} snapshot source is missing its URL or SHA-256`)
    }
  }
}

function normalizeName(value) {
  return foldLatin(String(value ?? ''))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '')
}

function normalizeAdministrativeName(value) {
  let normalized = foldLatin(String(value ?? ''))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ')
    .trim()
  let changed = true
  while (normalized && changed) {
    changed = false
    for (const prefix of ADMINISTRATIVE_PREFIXES) {
      if (normalized.startsWith(`${prefix} `)) {
        normalized = normalized.slice(prefix.length).trim()
        changed = true
        break
      }
    }
    if (changed) continue
    for (const suffix of ADMINISTRATIVE_SUFFIXES) {
      const compactSuffix = suffix.replace(/\s+/g, '')
      const compactNormalized = normalized.replace(/\s+/g, '')
      const concatenated =
        compactNormalized.length > compactSuffix.length + 2 &&
        compactNormalized.endsWith(compactSuffix)
      if (normalized === suffix || normalized.endsWith(` ${suffix}`) || concatenated) {
        normalized = concatenated
          ? compactNormalized.slice(0, -compactSuffix.length)
          : normalized.slice(0, -suffix.length).trim()
        changed = true
        break
      }
    }
  }
  return normalized.replace(/\s+/g, '')
}

function foldLatin(value) {
  return value
    .replace(/[ħĦ]/g, 'h')
    .replace(/[żŻžŽ]/g, 'z')
    .replace(/[ċĊ]/g, 'c')
    .replace(/[ġĠ]/g, 'g')
    .replace(/[đĐ]/g, 'd')
    .replace(/[łŁ]/g, 'l')
    .replace(/[ðÐ]/g, 'd')
    .replace(/[þÞ]/g, 'th')
}

function groupScores(scores, keyForScore) {
  const result = new Map()
  for (const score of scores) {
    const key = keyForScore(score)
    const values = result.get(key) ?? []
    values.push(score)
    result.set(key, values)
  }
  return result
}

function planarIntersectionArea(leftGeometry, rightGeometry) {
  const left = multiPolygonCoordinates(leftGeometry)
  const right = multiPolygonCoordinates(rightGeometry)
  if (!left.length || !right.length) return 0
  try {
    return multiPolygonArea(polygonClipping.intersection(left, right))
  } catch {
    return 0
  }
}

function planarGeometryArea(geometry) {
  return multiPolygonArea(multiPolygonCoordinates(geometry))
}

function multiPolygonCoordinates(geometry) {
  if (geometry?.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    return [geometry.coordinates]
  }
  if (geometry?.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates
  }
  return []
}

function multiPolygonArea(multiPolygon) {
  return (multiPolygon ?? []).reduce((total, polygon) => {
    const outer = Math.abs(ringArea(polygon?.[0] ?? []))
    const holes = (polygon?.slice(1) ?? []).reduce((sum, ring) => sum + Math.abs(ringArea(ring)), 0)
    return total + Math.max(0, outer - holes)
  }, 0)
}

function ringArea(ring) {
  let area = 0
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]
    const next = ring[(index + 1) % ring.length]
    if (!current || !next) continue
    area += Number(current[0]) * Number(next[1]) - Number(next[0]) * Number(current[1])
  }
  return area / 2
}

function geometryBounds(geometry) {
  const coordinates = multiPolygonCoordinates(geometry)
  if (!coordinates.length) return null
  const bounds = [Infinity, Infinity, -Infinity, -Infinity]
  for (const polygon of coordinates) {
    for (const ring of polygon ?? []) {
      for (const coordinate of ring ?? []) {
        const x = Number(coordinate?.[0])
        const y = Number(coordinate?.[1])
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        bounds[0] = Math.min(bounds[0], x)
        bounds[1] = Math.min(bounds[1], y)
        bounds[2] = Math.max(bounds[2], x)
        bounds[3] = Math.max(bounds[3], y)
      }
    }
  }
  return bounds.every(Number.isFinite) ? bounds : null
}

function boundsIntersect(left, right) {
  return !(left[2] <= right[0] || right[2] <= left[0] || left[3] <= right[1] || right[3] <= left[1])
}

function hasCjk(value) {
  return /[\u3400-\u9fff]/.test(String(value ?? ''))
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}
