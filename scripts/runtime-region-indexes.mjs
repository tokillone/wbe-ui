#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const RUNTIME_REGION_INDEX_LEVELS = ['country', 'admin1', 'city']
export const RUNTIME_REGION_INDEX_FIELDS = [
  'level',
  'geo_key',
  'parent_geo_key',
  'country_key',
  'display_name',
  'display_name_zh',
  'display_name_en',
  'display_name_local',
  'name',
  'center',
  'label_point',
  'area',
]

export function runtimeRegionIndexFileName(level) {
  return `region-index-${level}.runtime.json`
}

export function buildRuntimeRegionIndexes(regionIndex) {
  const regions = Array.isArray(regionIndex?.regions) ? regionIndex.regions : []
  return Object.fromEntries(
    RUNTIME_REGION_INDEX_LEVELS.map((level) => [
      level,
      {
        schemaVersion: 1,
        level,
        regions: regions
          .filter((entry) => entry?.level === level)
          .map((entry) =>
            Object.fromEntries(
              RUNTIME_REGION_INDEX_FIELDS.filter((field) => entry[field] !== undefined).map(
                (field) => [field, entry[field]],
              ),
            ),
          ),
      },
    ]),
  )
}

export function writeRuntimeRegionIndexes(regionIndex, outputDirectory) {
  const indexes = buildRuntimeRegionIndexes(regionIndex)
  mkdirSync(outputDirectory, { recursive: true })
  for (const [level, payload] of Object.entries(indexes)) {
    writeFileSync(
      resolve(outputDirectory, runtimeRegionIndexFileName(level)),
      `${JSON.stringify(payload)}\n`,
    )
  }
  return indexes
}

export function writeRuntimeCompatibilityIndex(regionIndex, outputPath) {
  const indexes = buildRuntimeRegionIndexes(regionIndex)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(
    outputPath,
    `${JSON.stringify({
      schemaVersion: 1,
      regions: RUNTIME_REGION_INDEX_LEVELS.flatMap((level) => indexes[level].regions),
    })}\n`,
  )
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
const modulePath = fileURLToPath(import.meta.url)
if (invokedPath === modulePath) {
  const rootDir = resolve(dirname(modulePath), '..')
  const renderDir = resolve(rootDir, 'public/geo/render')
  const sourcePath = resolve(renderDir, 'region-index.json')
  const regionIndex = JSON.parse(readFileSync(sourcePath, 'utf8'))
  const indexes = writeRuntimeRegionIndexes(regionIndex, renderDir)
  const compatOptionIndex = process.argv.indexOf('--compat-output')
  if (compatOptionIndex >= 0) {
    const compatOutput = process.argv[compatOptionIndex + 1]
    if (!compatOutput) throw new Error('--compat-output requires a path')
    writeRuntimeCompatibilityIndex(regionIndex, resolve(compatOutput))
  }
  const summary = Object.fromEntries(
    Object.entries(indexes).map(([level, payload]) => [level, payload.regions.length]),
  )
  console.log(`Runtime region indexes written: ${JSON.stringify(summary)}`)
}
