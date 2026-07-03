export interface Icd11SankeyCategoryResponse {
  categories: string[]
  defaultCategory: string
}

export interface Icd11SankeyNode {
  name: string
  displayName: string
  kind: 'level1' | 'level2' | 'drug' | 'biomarker'
  depth: number
  value: number
  searchText: string
  level1: string
  color: string
}

export interface Icd11SankeyLink {
  linkId: string
  source: string
  target: string
  value: number
  level1: string
  sourceLabel: string
  targetLabel: string
  edgeType: string
  pathIds: string[]
  color: string
}

export interface Icd11SankeyPath {
  pathId: string
  level1: string
  level2: string
  drug: string
  biomarker: string
  biomarkerAliases: string[]
  weight: number
  share: number
  nodeIds: string[]
}

export interface Icd11SankeyTopItem {
  name: string
  value: number
  share: number
}

export interface Icd11SankeyStats {
  totalWeight: number
  level1: number
  level2: number
  drug: number
  biomarker: number
  relations: number
  maxNodes: number
  topLevel1: Icd11SankeyTopItem[]
  topDrug: Icd11SankeyTopItem[]
  topBiomarker: Icd11SankeyTopItem[]
}

export interface Icd11SankeyGraph {
  category: string
  nodes: Icd11SankeyNode[]
  links: Icd11SankeyLink[]
  paths: Icd11SankeyPath[]
  level1Colors: Record<string, string>
  stats: Icd11SankeyStats
}
