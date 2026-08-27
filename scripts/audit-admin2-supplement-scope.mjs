#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const generatedDir = join(rootDir, 'public/tiles/generated')
const renderDir = join(rootDir, 'public/geo/render')
const scopePath = join(rootDir, 'scripts/data/preview-map/admin2-coverage-scope.json')
const worldCitiesPath = join(generatedDir, 'world-cities.geojson')
const regionIndexPath = join(renderDir, 'region-index.json')
const writeBaseline = process.argv.includes('--write')
const baseline = writeBaseline ? null : readJson(scopePath)

const worldCities = readJson(worldCitiesPath)
const regionIndex = readJson(regionIndexPath)
const countryNames = new Map(
  (regionIndex.regions ?? [])
    .filter((region) => region.level === 'country')
    .map((region) => [
      region.country_key || region.geo_key,
      {
        zh: region.display_name_zh || region.display_name,
        en: region.display_name_en || region.name,
      },
    ]),
)
const featuresByCountry = groupBy(worldCities.features ?? [], (feature) =>
  String(feature.properties?.country_key ?? ''),
)

const candidateCountries = []
const protectedCountries = []
for (const [countryKey, features] of featuresByCountry) {
  const sourceLevels = [...new Set(features.map((feature) => feature.properties?.source_level))]
    .filter(Boolean)
    .sort()
  const hasPinnedAdm2 = sourceLevels.includes('CGAZ_ADM2')
  const isCandidate =
    countryKey !== 'china' && (!hasPinnedAdm2 || (hasPinnedAdm2 && features.length <= 1))
  const names = countryNames.get(countryKey) ?? { zh: '', en: '' }
  const item = {
    country_key: countryKey,
    display_name_zh: countryKey === 'sintmaarten' ? '荷属圣马丁' : names.zh,
    display_name_en: names.en,
    current_feature_count: features.length,
    current_source_levels: sourceLevels,
  }
  if (isCandidate) candidateCountries.push(item)
  else {
    protectedCountries.push({
      ...item,
      feature_sha256: sha256(stableStringify(sortFeatures(features))),
    })
  }
}

candidateCountries.sort(byCountryKey)
protectedCountries.sort(byCountryKey)

const protectedAssetPaths = [
  'public/geo/render/world-admin1.geojson',
  'public/geo/render/china-provinces.geojson',
  'public/geo/render/china-cities.geojson',
]
const protectedAssets = Object.fromEntries(
  protectedAssetPaths.map((path) => [path, sha256(readFileSync(join(rootDir, path)))]),
)

const snapshot = {
  schema_version: 1,
  hierarchy: 'country-adm1-adm2',
  generated_at: '2026-08-27',
  detection_rule:
    'Candidate when the current country-level entity has no native CGAZ_ADM2 source, or its native ADM2 source contains only one polygon; China is always protected because local city geometry is authoritative.',
  candidate_count: candidateCountries.length,
  protected_count: protectedCountries.length,
  candidates: candidateCountries,
  protected_countries: protectedCountries,
  protected_assets: protectedAssets,
}

if (writeBaseline) {
  assertCounts(snapshot)
  writeFileSync(scopePath, `${JSON.stringify(snapshot, null, 2)}\n`)
  console.log(`Wrote ADM2 supplement scope: ${scopePath}`)
  console.log(`Candidates: ${snapshot.candidate_count}; protected: ${snapshot.protected_count}`)
  process.exit(0)
}

assertCounts(baseline)
const baselineCandidateKeys = new Set(baseline.candidates.map((item) => item.country_key))
const baselineProtectedKeys = new Set(baseline.protected_countries.map((item) => item.country_key))
for (const countryKey of featuresByCountry.keys()) {
  if (!baselineCandidateKeys.has(countryKey) && !baselineProtectedKeys.has(countryKey)) {
    throw new Error(`Country is outside the frozen ADM2 scope: ${countryKey}`)
  }
}
for (const country of baseline.protected_countries) {
  const currentFeatures = featuresByCountry.get(country.country_key)
  if (!currentFeatures) {
    throw new Error(`Protected ADM2 country disappeared: ${country.country_key}`)
  }
  const currentHash = sha256(stableStringify(sortFeatures(currentFeatures)))
  if (currentHash !== country.feature_sha256) {
    throw new Error(`Protected ADM2 country changed: ${country.country_key}`)
  }
}
for (const [path, expectedHash] of Object.entries(baseline.protected_assets)) {
  const currentHash = sha256(readFileSync(join(rootDir, path)))
  if (currentHash !== expectedHash) throw new Error(`Protected boundary asset changed: ${path}`)
}
console.log(
  `ADM2 supplement scope check passed: ${baseline.candidate_count} candidates, ${baseline.protected_count} protected entities.`,
)

function assertCounts(scope) {
  if (scope.candidate_count !== 60 || scope.protected_count !== 195) {
    throw new Error(
      `Unexpected ADM2 scope: ${scope.candidate_count} candidates, ${scope.protected_count} protected`,
    )
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function groupBy(items, keyForItem) {
  const groups = new Map()
  for (const item of items) {
    const key = keyForItem(item)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  return groups
}

function sortFeatures(features) {
  return [...features].sort((left, right) =>
    String(left.properties?.region_id ?? left.properties?.geo_key ?? '').localeCompare(
      String(right.properties?.region_id ?? right.properties?.geo_key ?? ''),
    ),
  )
}

function byCountryKey(left, right) {
  return left.country_key.localeCompare(right.country_key)
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function assertEqual(left, right, message) {
  if (stableStringify(left) !== stableStringify(right)) throw new Error(message)
}
