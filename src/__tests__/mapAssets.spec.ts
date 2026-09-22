import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  legacyMapAssetUrls,
  mapAssetFailureRequiresGeoJson,
  resolveMapAssetUrls,
  runtimeRegionIndexLevelsForZoom,
} from '../utils/mapAssets'

const RUNTIME_FIELDS = [
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

describe('versioned map assets', () => {
  it('resolves every runtime URL from a valid immutable manifest', async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          mapVersion: 'map-20260831',
          baseUrl: '/map-assets/map-20260831',
        }),
        { status: 200 },
      )

    const assets = await resolveMapAssetUrls(fetcher as typeof fetch, '/manifest.json')

    expect(assets.manifestBacked).toBe(true)
    expect(assets.pmtiles).toBe(
      '/map-assets/map-20260831/tiles/wbe-preview-composite.pmtiles',
    )
    expect(assets.runtimeRegionIndexes.country).toBe(
      '/map-assets/map-20260831/geo/render/region-index-country.runtime.json',
    )
  })

  it('falls back to compatible legacy paths when the manifest is missing or inconsistent', async () => {
    const missing = await resolveMapAssetUrls(
      (async () => new Response('', { status: 404 })) as typeof fetch,
      '/missing.json',
    )
    const inconsistent = await resolveMapAssetUrls(
      (async () =>
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            mapVersion: 'v2',
            baseUrl: '/map-assets/v1',
          }),
          { status: 200 },
        )) as typeof fetch,
      '/bad.json',
    )

    expect(missing).toEqual(legacyMapAssetUrls())
    expect(inconsistent).toEqual(legacyMapAssetUrls())
  })

  it('loads runtime index levels progressively and treats PMTiles/font failures as fallback signals', () => {
    expect(runtimeRegionIndexLevelsForZoom(1.75)).toEqual(['country'])
    expect(runtimeRegionIndexLevelsForZoom(3.5)).toEqual(['country', 'admin1'])
    expect(runtimeRegionIndexLevelsForZoom(6.1)).toEqual(['country', 'admin1', 'city'])
    expect(mapAssetFailureRequiresGeoJson('protomaps', 'tile request failed')).toBe(true)
    expect(mapAssetFailureRequiresGeoJson('', 'glyph range failed')).toBe(true)
    expect(mapAssetFailureRequiresGeoJson('map-points-country', 'request failed')).toBe(false)
  })
})

describe('runtime region index shards', () => {
  it('preserves every audited key, coordinate, and bilingual name exactly', () => {
    const renderDirectory = resolve(process.cwd(), 'public/geo/render')
    const audit = JSON.parse(readFileSync(resolve(renderDirectory, 'region-index.json'), 'utf8'))

    for (const level of ['country', 'admin1', 'city']) {
      const shard = JSON.parse(
        readFileSync(resolve(renderDirectory, `region-index-${level}.runtime.json`), 'utf8'),
      )
      const expected = audit.regions
        .filter((entry: Record<string, unknown>) => entry.level === level)
        .map((entry: Record<string, unknown>) =>
          Object.fromEntries(
            RUNTIME_FIELDS.filter((field) => entry[field] !== undefined).map((field) => [
              field,
              entry[field],
            ]),
          ),
        )

      expect(shard.schemaVersion).toBe(1)
      expect(shard.level).toBe(level)
      expect(shard.regions).toEqual(expected)
    }
  })
})
