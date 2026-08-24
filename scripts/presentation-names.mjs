import { readFileSync } from 'node:fs'

const COUNTRY_ISO2_OVERRIDES = Object.freeze({
  france: 'FR',
  kosovo: 'XK',
  norway: 'NO',
})

export function buildPresentationNameResolver({
  countries,
  controlledLabels,
  cldrSnapshotPath,
  officialOverridesPath,
}) {
  const snapshot = readJson(cldrSnapshotPath)
  const overrides = readJson(officialOverridesPath)
  validateCldrSnapshot(snapshot)
  validateOfficialOverrides(overrides)
  const iso2ByCountry = countryIso2Index(countries)
  const cldrByCountryAndName = cldrNameIndex(snapshot)
  const officialByKey = officialOverrideIndex(overrides)
  const chinaByName = controlledChinaNameIndex(controlledLabels)
  const sourceCounts = new Map()

  function resolve({
    countryKey,
    presentationLevel,
    geoKey,
    sourceGeoKey,
    localName,
    aliases = [],
  }) {
    const local = String(localName ?? '').trim()
    const official = officialOverride(
      officialByKey,
      countryKey,
      presentationLevel,
      geoKey,
      sourceGeoKey,
      [local, ...aliases],
    )
    if (official) {
      return resolved(local, official.display_name_zh, 'official-override', true, {
        subdivision_code: official.subdivision_code ?? '',
      })
    }

    const countryCode = iso2ByCountry.get(countryKey)
    const cldr = exactCldrMatch(cldrByCountryAndName, countryCode, [local, ...aliases])
    if (cldr?.display_name_zh) {
      return resolved(local, cldr.display_name_zh, `unicode-cldr-${snapshot.cldr_version}`, true, {
        subdivision_code: cldr.code,
        zh_draft_status: cldr.zh_draft_status,
      })
    }

    if (countryKey === 'china') {
      const chinaName = [geoKey, sourceGeoKey, local, ...aliases]
        .map((value) => chinaByName.get(`${presentationLevel}|${normalizeName(value)}`))
        .find(Boolean)
      if (chinaName) return resolved(local, chinaName, 'china-standard', true)
    }
    return resolved(local, '', 'original-local', false)
  }

  function resolved(local, chinese, source, verified, extra = {}) {
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1)
    return {
      display_name_local: local,
      display_name_zh: String(chinese ?? '').trim(),
      name_zh_source: source,
      name_zh_verified: verified,
      ...extra,
    }
  }

  return {
    resolve,
    report() {
      return {
        snapshot: {
          cldrVersion: snapshot.cldr_version,
          sha256: snapshot.sources,
          entryCount: snapshot.entries?.length ?? 0,
        },
        officialOverrideCount: overrides.entries?.length ?? 0,
        sourceCounts: Object.fromEntries([...sourceCounts.entries()].sort()),
      }
    },
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
    const key = `${entry.country_code}|${normalizeName(entry.display_name_en)}`
    const matches = result.get(key) ?? []
    matches.push(entry)
    result.set(key, matches)
  }
  return result
}

function exactCldrMatch(index, countryCode, aliases) {
  if (!countryCode) return undefined
  const matches = new Map()
  for (const alias of aliases) {
    const key = `${countryCode}|${normalizeName(alias)}`
    for (const entry of index.get(key) ?? []) matches.set(entry.code, entry)
  }
  return matches.size === 1 ? [...matches.values()][0] : undefined
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
      throw new Error(`Official name override has an invalid presentation level: ${presentationLevel}`)
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
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '')
}

function hasCjk(value) {
  return /[\u3400-\u9fff]/.test(String(value ?? ''))
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}
