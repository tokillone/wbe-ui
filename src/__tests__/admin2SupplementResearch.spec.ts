import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

// The audit utility is deliberately plain ESM so it can run directly in CI.
// @ts-expect-error JavaScript build helper has no declaration file.
import { auditAdmin2SupplementResearch } from '../../scripts/audit-admin2-supplement-research.mjs'

const root = process.cwd()
const scopePath = resolve(root, 'scripts/data/preview-map/admin2-coverage-scope.json')
const supplementsDir = resolve(root, 'scripts/data/preview-map/admin2-supplements')
const scriptPath = resolve(root, 'scripts/audit-admin2-supplement-research.mjs')

describe('ADM2 supplement research audit', () => {
  it('accepts the current parallel research packages only in explicit incomplete mode', () => {
    const output = execFileSync('node', [scriptPath, '--allow-incomplete'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(output).toContain('ADM2 supplement research audit passed (parallel/incomplete mode)')

    const result = auditAdmin2SupplementResearch({
      scopePath,
      supplementsDir,
      allowIncomplete: true,
    })
    expect(result.whitelist_count).toBe(60)
    expect(result.covered_count).toBeGreaterThan(0)
    expect(result.covered_count + result.missing_count).toBe(60)
  })

  it('requires all 60 whitelist entries in complete mode', () => {
    const incompleteResult = auditAdmin2SupplementResearch({
      scopePath,
      supplementsDir,
      allowIncomplete: true,
    })

    if (incompleteResult.missing_count === 0) {
      expect(() => auditAdmin2SupplementResearch({ scopePath, supplementsDir })).not.toThrow()
    } else {
      expect(() => auditAdmin2SupplementResearch({ scopePath, supplementsDir })).toThrow(
        `missing ${incompleteResult.missing_count} of 60 whitelist entries`,
      )
    }
  })

  it('independently verifies whitelist membership, uniqueness and required metadata', () => {
    const scope = JSON.parse(readFileSync(scopePath, 'utf8')) as {
      candidates: Array<{ country_key: string }>
    }
    const whitelist = new Set(scope.candidates.map((candidate) => candidate.country_key))
    const researchFiles = readdirSync(supplementsDir)
      .filter((fileName) => fileName.endsWith('-research.json'))
      .sort()
    const countryKeys: string[] = []

    for (const fileName of researchFiles) {
      const research = JSON.parse(readFileSync(resolve(supplementsDir, fileName), 'utf8')) as {
        candidates: Array<Record<string, unknown>>
      }
      for (const candidate of research.candidates) {
        expect(whitelist.has(candidate.country_key as string)).toBe(true)
        expect(candidate.display_name_zh).toEqual(expect.stringMatching(/\p{Script=Han}/u))
        expect(candidate.status).toEqual(expect.any(String))
        expect(candidate.official_hierarchy).toEqual(expect.any(Object))
        expect(candidate.geometry_source).toEqual(expect.any(Object))
        expect(candidate.chinese_name_source).toEqual(expect.any(Object))
        countryKeys.push(candidate.country_key as string)
      }
    }

    expect(new Set(countryKeys).size).toBe(countryKeys.length)
  })
})
