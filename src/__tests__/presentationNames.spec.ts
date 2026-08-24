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
})
