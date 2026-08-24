#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = resolve(
  process.env.PREVIEW_NAME_SNAPSHOT_OUTPUT ||
    `${rootDir}/scripts/data/preview-map/cldr-subdivisions-48.json`,
)
const CLDR_VERSION = '48'
const CLDR_BASE_URL = `https://raw.githubusercontent.com/unicode-org/cldr/release-${CLDR_VERSION}/common/subdivisions`
const sourceUrls = {
  en: `${CLDR_BASE_URL}/en.xml`,
  zh: `${CLDR_BASE_URL}/zh.xml`,
}

const [englishXml, chineseXml] = await Promise.all([
  fetchText(sourceUrls.en),
  fetchText(sourceUrls.zh),
])
const english = parseSubdivisionXml(englishXml)
const chinese = parseSubdivisionXml(chineseXml)
const entries = [...english.entries()]
  .map(([code, source]) => ({
    code,
    country_code: code.slice(0, 2).toUpperCase(),
    display_name_en: source.value,
    display_name_zh: chinese.get(code)?.value ?? '',
    zh_draft_status: chinese.get(code)?.draft ?? '',
  }))
  .sort((left, right) => left.code.localeCompare(right.code))

const snapshot = {
  schema_version: 1,
  cldr_version: CLDR_VERSION,
  license: 'Unicode-3.0',
  sources: {
    en: { url: sourceUrls.en, sha256: sha256(englishXml) },
    zh: { url: sourceUrls.zh, sha256: sha256(chineseXml) },
  },
  entries,
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(
  `Prepared ${entries.length} CLDR subdivisions (${entries.filter((entry) => entry.display_name_zh).length} Chinese names).`,
)

async function fetchText(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Unable to download ${url}: HTTP ${response.status}`)
  return response.text()
}

function parseSubdivisionXml(xml) {
  const result = new Map()
  const pattern = /<subdivision\s+type="([^"]+)"([^>]*)>([^<]+)<\/subdivision>/g
  for (const match of xml.matchAll(pattern)) {
    const code = match[1]
    const attributes = match[2]
    const value = decodeXml(match[3]).trim()
    if (!code || !value) continue
    const draft = attributes.match(/\sdraft="([^"]+)"/)?.[1] ?? ''
    result.set(code, { value, draft })
  }
  return result
}

function decodeXml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}
