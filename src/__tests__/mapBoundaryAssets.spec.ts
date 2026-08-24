import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { BoundaryFeatureCollection } from '../utils/mapBoundaryGeometry'
import { isMainlandChinaCity } from '../utils/mapVisualization'

type RegionIndexFixture = {
  regions: Array<{
    level: string
    geo_key: string
    label_point: [number, number]
  }>
}

type ControlledLabelFixture = {
  features: Array<{
    properties: { level?: string; country_key?: string; geo_key?: string }
    geometry: { coordinates: [number, number] }
  }>
}

function loadRenderAsset(file: string) {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'public/geo/render', file), 'utf8'),
  ) as BoundaryFeatureCollection
}

describe('cleaned map boundary assets', () => {
  it('keeps polygon and build-time line assets separate', () => {
    ;[
      'world-countries.geojson',
      'world-admin1.geojson',
      'china-provinces.geojson',
      'china-cities.geojson',
    ].forEach((file) => {
      const collection = loadRenderAsset(file)
      expect(collection.features.length).toBeGreaterThan(0)
      expect(
        collection.features.every((feature) =>
          ['Polygon', 'MultiPolygon'].includes(String((feature.geometry as any)?.type)),
        ),
      ).toBe(true)
      const lines = loadRenderAsset(file.replace('.geojson', '-lines.geojson'))
      expect(lines.features.length).toBeGreaterThan(0)
      expect(
        lines.features.every((feature) =>
          ['LineString', 'MultiLineString'].includes(String((feature.geometry as any)?.type)),
        ),
      ).toBe(true)
      expect(
        lines.features.some((feature) => /Polygon/.test(String((feature.geometry as any)?.type))),
      ).toBe(false)
    })
  })

  it('ships unique shared line segments without duplicated province or city borders', () => {
    ;[
      'world-countries-lines.geojson',
      'world-admin1-lines.geojson',
      'china-provinces-lines.geojson',
      'china-cities-lines.geojson',
    ].forEach((file) => {
      const collection = loadRenderAsset(file)
      const segments = new Set<string>()
      collection.features.forEach((feature) => {
        const geometry = feature.geometry as any
        const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates
        lines.forEach((line: number[][]) => {
          line.slice(1).forEach((point, index) => {
            const previous = line[index]!
            const left = `${previous[0]},${previous[1]}`
            const right = `${point[0]},${point[1]}`
            const key = left < right ? `${left}>${right}` : `${right}>${left}`
            expect(segments.has(key), `${file}: ${key}`).toBe(false)
            expect(Math.abs(point[0]! - previous[0]!)).toBeLessThan(180)
            segments.add(key)
          })
        })
      })
    })
  })

  it('keeps a single China administrative source for Hong Kong, Macao, and Taiwan', () => {
    const countries = loadRenderAsset('world-countries.geojson')
    const globalAdmin1 = loadRenderAsset('world-admin1.geojson')
    const chinaProvinces = loadRenderAsset('china-provinces.geojson')

    expect(
      countries.features.filter((feature) =>
        /hong.?kong|macao|macau|taiwan/i.test(String(feature.properties.country_key ?? '')),
      ),
    ).toEqual([])
    expect(
      globalAdmin1.features.filter((feature) =>
        ['china', 'hongkongsar', 'macausar', 'macaosar', 'taiwan'].includes(
          String(feature.properties.country_key ?? '').toLowerCase(),
        ),
      ),
    ).toEqual([])
    expect(
      chinaProvinces.features
        .map((feature) => String(feature.properties.geo_key ?? ''))
        .filter((key) => ['china|hongkong', 'china|aomen', 'china|taiwan'].includes(key))
        .sort(),
    ).toEqual(['china|aomen', 'china|hongkong', 'china|taiwan'])
  })

  it('ships a light unique region index for search and fitBounds', () => {
    const index = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public/geo/render/region-index.json'), 'utf8'),
    )
    const keys = index.regions.map((entry: any) => `${entry.level}|${entry.geo_key}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(
      index.regions.every(
        (entry: any) =>
          entry.center.length === 2 &&
          entry.label_point.length === 2 &&
          entry.bbox.length === 4 &&
          entry.area > 0,
      ),
    ).toBe(true)
  })

  it('uses every controlled China province label as the region display anchor', () => {
    const index = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public/geo/render/region-index.json'), 'utf8'),
    ) as RegionIndexFixture
    const controlled = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'scripts/data/preview-map/controlled-labels.geojson'),
        'utf8',
      ),
    ) as ControlledLabelFixture
    const entries = new Map<string, RegionIndexFixture['regions'][number]>(
      index.regions.map(
        (entry) =>
          [`${entry.level}|${entry.geo_key}`, entry] as [
            string,
            RegionIndexFixture['regions'][number],
          ],
      ),
    )
    const provinceLabels = controlled.features.filter(
      (feature) =>
        feature.properties?.level === 'admin1' && feature.properties?.country_key === 'china',
    )

    expect(provinceLabels).toHaveLength(34)
    provinceLabels.forEach((feature) => {
      const entry = entries.get(`admin1|${feature.properties.geo_key}`)
      expect(entry?.label_point, feature.properties.geo_key).toEqual(feature.geometry.coordinates)
    })
    expect(entries.get('admin1|china|gansu')?.label_point).toEqual([102.3, 38.5])
    expect(entries.get('admin1|china|hebei')?.label_point).toEqual([115.879104, 39.152231])
    expect(entries.get('admin1|china|shaanxi')?.label_point).toEqual([108.580731, 34.681609])
  })

  it('uses the validated central Vietnam country anchor', () => {
    const index = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public/geo/render/region-index.json'), 'utf8'),
    ) as RegionIndexFixture
    const vietnam = index.regions.find(
      (entry) => entry.level === 'country' && entry.geo_key === 'vietnam',
    )
    expect(vietnam?.label_point).toEqual([107.85, 16])
  })

  it('uses a detailed cleaned China land polygon at high zoom', () => {
    const countries = loadRenderAsset('world-countries.geojson')
    const china = countries.features.find(
      (feature) => String(feature.properties.country_key) === 'china',
    )
    expect(china?.properties.display_name).toBe('中国')
    let coordinateCount = 0
    const visit = (value: unknown) => {
      if (!Array.isArray(value)) return
      if (typeof value[0] === 'number') {
        coordinateCount += 1
        return
      }
      value.forEach(visit)
    }
    visit((china?.geometry as any)?.coordinates)
    expect(coordinateCount).toBeGreaterThan(10_000)
  })

  it('keeps Hong Kong, Macao, and Taiwan out of the mainland city mesh', () => {
    const cities = loadRenderAsset('china-cities.geojson')
    expect(
      cities.features.every((feature) =>
        isMainlandChinaCity(
          String(feature.properties.geo_key ?? ''),
          String(feature.properties.parent_geo_key ?? ''),
          String(feature.properties.province_key ?? ''),
        ),
      ),
    ).toBe(true)
    expect(
      cities.features.some((feature) =>
        /hong.?kong|macao|macau|taiwan|香港|澳门|台湾/i.test(
          JSON.stringify(feature.properties),
        ),
      ),
    ).toBe(false)
  })

  it('keeps exactly one non-overlapping display Polygon for Hong Kong and Macao', () => {
    const envelopes = loadRenderAsset('china-special-admin-envelopes.geojson')
    expect(envelopes.features).toHaveLength(2)
    expect(
      envelopes.features.map((feature) => String(feature.properties.geo_key)).sort(),
    ).toEqual(['china|aomen', 'china|hongkong'])
    expect(
      envelopes.features.every((feature) => (feature.geometry as any).type === 'Polygon'),
    ).toBe(true)

    const report = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'public/geo/render/boundary-quality-report.json'),
        'utf8',
      ),
    )
    expect(report.specialAdminEnvelopes.failures).toEqual([])
  })

  it('ships single display polygons for Hong Kong, Macao, and Zhuhai coastal islands', () => {
    const envelopes = loadRenderAsset('china-coastal-display-envelopes.geojson')
    expect(envelopes.features).toHaveLength(3)
    expect(
      envelopes.features.map((feature) => String(feature.properties.geo_key)).sort(),
    ).toEqual(['china|aomen', 'china|guangdong|zhuhai', 'china|hongkong'])
    expect(
      envelopes.features.every((feature) => (feature.geometry as any).type === 'Polygon'),
    ).toBe(true)
    const zhuhai = envelopes.features.find(
      (feature) => feature.properties.geo_key === 'china|guangdong|zhuhai',
    )
    expect(zhuhai?.properties.component_count_before).toBeGreaterThan(1)
    expect(zhuhai?.properties.component_count_after).toBe(1)

    const report = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'public/geo/render/boundary-quality-report.json'),
        'utf8',
      ),
    )
    expect(report.coastalDisplayEnvelopes.failures).toEqual([])
    expect(report.coastalDisplayEnvelopes.singlePolygonCount).toBe(3)
  })

  it('has no post-clean self-intersections or broken rings in the quality report', () => {
    const report = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'public/geo/render/boundary-quality-report.json'),
        'utf8',
      ),
    )

    expect(report.totals.selfIntersectionsAfterClean).toBe(0)
    expect(report.parentRelationships.orphanChinaCities).toEqual([])
    expect(report.sources.every((source: any) => source.unclosedRings.length === 0)).toBe(true)
    expect(report.sources.every((source: any) => source.zeroLengthSegments.length === 0)).toBe(true)
    expect(
      report.sources.every((source: any) => source.lineValidation.duplicateSegments.length === 0),
    ).toBe(true)
    expect(
      report.sources.every((source: any) => source.lineValidation.antimeridianJumps.length === 0),
    ).toBe(true)
    expect(
      report.sources.every((source: any) => source.spikeRepairMetrics.excessiveRepairs.length === 0),
    ).toBe(true)
  })

  it('ships a zero-result Z8 tolerant boundary overlap audit', () => {
    const report = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'public/tiles/generated/preview-composite-report.json'),
        'utf8',
      ),
    )
    const cleanup = report.renderedBoundaryCleanup
    const audit = report.tolerantBoundaryOverlapAudit

    expect(cleanup).toMatchObject({
      zoom: 8,
      tolerancePx: 1.25,
      maxAngleDegrees: 8,
      minOverlapPx: 2,
      minCandidateOverlapRatio: 0.7,
    })
    expect(audit.totalDuplicateLikeSegmentCount).toBe(0)
    expect(
      Object.values(audit.layers).every(
        (layer: any) => layer.total === 0,
      ),
    ).toBe(true)
    expect(audit.pairs.every((pair: any) => pair.total === 0)).toBe(true)

    const southeastAsia = ['laos', 'myanmar', 'cambodia', 'thailand', 'vietnam']
    const removedNearByCountry = new Map<string, number>()
    Object.values(cleanup.layers).forEach((layer: any) => {
      Object.entries(layer.removedByCountry).forEach(([country, counts]: [string, any]) => {
        removedNearByCountry.set(country, (removedNearByCountry.get(country) ?? 0) + counts.near)
      })
    })
    southeastAsia.forEach((country) => {
      expect(removedNearByCountry.get(country), country).toBeGreaterThan(0)
    })
  })
})
