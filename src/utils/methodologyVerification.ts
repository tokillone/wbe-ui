import type {
  MethodologyFilterState,
  MethodologyMode,
  MethodologyRecord,
  SamplingMethodMeta,
} from '../types/methodology'

export const SAMPLING_CLASS_COLORS: Record<string, string> = {
  '复合采样': '#3568B8',
  '抓取采样': '#6F94CE',
  '被动采样': '#2F8F89',
  '连续/在线采样': '#82BEB8',
}

export const PRESCRIPTION_COLORS: Record<string, string> = {
  '处方药': '#3568B8',
  '非处方药': '#48A29A',
}

export const METHODOLOGY_COLORS = [
  SAMPLING_CLASS_COLORS['复合采样']!,
  SAMPLING_CLASS_COLORS['抓取采样']!,
  SAMPLING_CLASS_COLORS['被动采样']!,
  SAMPLING_CLASS_COLORS['连续/在线采样']!,
]

export const COUNTRY_NAMES_ZH: Record<string, string> = {
  China: '中国',
  Australia: '澳大利亚',
  Spain: '西班牙',
  'United Kingdom': '英国',
  Belgium: '比利时',
  Italy: '意大利',
  'United States': '美国',
  Turkey: '土耳其',
  Netherlands: '荷兰',
  Norway: '挪威',
  Vietnam: '越南',
  Denmark: '丹麦',
  Switzerland: '瑞士',
  Greece: '希腊',
  France: '法国',
  Germany: '德国',
  Japan: '日本',
  India: '印度',
  Canada: '加拿大',
  Brazil: '巴西',
}

export function countryNameZh(name: string) {
  return COUNTRY_NAMES_ZH[name] ?? name
}

export function formatAnalysisMethodName(name: string) {
  return name
    .replace(/^LC-HRMS\/QTOF$/i, 'LC–HRMS/QTOF')
    .replace(/^LC-MS\/MS$/i, 'LC–MS/MS')
    .replace(/^GC-MS$/i, 'GC–MS')
    .replace(/^HPLC\/UPLC非质谱$/i, 'HPLC/UPLC 非质谱')
}

export type ReportStatus = '已报告' | '未报告' | '不适用'

export function normalizeReportStatus(value: string): ReportStatus {
  if (value === '已报告') return '已报告'
  if (value === '不适用') return '不适用'
  return '未报告'
}

export const DEFAULT_METHODOLOGY_FILTERS: MethodologyFilterState = {
  query: '',
  targetClass: 'all',
  category: 'all',
  country: 'all',
  prescription: 'all',
  samplingStandard: 'all',
  samplingClass: 'all',
  sampleObject: 'all',
  proportion: 'all',
  duration: 'all',
  passiveSampler: 'all',
  mode: 'docs',
}

export type RecordField = keyof MethodologyRecord

export interface AggregateItem {
  name: string
  value: number
}

function documentKey(row: MethodologyRecord) {
  return row.doc || row.doi || `${row.drug}|${row.marker}`
}

function keyFor(row: MethodologyRecord, mode: MethodologyMode | 'markers' | 'drugs') {
  if (mode === 'docs') return documentKey(row)
  if (mode === 'docMethods') return JSON.stringify([documentKey(row), row.samplingStandard])
  if (mode === 'markers') return row.marker || row.drug || documentKey(row)
  if (mode === 'drugs') return row.drug || row.marker || documentKey(row)
  return null
}

export function countRows(
  rows: MethodologyRecord[],
  mode: MethodologyMode | 'markers' | 'drugs' = 'docs',
) {
  if (mode === 'rows') return rows.length
  return new Set(rows.map((row) => keyFor(row, mode)).filter(Boolean)).size
}

export function aggregate(
  rows: MethodologyRecord[],
  field: RecordField,
  mode: MethodologyMode | 'markers' | 'drugs' = 'docs',
) {
  const groups = new Map<string, number | Set<string>>()
  for (const row of rows) {
    const name = row[field] || '未标注'
    if (!groups.has(name)) groups.set(name, mode === 'rows' ? 0 : new Set<string>())
    const value = groups.get(name)
    if (mode === 'rows') {
      groups.set(name, Number(value) + 1)
    } else {
      const key = keyFor(row, mode)
      if (key) (value as Set<string>).add(key)
    }
  }
  return Array.from(groups, ([name, value]) => ({
    name,
    value: typeof value === 'number' ? value : value.size,
  })).sort(
    (a, b) =>
      b.value - a.value ||
      a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }),
  )
}

