import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = process.cwd()
const scopePath = resolve(root, 'scripts/data/preview-map/admin2-coverage-scope.json')
const cityReportPath = resolve(root, 'public/tiles/generated/world-cities-report.json')
const regionIndexPath = resolve(root, 'public/geo/render/region-index.json')
const prepareSource = readFileSync(resolve(root, 'scripts/prepare-global-admin2.mjs'), 'utf8')

describe('ADM2 supplement protection scope', () => {
  it('freezes existing ADM2 countries and limits supplements to the reviewed whitelist', () => {
    const scope = JSON.parse(readFileSync(scopePath, 'utf8'))
    expect(scope.hierarchy).toBe('country-adm1-adm2')
    expect(scope.candidate_count).toBe(60)
    expect(scope.protected_count).toBe(195)
    expect(scope.candidates).toHaveLength(60)
    expect(scope.protected_countries).toHaveLength(195)
    expect(
      scope.candidates.find((item: { country_key: string }) => item.country_key === 'china'),
    ).toBeUndefined()
    expect(
      scope.candidates.find((item: { country_key: string }) => item.country_key === 'sintmaarten')
        ?.display_name_zh,
    ).toBe('荷属圣马丁')
  })

  it('detects any change to protected boundaries', () => {
    expect(() =>
      execFileSync('node', ['scripts/audit-admin2-supplement-scope.mjs'], {
        cwd: root,
        stdio: 'pipe',
      }),
    ).not.toThrow()
  })

  it('audits supplement checksums, Chinese names and zero-overlap geometry offline', () => {
    const output = execFileSync('node', ['scripts/audit-admin2-supplement-geometry.mjs'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(output).toContain('1 file(s), 8 non-overlapping features')
  })

  it('rejects supplements outside the whitelist and requires explicit provenance', () => {
    expect(prepareSource).toContain('supplementCountryAllowlist.has(countryKey)')
    expect(prepareSource).toContain('outside the reviewed whitelist')
    expect(prepareSource).toContain('sourceAuthority')
    expect(prepareSource).toContain('sourceLicense')
    expect(prepareSource).toContain('displayNameZh')
    expect(prepareSource).toContain("sourceLevel: 'official_supplement_adm2'")
  })

  it('does not promote reviewed ADM1 or country polygons into fake ADM2 coverage', () => {
    const report = JSON.parse(readFileSync(cityReportPath, 'utf8'))
    expect(report.unexpectedMissingCountryKeys).toEqual([])
    expect(report.missingCountryKeys).toEqual(report.reviewedWithoutGeometryCountryKeys)
    expect(report.countryCount + report.reviewedWithoutGeometryCountryKeys.length).toBe(
      report.expectedCountryCount,
    )
    expect(prepareSource).toContain('if (reviewedCountryKeys.has(countryKey)) continue')
  })

  it('keeps every imported CNMI district under a real Chinese ADM1 parent', () => {
    const index = JSON.parse(readFileSync(regionIndexPath, 'utf8')) as {
      regions: Array<Record<string, unknown>>
    }
    const regionsByKey = new Map(index.regions.map((region) => [region.geo_key, region]))
    const districts = index.regions.filter(
      (region) => region.source_level === 'official_supplement_adm2',
    )

    expect(districts).toHaveLength(8)
    for (const district of districts) {
      const parent = regionsByKey.get(district.parent_geo_key)
      expect(parent?.level).toBe('admin1')
      expect(parent?.display_name_zh).toEqual(expect.stringMatching(/\p{Script=Han}/u))
    }
    expect(regionsByKey.get('northernmarianaislands|northernislands')?.display_name_zh).toBe(
      '北部群岛镇',
    )
  })
})
