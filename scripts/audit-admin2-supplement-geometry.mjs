#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import polygonClipping from 'polygon-clipping'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const supplementDir = resolve(rootDir, 'scripts/data/preview-map/admin2-supplements')
const scopePath = resolve(rootDir, 'scripts/data/preview-map/admin2-coverage-scope.json')
const manifestPath = resolve(rootDir, 'scripts/data/preview-map/boundary-source-manifest.json')
const requiredProperties = [
  'country_key',
  'display_name_local',
  'display_name_en',
  'display_name_zh',
  'name_zh_source',
  'source_id',
  'source_url',
  'source_authority',
  'source_license',
  'source_version',
  'subdivision_code',
  'parent_geo_key',
  'parent_name',
]

const scope = readJson(scopePath)
const whitelist = new Set(scope.candidates.map((candidate) => candidate.country_key))
const manifest = readJson(manifestPath)
const generatedSources = new Map(
  manifest.generated_geometry_sources
    .filter((source) => source.generated_file)
    .map((source) => [source.generated_file, source]),
)
const supplementFiles = readdirSync(supplementDir)
  .filter((file) => file.endsWith('.geojson'))
  .sort()

let featureCount = 0
for (const file of supplementFiles) {
  const absolutePath = resolve(supplementDir, file)
  const repositoryPath = relative(rootDir, absolutePath)
  const source = generatedSources.get(repositoryPath)
  if (!source)
    throw new Error(`ADM2 supplement is missing from the source manifest: ${repositoryPath}`)

  const bytes = readFileSync(absolutePath)
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== source.generated_sha256) {
    throw new Error(
      `ADM2 supplement checksum mismatch for ${repositoryPath}: expected ${source.generated_sha256}, got ${digest}`,
    )
  }

  const collection = JSON.parse(bytes.toString('utf8'))
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error(`Invalid ADM2 supplement FeatureCollection: ${repositoryPath}`)
  }

  const featuresByCountry = groupBy(collection.features, (feature) =>
    String(feature.properties?.country_key ?? ''),
  )
  for (const [countryKey, features] of featuresByCountry) {
    if (!whitelist.has(countryKey)) {
      throw new Error(
        `ADM2 supplement is outside the frozen whitelist: ${repositoryPath}:${countryKey}`,
      )
    }
    if (!source.countries?.includes(countryKey)) {
      throw new Error(`ADM2 supplement country is absent from its manifest entry: ${countryKey}`)
    }

    for (const [index, feature] of features.entries()) {
      const label = `${repositoryPath}:features[${index}]`
      if (!['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) {
        throw new Error(`${label} must contain Polygon/MultiPolygon geometry`)
      }
      for (const property of requiredProperties) {
        if (
          typeof feature.properties?.[property] !== 'string' ||
          !feature.properties[property].trim()
        ) {
          throw new Error(`${label}.${property} must be a non-empty string`)
        }
      }
      if (!/\p{Script=Han}/u.test(feature.properties.display_name_zh)) {
        throw new Error(`${label}.display_name_zh must contain Chinese characters`)
      }
      if (feature.properties.source_id !== source.id) {
        throw new Error(`${label}.source_id does not match the source manifest`)
      }
    }

    for (let leftIndex = 0; leftIndex < features.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < features.length; rightIndex += 1) {
        const overlap = polygonClipping.intersection(
          asMultiPolygon(features[leftIndex].geometry),
          asMultiPolygon(features[rightIndex].geometry),
        )
        if (multiPolygonArea(overlap) > 1e-12) {
          throw new Error(
            `Overlapping ADM2 supplements in ${countryKey}: ${features[leftIndex].properties.subdivision_code} and ${features[rightIndex].properties.subdivision_code}`,
          )
        }
      }
    }
  }
  featureCount += collection.features.length
}

for (const [generatedFile] of generatedSources) {
  if (!supplementFiles.includes(generatedFile.split('/').at(-1))) {
    throw new Error(`Source manifest points to a missing ADM2 supplement: ${generatedFile}`)
  }
}

console.log(
  `ADM2 supplement geometry audit passed: ${supplementFiles.length} file(s), ${featureCount} non-overlapping features.`,
)

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function groupBy(items, keyForItem) {
  const groups = new Map()
  for (const item of items) {
    const key = keyForItem(item)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  return groups
}

function asMultiPolygon(geometry) {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
}

function ringArea(ring) {
  return Math.abs(
    ring.reduce((sum, coordinate, index) => {
      const next = ring[(index + 1) % ring.length]
      return sum + coordinate[0] * next[1] - next[0] * coordinate[1]
    }, 0) / 2,
  )
}

function multiPolygonArea(multiPolygon) {
  return (multiPolygon ?? []).reduce(
    (sum, polygon) =>
      sum +
      ringArea(polygon[0]) -
      polygon.slice(1).reduce((holes, ring) => holes + ringArea(ring), 0),
    0,
  )
}
