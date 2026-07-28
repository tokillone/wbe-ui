export type MethodologyMode = 'docs' | 'docMethods' | 'rows'

export interface MethodologyRecord {
  doc: string
  doi: string
  targetClass: string
  category: string
  subcategory: string
  drug: string
  marker: string
  prescription: string
  samplingRaw: string
  samplingStandard: string
  samplingDetail: string
  samplingClass: string
  sampleObject: string
  proportion: string
  duration: string
  passiveSampler: string
  stationStatus: string
  analysisRaw: string
  analysisGroup: string
  country: string
}

export interface MethodologyMeta {
  sourceName: string
  rowCount: number
  docCount: number
  drugCount: number
  markerCount: number
  countryCount: number
  samplingStandardCount: number
  samplingRingStandardCount: number
  samplingClassCount: number
  documentMethodCount: number
  documentRingMethodCount: number
  documentMethodDetailCount: number
  naDocumentCount: number
  analysisGroupCount: number
  auditRows: number
  impactRows: number
}

export interface SamplingMethodMeta {
  standard: string
  samplingClass: string[]
  sampleObject: string[]
  proportion: string[]
  duration: string[]
  passiveSampler: string[]
  stationStatus: string[]
  auditSourceGroups: number
  impactRows: number
}

export interface MethodologyOptions {
  targetClass: string[]
  category: string[]
  country: string[]
  prescription: string[]
  samplingStandard: string[]
  samplingClass: string[]
  sampleObject: string[]
  proportion: string[]
  duration: string[]
  passiveSampler: string[]
}

export interface MethodologyData {
  meta: MethodologyMeta
  records: MethodologyRecord[]
  samplingMethods: SamplingMethodMeta[]
  options: MethodologyOptions
}

export interface MethodologyFilterState {
  query: string
  targetClass: string
  category: string
  country: string
  prescription: string
  samplingStandard: string
  samplingClass: string
  sampleObject: string
  proportion: string
  duration: string
  passiveSampler: string
  mode: MethodologyMode
}
