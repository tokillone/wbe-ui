#!/usr/bin/env node
import { existsSync, openSync, closeSync, readFileSync, readSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PMTiles } from 'pmtiles'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const generatedDir = resolve(rootDir, 'public/tiles/generated')
const archivePath = resolve(rootDir, 'public/tiles/wbe-regions.pmtiles')

class LocalFileSource {
  constructor(path) {
    this.path = path
  }

  getKey() {
    return this.path
  }

  async getBytes(offset, length) {
    const fd = openSync(this.path, 'r')
    try {
      const buffer = Buffer.alloc(length)
      const bytesRead = readSync(fd, buffer, 0, length, offset)
      return { data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead) }
    } finally {
      closeSync(fd)
    }
  }
}

const cityReport = readJson(resolve(generatedDir, 'world-cities-report.json'))
const regionReport = readJson(resolve(generatedDir, 'wbe_regions_report.json'))

assert(existsSync(archivePath), 'Missing public/tiles/wbe-regions.pmtiles')
assert(
  cityReport.countryCount + cityReport.reviewedWithoutGeometryCountryKeys.length ===
    cityReport.expectedCountryCount,
  'ADM2 coverage and reviewed no-geometry classifications do not cover every country key',
)
assert(
  JSON.stringify(cityReport.missingCountryKeys) ===
    JSON.stringify(cityReport.reviewedWithoutGeometryCountryKeys),
  'Missing city-equivalent country keys were not explicitly reviewed',
)
assert(
  cityReport.unexpectedMissingCountryKeys.length === 0,
  'Unreviewed city-equivalent country gaps remain',
)
assert(cityReport.featureCount >= 45_000, 'Unexpectedly small global city layer')
assert(
  cityReport.edgeTopology?.partitionField === 'country_key',
  'Global city edges were not partitioned by country',
)
assert(regionReport.duplicateRegionIds.length === 0, 'Duplicate region IDs')
assert(regionReport.missingGeoKey.length === 0, 'Missing region geo keys')
assert(regionReport.geometryCleaning.droppedFeatures.length === 0, 'Dropped region features')
assert(
  regionReport.featureCountByLevel.country === cityReport.expectedCountryCount,
  'Country layer coverage mismatch',
)
assert(
  regionReport.featureCountByLevel.city >= cityReport.featureCount,
  'City layer coverage mismatch',
)
assert(regionReport.geometryCleaning.rules.city.maxParts === 1, 'City fragment policy changed')
assert(
  Object.values(regionReport.topologyPolicy).every(Boolean),
  'Topology/coastline policy is not fully enabled',
)
assert(
  regionReport.topologyPolicy.cityEdgesPartitionedByCountry === true,
  'City boundary mesh can leak duplicate international borders',
)
assert(
  regionReport.featureCountByLayer.wbe_regions ===
    Object.values(regionReport.featureCountByLevel).reduce((sum, value) => sum + value, 0),
  'Polygon layer count mismatch',
)
assert(
  regionReport.featureCountByLayer.wbe_region_labels ===
    regionReport.featureCountByLayer.wbe_regions,
  'Every region must have one label point',
)
assert(
  regionReport.featureCountByLayer.wbe_region_boundaries ===
    regionReport.featureCountByLevel.country + regionReport.featureCountByLevel.admin1,
  'City coastlines leaked into the interactive outline layer',
)

const verifyResult = spawnSync('pmtiles', ['verify', archivePath], { stdio: 'inherit' })
assert(verifyResult.status === 0, 'PMTiles structural verification failed')

const archive = new PMTiles(new LocalFileSource(archivePath))
const header = await archive.getHeader()
const metadata = await archive.getMetadata()
assert(header.minZoom === 0 && header.maxZoom === 10, 'Unexpected PMTiles zoom range')
const layers = new Map((metadata.vector_layers ?? []).map((layer) => [layer.id, layer]))
for (const layerName of [
  'wbe_regions',
  'wbe_region_boundaries',
  'wbe_boundary_edges',
  'wbe_region_labels',
]) {
  assert(layers.has(layerName), `Missing PMTiles source layer: ${layerName}`)
}
const generatorOptions = String(metadata.generator_options ?? '')
for (const option of [
  '--no-feature-limit',
  '--no-tile-size-limit',
  '--no-tiny-polygon-reduction',
]) {
  assert(generatorOptions.includes(option), `Required Tippecanoe option missing: ${option}`)
}
const tileStats = new Map((metadata.tilestats?.layers ?? []).map((layer) => [layer.layer, layer]))
assert(
  tileStats.get('wbe_regions')?.count === regionReport.featureCountByLayer.wbe_regions,
  'PMTiles polygon count mismatch',
)
assert(
  tileStats.get('wbe_region_boundaries')?.count ===
    regionReport.featureCountByLayer.wbe_region_boundaries,
  'PMTiles interactive boundary count mismatch',
)
assert(
  tileStats.get('wbe_boundary_edges')?.count ===
    regionReport.featureCountByLayer.wbe_boundary_edges,
  'PMTiles topology edge count mismatch',
)
assert(
  tileStats.get('wbe_region_labels')?.count === regionReport.featureCountByLayer.wbe_region_labels,
  'PMTiles label count mismatch',
)
assert(
  tileStats.get('wbe_boundary_edges')?.geometry === 'LineString',
  'Topology edges are not real line geometry',
)
assert(tileStats.get('wbe_region_labels')?.geometry === 'Point', 'Labels are not point geometry')

console.log(
  `Verified ${regionReport.featureCountByLayer.wbe_regions} regions, ` +
    `${cityReport.countryCount} rendered ADM2 country keys, ` +
    `${cityReport.reviewedWithoutGeometryCountryKeys.length} reviewed no-geometry keys, ` +
    'and four PMTiles source layers.',
)

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
