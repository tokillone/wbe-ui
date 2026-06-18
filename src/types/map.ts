export interface MapBiomarkerOption {
  key: string
  label: string
  cas?: string | null
}

export interface MapFilterSelection {
  category: string
  subcategory: string
  biomarkerKey: string
  year: string
}

export interface MapFilterResponse {
  categories: string[]
  subcategoriesByCategory: Record<string, string[]>
  biomarkersByCategorySubcategory: Record<string, MapBiomarkerOption[]>
  yearsBySelection: Record<string, string[]>
  defaultSelection: MapFilterSelection
}

export interface MapLegend {
  min: number | null
  max: number | null
  unit: string
  colors: string[]
}

export interface MapSummary {
  countryCount: number
  admin1Count: number
  cityCount: number
  pointCount: number
  recordCount: number
  doiCount: number
}

export interface MapRegionStat {
  level: 'country' | 'admin1' | 'city'
  geoKey: string
  parentGeoKey?: string | null
  displayName: string
  country?: string | null
  province?: string | null
  city?: string | null
  latitude?: number | null
  longitude?: number | null
  category: string
  subcategory: string
  biomarkerKey: string
  biomarkerLabel: string
  biomarkerCas?: string | null
  yearLabel: string
  pndlGeomeanMgD1000inh?: number | null
  pndlMeanMgD1000inh?: number | null
  pndlMinMgD1000inh?: number | null
  pndlMaxMgD1000inh?: number | null
  recordCount?: number | null
  doiCount?: number | null
  yearCount?: number | null
  cityCount?: number | null
  pointCount?: number | null
  pndlSources?: string | null
}

export interface MapStatsResponse {
  legend: MapLegend
  summary: MapSummary
  regions: MapRegionStat[]
  points: MapRegionStat[]
}

export interface MapSourceRecord {
  measurementId: number
  drugName: string
  biomarkerName: string
  biomarkerCas?: string | null
  doi?: string | null
  country?: string | null
  province?: string | null
  city?: string | null
  plantName?: string | null
  samplePeriod?: string | null
  sourceWorkbook?: string | null
  originalRowNumber?: number | null
  pndlMgD1000inh?: number | null
  pndlSource?: string | null
}

export interface MapDetailResponse {
  region: MapRegionStat | null
  sources: MapSourceRecord[]
}
