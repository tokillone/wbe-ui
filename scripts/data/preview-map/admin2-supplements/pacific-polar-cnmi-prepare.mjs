import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import polygonClipping from 'polygon-clipping'

const SOURCE = {
  id: 'us-census-tiger-2020-mp-cousub',
  url: 'https://www2.census.gov/geo/tiger/TIGER2020/COUSUB/tl_2020_69_cousub.zip',
  authority: 'United States Census Bureau',
  license: 'U.S. federal government work; public domain',
  version: '2020 TIGER/Line',
  sha256: '2065ab34369cda4208b9ec06d9b5ab135da959a776cdb86cf10495a2073f773a',
}

const PARENTS = {
  '085': {
    geoKey: 'northernmarianaislands|northernislands',
    name: 'Northern Islands',
  },
  100: {
    geoKey: 'northernmarianaislands|rota',
    name: 'Rota',
  },
  110: {
    geoKey: 'northernmarianaislands|saipan',
    name: 'Saipan',
  },
  120: {
    geoKey: 'northernmarianaislands|tinian',
    name: 'Tinian',
  },
}

const here = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(here, '../../../..')
const mapshaperPath = resolve(repositoryRoot, 'node_modules/.bin/mapshaper')
const outputPath = resolve(here, 'pacific-polar-cnmi.geojson')
const workDirectory = mkdtempSync(join(tmpdir(), 'pacific-polar-cnmi-'))
const archivePath = join(workDirectory, 'tl_2020_69_cousub.zip')
const sourceGeojsonPath = join(workDirectory, 'cnmi-cousub.geojson')

const asMultiPolygon = (geometry) =>
  geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates

const ringArea = (ring) =>
  Math.abs(
    ring.reduce((sum, coordinate, index) => {
      const next = ring[(index + 1) % ring.length]
      return sum + coordinate[0] * next[1] - next[0] * coordinate[1]
    }, 0) / 2,
  )

const multiPolygonArea = (multiPolygon) =>
  (multiPolygon ?? []).reduce(
    (sum, polygon) =>
      sum + ringArea(polygon[0]) - polygon.slice(1).reduce((holes, ring) => holes + ringArea(ring), 0),
    0,
  )

try {
  const response = await fetch(SOURCE.url)
  if (!response.ok) {
    throw new Error(`TIGER/Line download failed: ${response.status} ${response.statusText}`)
  }
  writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()))

  const digest = createHash('sha256').update(readFileSync(archivePath)).digest('hex')
  if (digest !== SOURCE.sha256) {
    throw new Error(`TIGER/Line checksum mismatch: expected ${SOURCE.sha256}, got ${digest}`)
  }

  execFileSync('unzip', ['-q', archivePath, '-d', workDirectory], { stdio: 'inherit' })
  execFileSync(
    mapshaperPath,
    [
      join(workDirectory, 'tl_2020_69_cousub.shp'),
      '-proj',
      'wgs84',
      '-o',
      'format=geojson',
      'precision=0.000001',
      sourceGeojsonPath,
    ],
    { stdio: 'inherit' },
  )

  const source = JSON.parse(readFileSync(sourceGeojsonPath, 'utf8'))
  const features = source.features
    .filter((feature) => feature.properties.COUSUBFP !== '00000')
    .map((feature) => {
      const districtNumber = String(feature.properties.NAME ?? '')
      const parentCode = String(feature.properties.COUNTYFP ?? '')
      const subdivisionCode = String(feature.properties.GEOID ?? '')
      const parent = PARENTS[parentCode]

      if (!parent || !/^[1-7]$/.test(districtNumber) || !/^69\d{8}$/.test(subdivisionCode)) {
        throw new Error(`Unexpected CNMI district record: ${JSON.stringify(feature.properties)}`)
      }
      if (!['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) {
        throw new Error(`Unsupported geometry for ${subdivisionCode}: ${feature.geometry?.type}`)
      }

      const displayNameEn = `District ${districtNumber}`
      return {
        type: 'Feature',
        properties: {
          country_key: 'northernmarianaislands',
          display_name_local: displayNameEn,
          display_name_en: displayNameEn,
          display_name_zh: `第${districtNumber}选区`,
          name_zh_source:
            '美国人口普查局 2020 TIGER/Line 法定编号选区：District n → 第n选区',
          source_id: SOURCE.id,
          source_url: SOURCE.url,
          source_authority: SOURCE.authority,
          source_license: SOURCE.license,
          source_version: SOURCE.version,
          subdivision_code: subdivisionCode,
          parent_geo_key: parent.geoKey,
          parent_name: parent.name,
        },
        geometry: feature.geometry,
      }
    })
    .sort((left, right) =>
      left.properties.subdivision_code.localeCompare(right.properties.subdivision_code),
    )

  if (features.length !== 8) {
    throw new Error(`Expected 8 land election-district features, got ${features.length}`)
  }
  if (features.some((feature) => !/^第[1-7]选区$/.test(feature.properties.display_name_zh))) {
    throw new Error('Every CNMI election district must have a verified non-empty Chinese name')
  }
  const districtFour = features.filter(
    (feature) => feature.properties.display_name_zh === '第4选区',
  )
  if (
    districtFour.length !== 2 ||
    new Set(districtFour.map((feature) => feature.properties.parent_geo_key)).size !== 2
  ) {
    throw new Error('District 4 must remain as two features under two distinct ADM1 parents')
  }

  for (let leftIndex = 0; leftIndex < features.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < features.length; rightIndex += 1) {
      const overlap = polygonClipping.intersection(
        asMultiPolygon(features[leftIndex].geometry),
        asMultiPolygon(features[rightIndex].geometry),
      )
      if (multiPolygonArea(overlap) > 1e-12) {
        throw new Error(
          `Overlapping districts: ${features[leftIndex].properties.subdivision_code} and ${features[rightIndex].properties.subdivision_code}`,
        )
      }
    }
  }

  // The complete TIGER COUSUB layer (including COUSUBFP=00000 water/undefined
  // polygons) is the source-consistent Census territory face. Do not clip the
  // official districts to the repository's generalized display coastline.
  const territoryFace = polygonClipping.union(
    ...source.features.map((feature) => asMultiPolygon(feature.geometry)),
  )
  for (const feature of features) {
    const outside = polygonClipping.difference(asMultiPolygon(feature.geometry), territoryFace)
    if (multiPolygonArea(outside) > 1e-12) {
      throw new Error(
        `District ${feature.properties.subdivision_code} is outside the Census CNMI territory face`,
      )
    }
  }

  writeFileSync(
    outputPath,
    `${JSON.stringify({
      type: 'FeatureCollection',
      name: 'pacific-polar-cnmi-official-adm2',
      features,
    })}\n`,
  )
  console.log(`Wrote ${features.length} CNMI ADM2 features to ${outputPath}`)
} finally {
  rmSync(workDirectory, { recursive: true, force: true })
}
