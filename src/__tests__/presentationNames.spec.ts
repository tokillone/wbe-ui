import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

// The build utility is deliberately plain ESM so the tile build can run without
// importing the browser application bundle.
// @ts-expect-error JavaScript build helper has no declaration file.
import { buildPresentationNameResolver } from '../../scripts/presentation-names.mjs'

const temporaryDirectories: string[] = []

afterEach(() => {
  temporaryDirectories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
})

function fixtureResolver() {
  const directory = mkdtempSync(join(tmpdir(), 'wbe-presentation-names-'))
  temporaryDirectories.push(directory)
  const cldrSnapshotPath = join(directory, 'cldr.json')
  const officialOverridesPath = join(directory, 'official.json')
  writeFileSync(
    cldrSnapshotPath,
    JSON.stringify({
      cldr_version: '48',
      sources: {
        en: { url: 'https://example.test/en.xml', sha256: 'a'.repeat(64) },
        zh: { url: 'https://example.test/zh.xml', sha256: 'b'.repeat(64) },
      },
      entries: [
        {
          code: 'frara',
          country_code: 'FR',
          display_name_en: 'Auvergne-Rhône-Alpes',
          display_name_zh: '奥弗涅-罗讷-阿尔卑斯',
        },
        {
          code: 'chzh',
          country_code: 'CH',
          display_name_en: 'Zürich',
          display_name_zh: '苏黎世州',
        },
        {
          code: 'eglx',
          country_code: 'EG',
          display_name_en: 'Luxor',
          display_name_zh: '卢克索省',
        },
        {
          code: 'uswa',
          country_code: 'US',
          display_name_en: 'Washington',
          display_name_zh: '华盛顿州',
        },
      ],
    }),
  )
  writeFileSync(
    officialOverridesPath,
    JSON.stringify({
      entries: [
        {
          country_key: 'france',
          presentation_level: 'adm1',
          source_geo_key: 'official-france-region',
          display_name_zh: '官方覆盖名',
          authority: 'Fixture authority',
          source_url: 'https://example.test/source',
          retrieved_at: '2026-08-21',
        },
      ],
    }),
  )
  return buildPresentationNameResolver({
    countries: {
      features: [
        { properties: { country_key: 'france', 'ISO3166-1-Alpha-2': 'FR' } },
        { properties: { country_key: 'switzerland', 'ISO3166-1-Alpha-2': 'CH' } },
        { properties: { country_key: 'china', 'ISO3166-1-Alpha-2': 'CN' } },
        { properties: { country_key: 'egypt', 'ISO3166-1-Alpha-2': 'EG' } },
        { properties: { country_key: 'unitedsofamerica', 'ISO3166-1-Alpha-2': 'US' } },
      ],
    },
    controlledLabels: {
      features: [
        {
          properties: {
            country_key: 'china',
            geo_key: 'china|henan',
            display_name: '河南省',
            display_name_zh: '河南省',
            display_name_en: 'Henan',
          },
        },
      ],
    },
    canonicalAdmin1: {
      features: [
        {
          properties: {
            country_key: 'laos',
            geo_key: 'laos|vientianeprovince',
            display_name: 'Vientiane Province',
            keys: ['laos|vientianeprovince', 'laos|万象省'],
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [100, 10],
                [102, 10],
                [102, 12],
                [100, 12],
                [100, 10],
              ],
            ],
          },
        },
        {
          properties: {
            country_key: 'vietnam',
            geo_key: 'vietnam|caobang',
            display_name: 'Cao Bang',
            keys: ['vietnam|caobang', 'vietnam|高平省'],
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [105, 20],
                [107, 20],
                [107, 23],
                [105, 23],
                [105, 20],
              ],
            ],
          },
        },
        ...[0, 2].map((offset) => ({
          properties: {
            country_key: 'testland',
            geo_key: `testland|central${offset}`,
            display_name: 'Central',
            keys: [`testland|central`, `testland|中部${offset}`],
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [offset, 0],
                [offset + 1, 0],
                [offset + 1, 1],
                [offset, 1],
                [offset, 0],
              ],
            ],
          },
        })),
      ],
    },
    cldrSnapshotPath,
    officialOverridesPath,
  })
}

