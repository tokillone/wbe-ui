import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchMethodologyData, sanitizeMethodologyData } from '../services/methodology'
import type { MethodologyRecord } from '../types/methodology'
import { aggregate, countRows } from '../utils/methodologyVerification'

const emptyOptions = {
  targetClass: [],
  category: [],
  country: [],
  prescription: [],
  samplingStandard: [],
  samplingClass: [],
  sampleObject: [],
  proportion: [],
  duration: [],
  passiveSampler: [],
}

describe('methodology service', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('assembles methodology data exclusively from split backend APIs', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      const data = url.endsWith('/overview')
        ? { sourceName: 'WBE汇总表.xlsx', rowCount: 22738 }
        : url.endsWith('/options')
          ? { samplingMethods: [], options: emptyOptions }
          : []
      return new Response(JSON.stringify({ code: 200, message: 'success', data }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchMethodologyData()

    expect(result.meta.rowCount).toBe(0)
    expect(result.meta.sourceName).toBe('WBE汇总表.xlsx')
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/methodology/overview',
      '/api/methodology/options',
      '/api/methodology/records',
    ])
    expect(fetchMock.mock.calls.flat().join(' ')).not.toContain('methodology-data.json')
  })
})

describe('methodology statistics contract', () => {
  const baseRecord: MethodologyRecord = {
    doc: 'WBE0001',
    doi: '10.1000/example',
    targetClass: '药物',
    category: '抗生素',
    subcategory: '示例',
    drug: 'Drug A',
    marker: 'Marker A',
    prescription: '处方药',
    samplingRaw: '24h composite',
    samplingStandard: '时间比例复合采样',
    samplingDetail: '24 h',
    samplingClass: '复合采样',
    sampleObject: '进水样',
    proportion: '时间比例',
    duration: '24 h',
    passiveSampler: '不适用',
    stationStatus: '已明确',
    analysisRaw: 'LC-MS/MS',
    analysisGroup: 'LC-MS/MS',
    country: 'China',
  }

  it('keeps row, document, document-method and prescription counting semantics', () => {
    const rows = [
      baseRecord,
      { ...baseRecord, marker: 'Marker B' },
      {
        ...baseRecord,
        marker: 'Marker C',
        samplingStandard: '抓取采样',
        samplingClass: '瞬时采样',
      },
      { ...baseRecord, doc: 'WBE0002', doi: '', prescription: '非处方药' },
    ]

    expect(countRows(rows, 'rows')).toBe(4)
    expect(countRows(rows, 'docs')).toBe(2)
    expect(countRows(rows, 'docMethods')).toBe(3)
    expect(aggregate(rows, 'prescription', 'docs')).toEqual([
      { name: '处方药', value: 1 },
      { name: '非处方药', value: 1 },
    ])
  })

  it('removes unavailable methodology values without discarding meaningful records', () => {
    const unavailableMethod = {
      ...baseRecord,
      doc: 'WBE0002',
      samplingStandard: 'N/A',
      samplingClass: 'NA',
    }
    const result = sanitizeMethodologyData({
      meta: {
        sourceName: 'WBE汇总表.xlsx',
        rowCount: 2,
        docCount: 2,
        drugCount: 2,
        markerCount: 2,
        countryCount: 2,
        samplingStandardCount: 2,
        samplingRingStandardCount: 1,
        samplingClassCount: 2,
        documentMethodCount: 2,
        documentRingMethodCount: 1,
        documentMethodDetailCount: 2,
        naDocumentCount: 1,
        analysisGroupCount: 1,
        auditRows: 2,
        impactRows: 2,
      },
      records: [
        { ...baseRecord, prescription: 'NA', country: 'N/A' },
        unavailableMethod,
      ],
      samplingMethods: [
        {
          standard: '时间比例复合采样',
          samplingClass: ['复合采样'],
          sampleObject: ['进水样'],
          proportion: ['时间比例', 'NA'],
          duration: ['24 h'],
          passiveSampler: ['不适用'],
          stationStatus: ['已明确', 'N/A'],
          auditSourceGroups: 1,
          impactRows: 1,
        },
        {
          standard: 'NA',
          samplingClass: ['NA'],
          sampleObject: [],
          proportion: [],
          duration: [],
          passiveSampler: [],
          stationStatus: [],
          auditSourceGroups: 1,
          impactRows: 1,
        },
      ],
      options: {
        ...emptyOptions,
        country: ['China', 'NA'],
        prescription: ['处方药', 'N/A'],
        samplingStandard: ['时间比例复合采样', 'NA'],
      },
    })

    expect(result.records).toHaveLength(1)
    expect(result.records[0]?.prescription).toBe('')
    expect(result.records[0]?.country).toBe('')
    expect(result.samplingMethods).toHaveLength(1)
    expect(result.samplingMethods[0]?.proportion).toEqual(['时间比例'])
    expect(result.samplingMethods[0]?.stationStatus).toEqual(['已明确'])
    expect(result.options.country).toEqual(['China'])
    expect(result.options.prescription).toEqual(['处方药'])
    expect(result.meta.rowCount).toBe(1)
    expect(result.meta.naDocumentCount).toBe(0)
  })
})
