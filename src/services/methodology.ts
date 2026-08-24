import type {
  MethodologyData,
  MethodologyMeta,
  MethodologyOptions,
  MethodologyRecord,
  SamplingMethodMeta,
} from '@/types/methodology'

import { requestApi } from './api'

interface MethodologyOptionsPayload {
  samplingMethods: SamplingMethodMeta[]
  options: MethodologyOptions
}

const OPTION_KEYS = [
  'targetClass',
  'category',
  'country',
  'prescription',
  'samplingStandard',
  'samplingClass',
  'sampleObject',
  'proportion',
  'duration',
  'passiveSampler',
] as const satisfies readonly (keyof MethodologyOptions)[]

const SAMPLING_META_ARRAY_KEYS = [
  'samplingClass',
  'sampleObject',
  'proportion',
  'duration',
  'passiveSampler',
  'stationStatus',
] as const satisfies readonly (keyof SamplingMethodMeta)[]

export function isUnavailableMethodologyValue(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/[\s/._-]+/g, '')
    .toUpperCase() === 'NA'
}

function documentKey(row: MethodologyRecord) {
  return row.doc || row.doi || `${row.drug}|${row.marker}`
}

function sanitizeRecord(row: MethodologyRecord): MethodologyRecord {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      isUnavailableMethodologyValue(value) ? '' : value,
    ]),
  ) as unknown as MethodologyRecord
}

function sanitizeMethodMeta(meta: SamplingMethodMeta): SamplingMethodMeta {
  const sanitized = { ...meta }
  for (const key of SAMPLING_META_ARRAY_KEYS) {
    const value = sanitized[key]
    if (Array.isArray(value)) {
      ;(sanitized[key] as string[]) = value.filter(
        (item) => !isUnavailableMethodologyValue(item),
      )
    }
  }
  return sanitized
}

function uniqueRecordValues(rows: MethodologyRecord[], field: keyof MethodologyRecord) {
  return new Set(rows.map((row) => row[field]).filter(Boolean)).size
}

function uniqueRecordPairs(
  rows: MethodologyRecord[],
  value: (row: MethodologyRecord) => string,
) {
  return new Set(
    rows
      .map((row) => {
        const current = value(row)
        return current ? JSON.stringify([documentKey(row), current]) : ''
      })
      .filter(Boolean),
  ).size
}

export function sanitizeMethodologyData(data: MethodologyData): MethodologyData {
  const records = data.records
    .filter((row) => !isUnavailableMethodologyValue(row.samplingStandard))
    .map(sanitizeRecord)
  const samplingMethods = data.samplingMethods
    .filter((item) => !isUnavailableMethodologyValue(item.standard))
    .map(sanitizeMethodMeta)
  const options = { ...data.options }
  for (const key of OPTION_KEYS) {
    options[key] = data.options[key].filter(
      (item) => !isUnavailableMethodologyValue(item),
    )
  }

  const documentMethodCount = uniqueRecordPairs(
    records,
    (row) => row.samplingStandard,
  )
  return {
    meta: {
      ...data.meta,
      rowCount: records.length,
      docCount: new Set(records.map(documentKey).filter(Boolean)).size,
      drugCount: uniqueRecordValues(records, 'drug'),
      markerCount: uniqueRecordValues(records, 'marker'),
      countryCount: uniqueRecordValues(records, 'country'),
      samplingStandardCount: uniqueRecordValues(records, 'samplingStandard'),
      samplingRingStandardCount: uniqueRecordValues(records, 'samplingStandard'),
      samplingClassCount: uniqueRecordValues(records, 'samplingClass'),
      documentMethodCount,
      documentRingMethodCount: documentMethodCount,
      documentMethodDetailCount: uniqueRecordPairs(
        records,
        (row) => row.samplingDetail,
      ),
      naDocumentCount: 0,
      analysisGroupCount: uniqueRecordValues(records, 'analysisGroup'),
      auditRows: samplingMethods.reduce(
        (sum, item) => sum + item.auditSourceGroups,
        0,
      ),
      impactRows: records.length,
    },
    records,
    samplingMethods,
    options,
  }
}

export function fetchMethodologyOverview() {
  return requestApi<MethodologyMeta>('/methodology/overview')
}

export function fetchMethodologyOptions() {
  return requestApi<MethodologyOptionsPayload>('/methodology/options')
}

export function fetchMethodologyRecords() {
  return requestApi<MethodologyRecord[]>('/methodology/records')
}

export async function fetchMethodologyData(): Promise<MethodologyData> {
  const [meta, optionsPayload, records] = await Promise.all([
    fetchMethodologyOverview(),
    fetchMethodologyOptions(),
    fetchMethodologyRecords(),
  ])
  return sanitizeMethodologyData({
    meta,
    records,
    samplingMethods: optionsPayload.samplingMethods,
    options: optionsPayload.options,
  })
}