export function filterMethodologyRows(
  rows: MethodologyRecord[],
  state: MethodologyFilterState,
) {
  const query = state.query.trim().toLowerCase()
  return rows.filter((row) => {
    if (state.targetClass !== 'all' && row.targetClass !== state.targetClass) return false
    if (state.category !== 'all' && row.category !== state.category) return false
    if (state.country !== 'all' && row.country !== state.country) return false
    if (state.prescription !== 'all' && row.prescription !== state.prescription) return false
    if (state.samplingStandard !== 'all' && row.samplingStandard !== state.samplingStandard)
      return false
    if (state.samplingClass !== 'all' && row.samplingClass !== state.samplingClass) return false
    if (state.sampleObject !== 'all' && row.sampleObject !== state.sampleObject) return false
    if (state.proportion !== 'all' && row.proportion !== state.proportion) return false
    if (state.duration !== 'all' && row.duration !== state.duration) return false
    if (state.passiveSampler !== 'all' && row.passiveSampler !== state.passiveSampler)
      return false
    if (!query) return true
    return [
      row.drug,
      row.marker,
      row.samplingRaw,
      row.samplingDetail,
      row.samplingStandard,
      row.samplingClass,
      row.sampleObject,
      row.proportion,
      row.duration,
      row.passiveSampler,
      row.stationStatus,
      row.analysisRaw,
      row.country,
      row.category,
      row.subcategory,
    ]
      .join(' ')
      .toLowerCase()
      .includes(query)
  })
}

export function modeUnitLabel(mode: MethodologyMode) {
  if (mode === 'rows') return '数据行'
  if (mode === 'docMethods') return '文献—方法'
  return '文献'
}

export function uniqueJoined(rows: MethodologyRecord[], field: RecordField) {
  return Array.from(new Set(rows.map((row) => row[field]).filter(Boolean)))
    .sort((a, b) =>
      a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }),
    )
    .join(' / ')
}

export interface SamplingMethodItem extends AggregateItem {
  groupName: string
  groupMethodCount: number
  color: string
  meta?: SamplingMethodMeta
}

export interface SamplingClassItem extends AggregateItem {
  docs: number
  rows: number
  color: string
  methods: SamplingMethodItem[]
}

function tintHex(hex: string, amount: number) {
  const value = hex.replace('#', '')
  const number = Number.parseInt(value, 16)
  const channel = (shift: number) =>
    Math.round(((number >> shift) & 255) + (255 - ((number >> shift) & 255)) * amount)
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
}

export function buildSamplingGroups(
  rows: MethodologyRecord[],
  optionsOrder: string[],
  methodMetadata: SamplingMethodMeta[],
) {
  const chartRows = rows.filter((row) => Boolean(row.samplingStandard))
  const metadataMap = new Map(methodMetadata.map((item) => [item.standard, item]))
  return aggregate(chartRows, 'samplingClass', 'docMethods').map((group, groupIndex) => {
    const groupRows = chartRows.filter((row) => row.samplingClass === group.name)
    const fixedColorIndex = optionsOrder.indexOf(group.name)
    const color =
      SAMPLING_CLASS_COLORS[group.name] ??
      METHODOLOGY_COLORS[
        (fixedColorIndex >= 0 ? fixedColorIndex : groupIndex) % METHODOLOGY_COLORS.length
      ]!
    const methodItems = aggregate(groupRows, 'samplingStandard', 'docs')
    const methods: SamplingMethodItem[] = methodItems.map((method, methodIndex) => ({
      ...method,
      groupName: group.name,
      groupMethodCount: methodItems.length,
      color: tintHex(color, 0.08 + (methodIndex % 6) * 0.075),
      meta: metadataMap.get(method.name),
    }))
    return {
      ...group,
      docs: countRows(groupRows, 'docs'),
      rows: groupRows.length,
      color,
      methods,
    } satisfies SamplingClassItem
  })
}

