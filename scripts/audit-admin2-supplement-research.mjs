#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const rootDir = resolve(dirname(scriptPath), '..')
const defaultScopePath = join(rootDir, 'scripts/data/preview-map/admin2-coverage-scope.json')
const defaultSupplementsDir = join(rootDir, 'scripts/data/preview-map/admin2-supplements')
const REQUIRED_CANDIDATE_FIELDS = [
  'status',
  'official_hierarchy',
  'geometry_source',
  'chinese_name_source',
]
const HAN_CHARACTER_PATTERN = /\p{Script=Han}/u

export function auditAdmin2SupplementResearch({
  scopePath = defaultScopePath,
  supplementsDir = defaultSupplementsDir,
  allowIncomplete = false,
} = {}) {
  const scope = readJson(scopePath, 'ADM2 coverage scope')
  if (!Array.isArray(scope.candidates)) {
    throw new Error(`ADM2 coverage scope has no candidates array: ${scopePath}`)
  }
  if (scope.candidate_count !== scope.candidates.length) {
    throw new Error(
      `ADM2 coverage scope count mismatch: expected ${scope.candidate_count}, found ${scope.candidates.length}`,
    )
  }

  const whitelist = new Map()
  for (const candidate of scope.candidates) {
    const countryKey = requiredString(candidate?.country_key, 'scope candidate country_key')
    if (whitelist.has(countryKey)) {
      throw new Error(`Duplicate country_key in ADM2 coverage scope: ${countryKey}`)
    }
    whitelist.set(countryKey, candidate)
  }

  const researchFiles = readdirSync(supplementsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('-research.json'))
    .map((entry) => join(supplementsDir, entry.name))
    .sort((left, right) => left.localeCompare(right))
  if (researchFiles.length === 0) {
    throw new Error(`No *-research.json packages found in ${supplementsDir}`)
  }

  const seen = new Map()
  const batches = []
  for (const researchPath of researchFiles) {
    const research = readJson(researchPath, 'ADM2 supplement research package')
    const batch = batchLabel(research.batch, `${researchPath}: batch`)
    if (!Array.isArray(research.candidates)) {
      throw new Error(`${researchPath}: candidates must be an array`)
    }
    batches.push({ batch, path: researchPath, candidate_count: research.candidates.length })

    for (const [index, candidate] of research.candidates.entries()) {
      const label = `${researchPath}: candidates[${index}]`
      if (!isPlainObject(candidate)) throw new Error(`${label} must be an object`)

      const countryKey = requiredString(candidate.country_key, `${label}.country_key`)
      if (!whitelist.has(countryKey)) {
        throw new Error(
          `${label} country_key is outside the reviewed 60-item whitelist: ${countryKey}`,
        )
      }
      const firstSeen = seen.get(countryKey)
      if (firstSeen) {
        throw new Error(
          `Duplicate research country_key across batches: ${countryKey} appears in ${firstSeen} and ${researchPath}`,
        )
      }

      const displayNameZh = requiredString(candidate.display_name_zh, `${label}.display_name_zh`)
      if (!HAN_CHARACTER_PATTERN.test(displayNameZh)) {
        throw new Error(`${label}.display_name_zh must contain a Chinese character`)
      }
      requiredString(candidate.status, `${label}.status`)
      for (const field of REQUIRED_CANDIDATE_FIELDS.slice(1)) {
        if (!isPlainObject(candidate[field])) {
          throw new Error(`${label}.${field} must be an object`)
        }
      }
      seen.set(countryKey, researchPath)
    }
  }

  const missingCountryKeys = [...whitelist.keys()].filter((countryKey) => !seen.has(countryKey))
  if (!allowIncomplete && missingCountryKeys.length > 0) {
    throw new Error(
      `ADM2 supplement research is incomplete: missing ${missingCountryKeys.length} of ${whitelist.size} whitelist entries: ${missingCountryKeys.join(', ')}`,
    )
  }

  return {
    whitelist_count: whitelist.size,
    covered_count: seen.size,
    missing_count: missingCountryKeys.length,
    missing_country_keys: missingCountryKeys,
    research_file_count: researchFiles.length,
    batches,
    allow_incomplete: allowIncomplete,
  }
}

function readJson(path, description) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`Invalid ${description} JSON at ${path}: ${error.message}`, { cause: error })
  }
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function batchLabel(value, label) {
  if (typeof value === 'string') return requiredString(value, label)
  if (isPlainObject(value)) return requiredString(value.id, `${label}.id`)
  throw new Error(`${label} must be a non-empty string or an object with a non-empty id`)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function main() {
  const allowedArguments = new Set(['--allow-incomplete'])
  const unknownArguments = process.argv
    .slice(2)
    .filter((argument) => !allowedArguments.has(argument))
  if (unknownArguments.length > 0) {
    throw new Error(`Unknown argument(s): ${unknownArguments.join(', ')}`)
  }
  const result = auditAdmin2SupplementResearch({
    allowIncomplete: process.argv.includes('--allow-incomplete'),
  })
  const mode = result.allow_incomplete ? 'parallel/incomplete' : 'complete'
  console.log(
    `ADM2 supplement research audit passed (${mode} mode): ${result.covered_count}/${result.whitelist_count} whitelist entries across ${result.research_file_count} package(s); ${result.missing_count} missing.`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath)) main()