describe('presentation administrative names', () => {
  it('uses a sourced official override before an exact CLDR 48 match', () => {
    const resolver = fixtureResolver()
    const result = resolver.resolve({
      countryKey: 'france',
      presentationLevel: 'adm1',
      geoKey: 'france|region',
      sourceGeoKey: 'official-france-region',
      localName: 'Auvergne-Rhône-Alpes',
    })
    expect(result.display_name_zh).toBe('官方覆盖名')
    expect(result.display_name_local).toBe('Auvergne-Rhône-Alpes')
    expect(result.name_zh_source).toBe('official-override')
    expect(result.name_zh_verified).toBe(true)

    const otherLevel = resolver.resolve({
      countryKey: 'france',
      presentationLevel: 'adm2',
      geoKey: 'france|region',
      sourceGeoKey: 'official-france-region',
      localName: 'Auvergne-Rhône-Alpes',
    })
    expect(otherLevel.name_zh_source).toBe('unicode-cldr-48')
    expect(otherLevel.display_name_zh).toBe('奥弗涅-罗讷-阿尔卑斯')
  })

  it('matches CLDR only within the same country using an exact normalized name', () => {
    const resolver = fixtureResolver()
    const exact = resolver.resolve({
      countryKey: 'switzerland',
      presentationLevel: 'adm1',
      geoKey: 'switzerland|zurich',
      sourceGeoKey: 'ch-zh',
      localName: 'Zurich',
    })
    expect(exact.display_name_zh).toBe('苏黎世州')
    expect(exact.name_zh_source).toBe('unicode-cldr-48')

    const crossCountry = resolver.resolve({
      countryKey: 'france',
      presentationLevel: 'adm1',
      geoKey: 'france|zurich',
      sourceGeoKey: 'fr-zurich',
      localName: 'Zürich',
    })
    expect(crossCountry.display_name_zh).toBe('')
    expect(crossCountry.display_name_local).toBe('Zürich')
    expect(crossCountry.name_zh_source).toBe('original-local')
    expect(crossCountry.name_zh_verified).toBe(false)
  })

  it('matches a unique CLDR name after removing an administrative suffix', () => {
    const resolver = fixtureResolver()
    const result = resolver.resolve({
      countryKey: 'egypt',
      presentationLevel: 'adm1',
      geoKey: 'egypt|luxor',
      sourceGeoKey: 'eg-luxor',
      localName: 'Luxor Governate',
    })
    expect(result.display_name_zh).toBe('卢克索省')
    expect(result.name_zh_source).toBe('unicode-cldr-48')
    expect(resolver.report().normalizedCldrMatchCount).toBe(1)
  })

  it('rejects an ADM2 name that collides with a verified ADM1 subdivision code', () => {
    const resolver = fixtureResolver()
    const result = resolver.resolve({
      countryKey: 'unitedsofamerica',
      presentationLevel: 'adm2',
      geoKey: 'unitedsofamerica|indiana|washington',
      sourceGeoKey: 'unitedsofamerica|indiana|washington',
      localName: 'Washington',
      blockedCldrSubdivisionCodes: new Set(['uswa']),
    })
    expect(result.display_name_zh).toBe('')
    expect(result.display_name_local).toBe('Washington')
    expect(result.name_zh_source).toBe('cross-level-cldr-rejected')
    expect(result.name_zh_verified).toBe(false)
    expect(resolver.report().crossLevelCldrRejectCount).toBe(1)
  })

  it('never writes an English fallback into the Chinese field', () => {
    const resolver = fixtureResolver()
    const result = resolver.resolve({
      countryKey: 'france',
      presentationLevel: 'adm1',
      geoKey: 'france|unknown',
      sourceGeoKey: 'fr-unknown',
      localName: 'Source Local Name',
    })
    expect(result.display_name_zh).toBe('')
    expect(result.display_name_local).toBe('Source Local Name')
    expect(result.name_zh_verified).toBe(false)
  })

  it('keeps China labels Chinese instead of exposing their pinyin alias', () => {
    const resolver = fixtureResolver()
    const result = resolver.resolve({
      countryKey: 'china',
      presentationLevel: 'adm1',
      geoKey: 'china|henan',
      sourceGeoKey: 'china|henan',
      localName: '河南省',
      aliases: ['Henan'],
    })
    expect(result.display_name_zh).toBe('河南省')
    expect(result.display_name_local).toBe('河南省')
    expect(result.name_zh_source).toBe('china-standard')
  })

  it('reuses a canonical Chinese alias only for a same-country unique name', () => {
    const resolver = fixtureResolver()
    const result = resolver.resolve({
      countryKey: 'laos',
      presentationLevel: 'adm1',
      geoKey: 'laos|vientiane',
      sourceGeoKey: 'LAO-123',
      localName: 'Vientiane Province',
    })
    expect(result.display_name_zh).toBe('万象省')
    expect(result.name_zh_source).toBe('canonical-admin1-unique-name')
    expect(result.name_zh_verified).toBe(true)
  })

  it('uses a mutual-best same-country polygon overlap after name matching', () => {
    const resolver = fixtureResolver()
    const geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [105, 20],
          [107, 20],
          [107, 23],
          [105, 23],
          [105, 20],
        ],
      ],
    }
    resolver.prepareSpatialMatches([
      { countryKey: 'vietnam', spatialKey: 'VNM-1', geometry },
    ])
    const result = resolver.resolve({
      countryKey: 'vietnam',
      presentationLevel: 'adm1',
      geoKey: 'vietnam|unknown-source-name',
      sourceGeoKey: 'VNM-1',
      localName: 'Unknown local name',
      spatialKey: 'VNM-1',
    })
    expect(result.display_name_zh).toBe('高平省')
    expect(result.name_zh_source).toBe('canonical-admin1-unique-spatial')
    expect(resolver.report().spatialMatchCount).toBe(1)
  })

  it('does not treat a single contained point as verified spatial evidence', () => {
    const resolver = fixtureResolver()
    const result = resolver.resolve({
      countryKey: 'vietnam',
      presentationLevel: 'adm1',
      geoKey: 'vietnam|unknown-source-name',
      sourceGeoKey: 'VNM-1',
      localName: 'Unknown local name',
      labelPoint: [106, 21],
    })
    expect(result.display_name_zh).toBe('')
    expect(result.name_zh_verified).toBe(false)
  })

  it('normalizes administrative suffixes only when the same-country match is unique', () => {
    const resolver = fixtureResolver()
    const result = resolver.resolve({
      countryKey: 'laos',
      presentationLevel: 'adm1',
      geoKey: 'laos|vientiane',
      sourceGeoKey: 'LAO-123',
      localName: 'Vientiane Governorate',
    })
    expect(result.display_name_zh).toBe('万象省')
    expect(result.name_zh_source).toBe('canonical-admin1-unique-name')
    expect(resolver.report().normalizedNameMatchCount).toBe(1)
  })

  it('rejects ambiguous canonical names and never writes them into the Chinese field', () => {
    const resolver = fixtureResolver()
    const result = resolver.resolve({
      countryKey: 'testland',
      presentationLevel: 'adm1',
      geoKey: 'testland|central',
      sourceGeoKey: 'central',
      localName: 'Central',
    })
    expect(result.display_name_zh).toBe('')
    expect(result.name_zh_verified).toBe(false)
    expect(resolver.report().ambiguousNameMatchCount).toBe(1)
  })

  it('blocks corrupt names and falls back to a clean alias without polluting Chinese', () => {
    const resolver = fixtureResolver()
    const result = resolver.resolve({
      countryKey: 'france',
      presentationLevel: 'adm2',
      geoKey: 'france|broken',
      sourceGeoKey: 'broken',
      localName: 'Cao B?ng',
      aliases: ['Cao Bang'],
    })
    expect(result.display_name_local).toBe('Cao Bang')
    expect(result.display_name_en).toBe('Cao Bang')
    expect(result.display_name_zh).toBe('')
    expect(resolver.report().corruptRejectedCount).toBe(1)
  })
})