export interface AnalysisCoverageItem {
  name: string
  docs: number
  markers: number
  rows: number
  docRate: number
  markerRate: number
}

export function buildAnalysisCoverage(rows: MethodologyRecord[]) {
  const totalDocs = countRows(rows, 'docs')
  const totalMarkers = countRows(rows, 'markers')
  const items = aggregate(rows, 'analysisGroup', 'docs')
    .slice(0, 9)
    .map((item) => {
      const scoped = rows.filter((row) => row.analysisGroup === item.name)
      const docs = countRows(scoped, 'docs')
      const markers = countRows(scoped, 'markers')
      return {
        name: item.name,
        docs,
        markers,
        rows: scoped.length,
        docRate: totalDocs ? (docs / totalDocs) * 100 : 0,
        markerRate: totalMarkers ? (markers / totalMarkers) * 100 : 0,
      } satisfies AnalysisCoverageItem
    })
  return { totalDocs, totalMarkers, items }
}

export interface CountryCoveragePart {
  name: string
  value: number
  color: string
  ratio: number
}

export interface CountryCoverageItem extends AggregateItem {
  parts: CountryCoveragePart[]
}

export function buildCountryCoverage(rows: MethodologyRecord[]) {
  const totals = aggregate(rows, 'country', 'docMethods')
    .filter((item) => item.name !== '未标注')
    .slice(0, 10)
  const classNames = aggregate(rows, 'samplingClass', 'docMethods')
    .filter((item) => item.name !== '未标注')
    .slice(0, 8)
    .map((item) => item.name)
  const max = Math.max(1, ...totals.map((item) => item.value))
  const items: CountryCoverageItem[] = totals.map((country) => {
    const countryRows = rows.filter((row) => row.country === country.name)
    return {
      ...country,
      parts: classNames.map((name, index) => {
        const value = countRows(
          countryRows.filter((row) => row.samplingClass === name),
          'docMethods',
        )
        return {
          name,
          value,
          color: SAMPLING_CLASS_COLORS[name] ?? METHODOLOGY_COLORS[index % METHODOLOGY_COLORS.length]!,
          ratio: (value / max) * 100,
        }
      }),
    }
  })
  return { classNames, items }
}

export interface SamplingAuditItem {
  standard: string
  samplingClass: string
  sampleObject: string
  proportion: string
  duration: string
  passiveSampler: string
  stationStatus: string
  proportionStatus: string
  docs: number
  rows: number
  auditSourceGroups: number
}

export function buildSamplingAudit(rows: MethodologyRecord[], methodMetadata: SamplingMethodMeta[]) {
  const metadataMap = new Map(methodMetadata.map((item) => [item.standard, item]))
  const grouped = new Map<string, MethodologyRecord[]>()
  for (const row of rows) {
    if (!row.samplingStandard) continue
    const list = grouped.get(row.samplingStandard) ?? []
    list.push(row)
    grouped.set(row.samplingStandard, list)
  }
  return Array.from(grouped, ([standard, list]) => {
    const proportions = new Set(list.map((row) => row.proportion).filter(Boolean))
    const proportionStatus =
      proportions.has('未报告')
        ? '未报告'
        : proportions.size === 0
          ? '未标注'
          : Array.from(proportions).every(
                (value) => value === '不适用' || value.includes('不适用'),
              )
            ? '不适用'
            : '已报告'
    return {
      standard,
      samplingClass: uniqueJoined(list, 'samplingClass'),
      sampleObject: uniqueJoined(list, 'sampleObject'),
      proportion: uniqueJoined(list, 'proportion'),
      duration: uniqueJoined(list, 'duration'),
      passiveSampler: uniqueJoined(list, 'passiveSampler'),
      stationStatus: uniqueJoined(list, 'stationStatus'),
      proportionStatus,
      docs: countRows(list, 'docs'),
      rows: list.length,
      auditSourceGroups: metadataMap.get(standard)?.auditSourceGroups ?? 0,
    } satisfies SamplingAuditItem
  }).sort(
    (a, b) =>
      b.docs - a.docs ||
      b.rows - a.rows ||
      a.standard.localeCompare(b.standard, 'zh-Hans-CN'),
  )
}
