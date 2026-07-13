<script setup lang="ts">
import { PieChart, SankeyChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { init, use, type ECharts } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { fetchIcd11SankeyCategories, fetchIcd11SankeyGraph } from '../services/icd11Sankey'
import type {
  Icd11SankeyGraph,
  Icd11SankeyLink,
  Icd11SankeyNode,
  Icd11SankeyPath,
  Icd11SankeyTopItem,
} from '../types/icd11Sankey'
import {
  displayModeLimit,
  pathsForLevel1Scope,
  relationPieSectionsForNode,
  sankeyHoverTargetKey,
  sortSankeyPaths,
  type RelationPieSection as BaseRelationPieSection,
  type RelationShareItem,
  type Icd11SankeyDisplayMode,
  type Level1Scope,
} from '../utils/icd11SankeyDisplay'

type DetailState =
  | { kind: 'category' }
  | { kind: 'paths'; title: string; status: string; paths: Icd11SankeyPath[]; limit: number }
  | {
      kind: 'node'
      title: string
      level: string
      nodeKind: Icd11SankeyNode['kind']
      nodeWeight: number
      paths: Icd11SankeyPath[]
      limit: number
    }

type ChartNode = Icd11SankeyNode & {
  itemStyle?: {
    color?: string
    opacity?: number
    borderColor?: string
    borderWidth?: number
    shadowBlur?: number
    shadowColor?: string
  }
  emphasis?: {
    itemStyle?: {
      opacity?: number
      borderColor?: string
      borderWidth?: number
    }
    label?: {
      color?: string
      textBorderColor?: string
      textBorderWidth?: number
    }
  }
  blur?: {
    itemStyle?: {
      opacity?: number
    }
    label?: {
      color?: string
      textBorderColor?: string
      textBorderWidth?: number
    }
  }
  label?: {
    show: boolean
    position: 'left' | 'right'
    formatter: string
    color: string
    width: number
    lineHeight: number
    overflow: 'truncate'
    align: 'left' | 'right'
    fontWeight: number
    textBorderColor: string
    textBorderWidth: number
  }
}

type ChartLink = Icd11SankeyLink & {
  lineStyle?: {
    color: string
    opacity: number
    curveness: number
    shadowBlur?: number
    shadowColor?: string
  }
  emphasis?: {
    lineStyle?: {
      opacity?: number
    }
  }
  blur?: {
    lineStyle?: {
      opacity?: number
    }
  }
}

type ChartGraph = Omit<Icd11SankeyGraph, 'nodes' | 'links'> & {
  nodes: ChartNode[]
  links: ChartLink[]
}

type RelationPieSourceItem = RelationShareItem & {
  isOther?: boolean
  hiddenItemCount?: number
}

type RelationPieDatum = RelationPieSourceItem & {
  sectionId: string
  itemStyle: {
    color: string
  }
}

type RelationPieSection = Omit<BaseRelationPieSection, 'items'> & {
  items: RelationPieDatum[]
  totalWeight: number
  sourceItemCount: number
  hiddenItemCount: number
  isCollapsed: boolean
}

const KIND_LABELS: Record<Icd11SankeyNode['kind'], string> = {
  level1: 'ICD11_Level1',
  level2: 'ICD11_Level2',
  level3: 'ICD11_Level3',
  drug: '药物',
  biomarker: '生物标记物',
}
const DISPLAY_MODE_OPTIONS: { value: Icd11SankeyDisplayMode; label: string }[] = [
  { value: 'all', label: '全量' },
  { value: 'smart', label: '智能精简' },
  { value: 'top20', label: 'Top 20' },
  { value: 'top50', label: 'Top 50' },
  { value: 'top100', label: 'Top 100' },
]
const MIN_WEIGHT_OPTIONS = [
  { value: 0, label: '全部' },
  { value: 2, label: '≥2' },
  { value: 3, label: '≥3' },
  { value: 5, label: '≥5' },
]
const STAGE_TITLES = ['ICD11_Level1', 'ICD11_Level2', 'ICD11_Level3', '药物', '生物标记物']
const SERIES_LEFT = 96
const SERIES_RIGHT = 94
const SERIES_TOP = 10
const SERIES_BOTTOM = 44
const HEADER_HEIGHT = 70
const HEADER_FADE_DISTANCE = 190
const HOVER_INTENT_DELAY = 85
const HOVER_RESTORE_DELAY = 110
// Nature/NPG-inspired scientific palette, softened for dense alluvial diagrams.
const LEVEL1_FALLBACK_COLORS = [
  '#D86F5E',
  '#55A6BF',
  '#4DA58D',
  '#7185B3',
  '#E49A68',
  '#8F7BB5',
  '#82B7A8',
  '#C97D91',
  '#91A66E',
  '#A58470',
  '#D3AD5D',
  '#7695A6',
]
const PIE_COLORS = [
  '#55A6BF',
  '#4DA58D',
  '#D86F5E',
  '#E49A68',
  '#7185B3',
  '#8F7BB5',
  '#82B7A8',
  '#C97D91',
]
const PIE_OTHER_COLOR = '#A4ADB3'
const MAX_RELATION_PIE_ITEMS = 8
const TOP_RELATION_PIE_ITEMS = 7

use([SankeyChart, PieChart, TooltipComponent, CanvasRenderer])

const chartEl = ref<HTMLElement | null>(null)
const modalPieChartEl = ref<HTMLElement | null>(null)
const currentCategory = ref('')
const graph = ref<Icd11SankeyGraph | null>(null)
const activeBaseGraph = ref<Icd11SankeyGraph | null>(null)
const renderedGraph = ref<Icd11SankeyGraph | null>(null)
const isLoading = ref(false)
const errorMessage = ref('')
const searchQuery = ref('')
const displayMode = ref<Icd11SankeyDisplayMode>('all')
const selectedLevel1 = ref('')
const level1Scope = ref<Level1Scope>('linked')
const minWeight = ref(0)
const chartHeight = ref(760)
const lockLabel = ref('')
const lockText = ref('当前未锁定路径')
const lockedEdge = ref<Icd11SankeyLink | null>(null)
const lockedPathId = ref('')
const currentFocus = ref('')
const detail = ref<DetailState>({ kind: 'category' })
const headerScrollProgress = ref(0)
const pieModalOpen = ref(false)
const activePieId = ref('')

let chart: ECharts | null = null
let pieCharts = new Map<string, ECharts>()
const pieChartElements = new Map<string, HTMLElement>()
let modalPieChart: ECharts | null = null
let graphController: AbortController | null = null
let hoverPreviewTimer: number | null = null
let hoverRestoreTimer: number | null = null
let activePreviewKey = ''

const statsSummaryItems = computed(() => {
  const stats = graph.value?.stats
  if (!stats) return []
  return [
    { label: '总权重', value: formatNumber(stats.totalWeight) },
    { label: 'Level1', value: formatNumber(stats.level1) },
    { label: 'Level2', value: formatNumber(stats.level2) },
    { label: 'Level3', value: formatNumber(stats.level3) },
    { label: '止于 Level2', value: formatNumber(stats.level2OnlyPaths) },
    { label: '药物', value: formatNumber(stats.drug) },
    { label: '生物标记物', value: formatNumber(stats.biomarker) },
    { label: '源映射', value: formatNumber(stats.mappingRows ?? stats.relations) },
    { label: '聚合关系', value: formatNumber(stats.relations) },
  ]
})
const isCompactDetail = computed(
  () => detail.value.kind === 'node' || (detail.value.kind === 'paths' && detail.value.paths.length > 1),
)
const detailPathSum = computed(() => {
  if (detail.value.kind === 'category') return 0
  return detail.value.paths.reduce((sum, path) => sum + Number(path.weight || 0), 0)
})
const shownDetailPaths = computed(() => {
  if (detail.value.kind === 'category') return []
  return detail.value.paths.slice(0, detail.value.limit)
})
const categoryStats = computed(() => graph.value?.stats ?? null)
const selectedCategoryLabel = computed(() => graph.value?.category || currentCategory.value || 'ICD11 桑基图')
const headerStyle = computed(() => ({
  '--header-offset': `${(-76 * headerScrollProgress.value).toFixed(1)}px`,
  '--header-opacity': (1 - headerScrollProgress.value * 0.95).toFixed(3),
}))
const chartPanelStyle = computed(() => ({
  '--series-left': `${SERIES_LEFT}px`,
  '--series-right': `${SERIES_RIGHT}px`,
}))
const level1Options = computed(() => {
  if (!graph.value) return []
  const weights = new Map<string, number>()
  for (const path of graph.value.paths) {
    weights.set(path.level1, (weights.get(path.level1) ?? 0) + Number(path.weight || 0))
  }
  return [...weights.keys()].sort(
    (a, b) => (weights.get(b) ?? 0) - (weights.get(a) ?? 0) || a.localeCompare(b, 'zh-Hans-CN'),
  )
})
const displaySummary = computed(() => (graph.value ? summarizeDisplayPaths(graph.value) : null))
const displaySummaryText = computed(() => {
  const summary = displaySummary.value
  if (!summary) return ''
  const baseText =
    summary.candidatePathCount === summary.totalPathCount
      ? `展示 ${summary.shownPathCount}/${summary.totalPathCount} 条路径`
      : `展示 ${summary.shownPathCount}/${summary.candidatePathCount} 条候选路径，总计 ${summary.totalPathCount} 条`
  const linkedText = summary.linkedLevel1Count > 0 ? ` · 关联 ${summary.linkedLevel1Count} 个其他 Level1` : ''
  const scopeText = level1Scope.value === 'linked' ? '含关联' : '仅当前'
  return `${baseText} · 权重覆盖 ${formatPercent(summary.weightCoverage)}${linkedText} · ${scopeText} · ${summary.modeLabel}`
})
const relationPieSections = computed<RelationPieSection[]>(() => {
  if (detail.value.kind !== 'node') return []
  return relationPieSectionsForNode(detail.value.nodeKind, detail.value.paths)
    .map((section) => normalizeRelationPieSection(section))
})
const activePieSection = computed(
  () => relationPieSections.value.find((section) => section.id === activePieId.value) ?? null,
)

watch([searchQuery, displayMode, selectedLevel1, level1Scope, minWeight], () => {
  if (!graph.value) return
  clearLockedState()
  render()
})

watch(relationPieSections, async (sections) => {
  const activeSection = sections.find((section) => section.id === activePieId.value)
  if (activePieId.value && (!activeSection || !isRelationPieChartable(activeSection))) {
    activePieId.value = ''
    pieModalOpen.value = false
  }
  await nextTick()
  renderRelationPieCharts()
  renderModalRelationPieChart()
})

watch(pieModalOpen, async (isOpen) => {
  await nextTick()
  if (isOpen) {
    renderModalRelationPieChart()
  } else {
    disposeModalRelationPieChart()
    restoreLockedHighlight()
  }
})

onMounted(async () => {
  window.scrollTo({ top: 0, left: 0 })
  await nextTick()
  initChart()
  window.addEventListener('resize', handleResize)
  window.addEventListener('scroll', handleWindowScroll, { passive: true })
  window.addEventListener('keydown', handleKeydown)
  handleWindowScroll()
  await loadCategories()
})

onBeforeUnmount(() => {
  graphController?.abort()
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('scroll', handleWindowScroll)
  window.removeEventListener('keydown', handleKeydown)
  clearHoverTimers()
  chart?.dispose()
  chart = null
  disposeRelationPieCharts()
  disposeModalRelationPieChart()
})

async function loadCategories() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const response = await fetchIcd11SankeyCategories()
    const initialCategory = response.defaultCategory || response.categories[0] || ''
    currentCategory.value = initialCategory
    if (initialCategory) {
      await loadGraph(initialCategory)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'ICD11 桑基图数据暂时不可用'
  } finally {
    isLoading.value = false
  }
}

async function loadGraph(category: string) {
  graphController?.abort()
  const controller = new AbortController()
  graphController = controller
  isLoading.value = true
  errorMessage.value = ''
  try {
    const response = await fetchIcd11SankeyGraph(category, controller.signal)
    if (controller.signal.aborted) return
    graph.value = response
    currentCategory.value = response.category
    resetInteractionState()
    await nextTick()
    render()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    errorMessage.value = error instanceof Error ? error.message : 'ICD11 桑基图加载失败'
  } finally {
    if (!controller.signal.aborted) {
      isLoading.value = false
    }
  }
}

function initChart() {
  if (!chartEl.value || chart) return
  chart = init(chartEl.value, null, { renderer: 'canvas' })
  chart.on('click', (params) => {
    void handleChartClick(params)
  })
  chart.on('mouseover', handleSankeyMouseOver)
  chart.on('mouseout', scheduleRestoreHighlight)
  chart.getZr().on('click', (event) => {
    if (!event.target) clearSelectionFromBlank()
  })
  chart.getZr().on('globalout', scheduleRestoreHighlight)
}

function render(focusName: string | null = null) {
  if (!chart || !graph.value) return
  const categoryGraph = graph.value
  const baseGraph = currentActiveGraph(categoryGraph)
  activeBaseGraph.value = baseGraph
  renderedGraph.value = baseGraph
  setChartHeight(baseGraph)

  let chartGraph = asChartGraph(baseGraph)
  const seeds = searchSeeds(baseGraph, searchQuery.value)
  if (focusName) {
    chartGraph = styledForNode(baseGraph, focusName)
  } else if (seeds && seeds.size > 0) {
    chartGraph = styledForSearch(baseGraph, seeds)
  }

  chart.setOption(
    {
      backgroundColor: 'transparent',
      animation: false,
      stateAnimation: {
        duration: 200,
        easing: 'cubicOut',
      },
      tooltip: {
        trigger: 'item',
        confine: true,
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderColor: 'rgba(71,102,119,0.16)',
        borderWidth: 1,
        borderRadius: 8,
        padding: 0,
        extraCssText: 'box-shadow:0 14px 34px rgba(20,47,65,0.16);overflow:hidden;',
        formatter(params: { dataType?: string; data: ChartNode | ChartLink }) {
          if (params.dataType === 'edge') {
            return sankeyLinkTooltipHtml(params.data as ChartLink)
          }
          return sankeyNodeTooltipHtml(params.data as ChartNode)
        },
      },
      series: [
        {
          type: 'sankey',
          data: chartGraph.nodes,
          links: chartGraph.links,
          left: SERIES_LEFT,
          right: SERIES_RIGHT,
          top: SERIES_TOP,
          bottom: SERIES_BOTTOM,
          nodeWidth: 14,
          nodeGap: nodeGap(baseGraph),
          nodeAlign: 'justify',
          layoutIterations: 0,
          draggable: false,
          emphasis: {
            focus: 'trajectory',
            blurScope: 'series',
            itemStyle: {
              opacity: 1,
              borderColor: 'rgba(255,255,255,0.96)',
              borderWidth: 1.4,
            },
            label: {
              color: '#102a3d',
              textBorderColor: 'rgba(255,255,255,0.95)',
              textBorderWidth: 3,
            },
            lineStyle: { opacity: 0.74 },
          },
          blur: {
            itemStyle: {
              opacity: 0.18,
            },
            label: {
              color: 'rgba(23, 50, 71, 0.26)',
              textBorderColor: 'rgba(255,255,255,0.5)',
              textBorderWidth: 1,
            },
            lineStyle: { opacity: 0.04 },
          },
          label: {
            color: '#20242a',
            fontSize: sankeyLabelFontSize(baseGraph),
            fontFamily:
              'Microsoft YaHei, Noto Sans CJK SC, Source Han Sans CN, SimHei, Arial, sans-serif',
          },
          lineStyle: {
            color: 'source',
            opacity: 0.3,
            curveness: 0.52,
          },
        },
      ],
    },
    true,
  )

  if (!focusName && !lockedEdge.value && !lockedPathId.value) {
    detail.value = { kind: 'category' }
    lockLabel.value = ''
    lockText.value = statusText()
  }
}

function currentActiveGraph(baseGraph: Icd11SankeyGraph): Icd11SankeyGraph {
  return buildGraphFromPaths(baseGraph, displayPaths(baseGraph))
}

function buildGraphFromPaths(baseGraph: Icd11SankeyGraph, paths: Icd11SankeyPath[]): Icd11SankeyGraph {
  if (!paths.length) {
    return {
      ...baseGraph,
      nodes: [],
      links: [],
      paths: [],
      stats: {
        ...baseGraph.stats,
        maxNodes: 1,
      },
    }
  }
  const nodeByName = new Map(baseGraph.nodes.map((node) => [node.name, node]))
  const nodeWeights = new Map<string, number>()
  const links = new Map<string, Icd11SankeyLink>()

  function addNodeWeight(nodeName: string, weight: number) {
    nodeWeights.set(nodeName, (nodeWeights.get(nodeName) ?? 0) + weight)
  }

  function addLink(
    source: string,
    target: string,
    weight: number,
    level1: string,
    level2: string,
    edgeType: string,
    mappingLevel: Icd11SankeyPath['mappingLevel'],
    pathId: string,
  ) {
    const key = `${source}@@${target}@@${edgeType}@@${level1}@@${level2}@@${mappingLevel}`
    const sourceLabel = nodeByName.get(source)?.displayName ?? source
    const targetLabel = nodeByName.get(target)?.displayName ?? target
    const color = baseGraph.level1Colors[level1] ?? '#8F9CAA'
    if (!links.has(key)) {
      links.set(key, {
        linkId: key,
        source,
        target,
        value: 0,
        level1,
        level2,
        sourceLabel,
        targetLabel,
        edgeType,
        mappingLevel,
        pathIds: [],
        color,
      })
    }
    const link = links.get(key)
    if (!link) return
    link.value += weight
    link.pathIds.push(pathId)
  }

  for (const path of paths) {
    const [level1Id, level2Id] = path.nodeIds
    const hasLevel3 = path.mappingLevel === 'Level3' && path.nodeIds.length >= 5
    const level3Id = hasLevel3 ? path.nodeIds[2] : null
    const drugId = hasLevel3 ? path.nodeIds[3] : path.nodeIds[2]
    const biomarkerId = hasLevel3 ? path.nodeIds[4] : path.nodeIds[3]
    if (!level1Id || !level2Id || !drugId || !biomarkerId) continue
    for (const nodeName of path.nodeIds) addNodeWeight(nodeName, path.weight)
    addLink(
      level1Id,
      level2Id,
      path.weight,
      path.level1,
      path.level2,
      'ICD11_Level1 → ICD11_Level2',
      path.mappingLevel,
      path.pathId,
    )
    if (hasLevel3 && level3Id) {
      addLink(
        level2Id,
        level3Id,
        path.weight,
        path.level1,
        path.level2,
        'ICD11_Level2 → ICD11_Level3',
        path.mappingLevel,
        path.pathId,
      )
      addLink(
        level3Id,
        drugId,
        path.weight,
        path.level1,
        path.level2,
        'ICD11_Level3 → 药物',
        path.mappingLevel,
        path.pathId,
      )
    } else {
      addLink(
        level2Id,
        drugId,
        path.weight,
        path.level1,
        path.level2,
        'ICD11_Level2 → 药物',
        path.mappingLevel,
        path.pathId,
      )
    }
    addLink(
      drugId,
      biomarkerId,
      path.weight,
      path.level1,
      path.level2,
      '药物 → 生物标记物',
      path.mappingLevel,
      path.pathId,
    )
  }

  const primaryNodeIds = new Set(
    paths
      .filter((path) => path.level1 === selectedLevel1.value)
      .flatMap((path) => path.nodeIds),
  )
  const nodes = baseGraph.nodes
    .filter((node) => nodeWeights.has(node.name))
    .map((node) => ({ ...node, value: nodeWeights.get(node.name) ?? node.value }))
    .sort((a, b) => {
      const primaryOrder = Number(primaryNodeIds.has(b.name)) - Number(primaryNodeIds.has(a.name))
      if (primaryOrder) return primaryOrder
      return b.value - a.value || a.displayName.localeCompare(b.displayName, 'zh-Hans-CN')
    })
  const depthCounts = [0, 1, 2, 3, 4].map(
    (depth) => nodes.filter((node) => node.depth === depth).length,
  )

  return {
    ...baseGraph,
    nodes,
    links: [...links.values()],
    paths,
    stats: {
      ...baseGraph.stats,
      maxNodes: Math.max(1, ...depthCounts),
    },
  }
}

function asChartGraph(baseGraph: Icd11SankeyGraph): ChartGraph {
  return {
    ...baseGraph,
    nodes: baseGraph.nodes.map((node) => chartNode(node, true, false)),
    links: baseGraph.links.map((link) => chartLink(link, true, false)),
  }
}

function styledForPathIds(baseGraph: Icd11SankeyGraph, pathIds: Iterable<string>): ChartGraph {
  const activePathIds = new Set(pathIds)
  const activeNodes = new Set<string>()
  for (const path of selectedPaths(baseGraph, activePathIds)) {
    for (const nodeName of path.nodeIds) activeNodes.add(nodeName)
  }
  return {
    ...baseGraph,
    nodes: baseGraph.nodes.map((node) => {
      const highlighted = activeNodes.has(node.name)
      return chartNode(node, highlighted, highlighted)
    }),
    links: baseGraph.links.map((link) => {
      const highlighted = link.pathIds.some((pathId) => activePathIds.has(pathId))
      return chartLink(link, highlighted, highlighted)
    }),
  }
}

function styledForNode(baseGraph: Icd11SankeyGraph, nodeName: string): ChartGraph {
  return styledForPathIds(baseGraph, pathIdsForNode(baseGraph, nodeName))
}

function styledForSearch(baseGraph: Icd11SankeyGraph, seeds: Set<string>): ChartGraph {
  const pathIds = new Set<string>()
  for (const seed of seeds) {
    for (const pathId of pathIdsForNode(baseGraph, seed)) pathIds.add(pathId)
  }
  return pathIds.size ? styledForPathIds(baseGraph, pathIds) : asChartGraph(baseGraph)
}

function chartNode(node: Icd11SankeyNode, active: boolean, highlighted: boolean): ChartNode {
  const label = nodeLabel(node)
  const position = node.depth === 4 ? 'left' : 'right'
  const isRelatedContext =
    (node.kind === 'level1' || node.kind === 'level2') && node.level1 !== selectedLevel1.value
  return {
    ...node,
    itemStyle: {
      color: nodeDepthColor(node),
      opacity: active ? (isRelatedContext && !highlighted ? 0.7 : 1) : 0.2,
      borderColor: highlighted
        ? 'rgba(255,255,255,0.98)'
        : active
          ? 'rgba(255,255,255,0.92)'
          : 'rgba(255,255,255,0.54)',
      borderWidth: highlighted ? 1.6 : 1.2,
      shadowBlur: 0,
      shadowColor: 'transparent',
    },
    emphasis: {
      itemStyle: {
        opacity: active ? 1 : 0.58,
        borderColor: 'rgba(255,255,255,0.96)',
        borderWidth: 1.4,
      },
      label: {
        color: active ? '#102a3d' : 'rgba(23, 50, 71, 0.56)',
        textBorderColor: 'rgba(255,255,255,0.95)',
        textBorderWidth: active ? 3 : 2,
      },
    },
    blur: {
      itemStyle: {
        opacity: active ? 0.2 : 0.12,
      },
      label: {
        color: active ? 'rgba(23, 50, 71, 0.34)' : 'rgba(23, 50, 71, 0.24)',
        textBorderColor: 'rgba(255,255,255,0.5)',
        textBorderWidth: 1,
      },
    },
    label: {
      show: true,
      position,
      formatter: label.text,
      color: highlighted
        ? '#0b3441'
        : active
        ? isRelatedContext
          ? 'rgba(23, 50, 71, 0.68)'
          : '#173247'
        : 'rgba(23, 50, 71, 0.58)',
      width: label.width,
      lineHeight: label.lineHeight,
      overflow: 'truncate',
      align: position === 'right' ? 'left' : 'right',
      fontWeight: highlighted ? 950 : active ? 800 : 700,
      textBorderColor: highlighted
        ? 'rgba(255,255,255,0.98)'
        : active
          ? 'rgba(255,255,255,0.92)'
          : 'rgba(255,255,255,0.58)',
      textBorderWidth: highlighted ? 4 : active ? 3 : 2,
    },
  }
}

function chartLink(link: Icd11SankeyLink, active: boolean, highlighted: boolean): ChartLink {
  const color = level2DisplayColor(link.level1, link.level2, link.color)
  const crossesLevel3 = link.edgeType === 'ICD11_Level2 → 药物'
  const isRelatedContext = link.level1 !== selectedLevel1.value
  const activeAlpha = isRelatedContext ? 0.22 : crossesLevel3 ? 0.32 : 0.4
  const activeOpacity = isRelatedContext ? 0.5 : crossesLevel3 ? 0.64 : 0.72
  return {
    ...link,
    lineStyle: {
      color: hexToRgba(color, highlighted ? 0.72 : active ? activeAlpha : 0.05),
      opacity: highlighted ? 0.94 : active ? activeOpacity : 0.07,
      curveness: 0.52,
      shadowBlur: highlighted ? 3 : 0,
      shadowColor: highlighted ? hexToRgba(color, 0.2) : 'transparent',
    },
    emphasis: {
      lineStyle: {
        opacity: active ? 0.92 : 0.56,
      },
    },
    blur: {
      lineStyle: {
        opacity: active ? 0.07 : 0.03,
      },
    },
  }
}

function nodeLabel(node: Icd11SankeyNode) {
  const config = [
    { width: 126, lineHeight: 17 },
    { width: 126, lineHeight: 17 },
    { width: 126, lineHeight: 17 },
    { width: 118, lineHeight: 17 },
    { width: 134, lineHeight: 17 },
  ][node.depth] ?? { width: 132, lineHeight: 18 }
  return {
    ...config,
    text: singleLineLabel(node.displayName),
  }
}

function singleLineLabel(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function nodeDepthColor(node: Icd11SankeyNode) {
  const baseColor = level1DisplayColor(node.level1, node.color)
  if (node.kind === 'level2') return level2DisplayColor(node.level1, node.displayName, node.color)
  if (node.kind === 'drug' || node.kind === 'biomarker') {
    return node.kind === 'drug' ? '#7896A3' : '#91A9A1'
  }
  const depthMix = [0, 0.05, 0.11, 0.14, 0.16][node.depth] ?? 0.1
  return mixHex(baseColor, '#ffffff', depthMix)
}

function sankeyLabelFontSize(baseGraph: Icd11SankeyGraph) {
  if (baseGraph.stats.maxNodes > 120 || baseGraph.paths.length > 200) return 10
  if (baseGraph.stats.maxNodes > 48 || baseGraph.paths.length > 90) return 11
  if (baseGraph.stats.maxNodes > 20) return 12
  return 13
}

async function handleChartClick(params: unknown) {
  const event = params as { dataType?: string; data?: ChartNode | ChartLink }
  if (!activeBaseGraph.value || !event.data) return
  clearHoverPreview()
  if (event.dataType === 'node') {
    openDetailPanel()
    const node = event.data as ChartNode
    if (node.kind === 'level1' && node.displayName !== selectedLevel1.value) {
      selectedLevel1.value = node.displayName
      await nextTick()
    }
    const baseGraph = activeBaseGraph.value
    if (!baseGraph) return
    const activeNode = baseGraph.nodes.find((item) => item.name === node.name) ?? node
    currentFocus.value = activeNode.name
    lockedEdge.value = null
    lockedPathId.value = ''
    render(currentFocus.value)
    const paths = selectedPaths(baseGraph, pathIdsForNode(baseGraph, activeNode.name))
    lockLabel.value = '当前锁定节点'
    lockText.value = activeNode.displayName
    detail.value = {
      kind: 'node',
      title: activeNode.displayName,
      level: KIND_LABELS[activeNode.kind],
      nodeKind: activeNode.kind,
      nodeWeight: activeNode.value,
      paths,
      limit: 20,
    }
    return
  }
  if (event.dataType === 'edge') {
    openDetailPanel()
    lockEdge(event.data as ChartLink)
  }
}

function handleSankeyMouseOver(params: unknown) {
  const target = previewTargetFromEvent(params)
  if (!target) return
  schedulePreviewHighlight(target.key, target.pathIds)
}

function previewTargetFromEvent(params: unknown) {
  const event = params as { dataType?: string; data?: ChartNode | ChartLink }
  const baseGraph = renderedGraph.value
  if (!baseGraph || !event.data) return null
  if (event.dataType === 'edge') {
    const edge = event.data as ChartLink
    if (!edge.pathIds.length) return null
    return {
      key: sankeyHoverTargetKey(`edge:${edge.linkId}`, edge.pathIds),
      pathIds: edge.pathIds,
    }
  }
  if (event.dataType === 'node') {
    const node = event.data as ChartNode
    const pathIds = pathIdsForNode(baseGraph, node.name)
    if (!pathIds.length) return null
    return {
      key: sankeyHoverTargetKey(`node:${node.name}`, pathIds),
      pathIds,
    }
  }
  return null
}

function lockEdge(edge: Icd11SankeyLink) {
  const baseGraph = activeBaseGraph.value
  if (!baseGraph || !renderedGraph.value) return
  if (lockedEdge.value?.linkId === edge.linkId) {
    clearLockedState()
    render()
    return
  }
  lockedEdge.value = edge
  lockedPathId.value = ''
  currentFocus.value = ''
  updateSeriesGraph(styledForPathIds(renderedGraph.value, edge.pathIds))
  lockLabel.value = '当前锁定流带'
  lockText.value = `${edge.sourceLabel} → ${edge.targetLabel}`
  detail.value = {
    kind: 'paths',
    title: edge.edgeType,
    status: '已锁定，点击同一流带或重置清除',
    paths: selectedPaths(baseGraph, edge.pathIds),
    limit: 30,
  }
}

function lockSinglePath(pathId: string) {
  const baseGraph = activeBaseGraph.value
  if (!baseGraph || !renderedGraph.value) return
  const path = pathMap(baseGraph).get(pathId)
  if (!path) return
  openDetailPanel()
  lockedEdge.value = null
  lockedPathId.value = pathId
  currentFocus.value = ''
  updateSeriesGraph(styledForPathIds(renderedGraph.value, [pathId]))
  lockLabel.value = '当前锁定聚合路径'
  lockText.value = pathText(path)
  detail.value = {
    kind: 'paths',
    title: '聚合五层路径',
    status: '已锁定，点击重置清除',
    paths: [path],
    limit: 1,
  }
}

function updateSeriesGraph(nextGraph: ChartGraph) {
  chart?.setOption({
    animation: false,
    series: [
      {
        data: nextGraph.nodes,
        links: nextGraph.links,
      },
    ],
  })
}

function schedulePreviewHighlight(key: string, pathIds: string[]) {
  if (!renderedGraph.value || !pathIds.length) return
  if (key === activePreviewKey && !hoverPreviewTimer) return
  clearTimer('restore')
  clearTimer('preview')
  hoverPreviewTimer = window.setTimeout(() => {
    hoverPreviewTimer = null
    if (!renderedGraph.value || key === activePreviewKey) return
    activePreviewKey = key
    updateSeriesGraph(styledForPathIds(renderedGraph.value, pathIds))
  }, HOVER_INTENT_DELAY)
}

function scheduleRestoreHighlight() {
  clearTimer('preview')
  clearTimer('restore')
  hoverRestoreTimer = window.setTimeout(() => {
    hoverRestoreTimer = null
    clearHoverPreview()
  }, HOVER_RESTORE_DELAY)
}

function clearHoverPreview() {
  clearHoverTimers()
  activePreviewKey = ''
  restoreLockedHighlight()
}

function clearHoverTimers() {
  clearTimer('preview')
  clearTimer('restore')
}

function clearTimer(kind: 'preview' | 'restore') {
  const timer = kind === 'preview' ? hoverPreviewTimer : hoverRestoreTimer
  if (timer) window.clearTimeout(timer)
  if (kind === 'preview') {
    hoverPreviewTimer = null
  } else {
    hoverRestoreTimer = null
  }
}

function normalizeRelationPieSection(section: BaseRelationPieSection): RelationPieSection {
  const sourceItemCount = section.items.length
  const hiddenItemCount =
    sourceItemCount > MAX_RELATION_PIE_ITEMS ? sourceItemCount - TOP_RELATION_PIE_ITEMS : 0
  const totalWeight = section.items.reduce((sum, item) => sum + Number(item.value || 0), 0)
  const sourceItems: RelationPieSourceItem[] =
    sourceItemCount > MAX_RELATION_PIE_ITEMS
      ? [
          ...section.items.slice(0, TOP_RELATION_PIE_ITEMS),
          collapsedOtherRelationItem(section.items.slice(TOP_RELATION_PIE_ITEMS), totalWeight),
        ]
      : section.items

  return {
    ...section,
    items: sourceItems.map((item, index) => decorateRelationPieItem(section.id, item, index)),
    totalWeight,
    sourceItemCount,
    hiddenItemCount,
    isCollapsed: hiddenItemCount > 0,
  }
}

function collapsedOtherRelationItem(items: RelationShareItem[], totalWeight: number): RelationPieSourceItem {
  const value = items.reduce((sum, item) => sum + Number(item.value || 0), 0)
  const pathIds = items.flatMap((item) => item.pathIds)
  return {
    name: `其他 ${items.length} 项`,
    value,
    share: totalWeight > 0 ? value / totalWeight : 0,
    pathIds,
    isOther: true,
    hiddenItemCount: items.length,
  }
}

function decorateRelationPieItem(
  sectionId: string,
  item: RelationPieSourceItem,
  index: number,
): RelationPieDatum {
  return {
    ...item,
    sectionId,
    itemStyle: {
      color: relationItemColor(item, index),
    },
  }
}

function relationItemColor(item: RelationPieSourceItem, index: number) {
  if (item.isOther) return PIE_OTHER_COLOR
  const seed = stableTextHash(item.name)
  return PIE_COLORS[(seed + index) % PIE_COLORS.length] ?? '#55A6BF'
}

function stableTextHash(value: string) {
  let hash = 0
  for (const char of value) {
    hash = (hash * 33 + char.charCodeAt(0)) % 1000003
  }
  return hash
}

function isRelationPieChartable(
  section: RelationPieSection | null | undefined,
): section is RelationPieSection {
  return Boolean(section && section.items.length >= 2)
}

function singleRelationItem(section: RelationPieSection): RelationPieDatum {
  return (
    section.items[0] ?? {
      name: '',
      value: 0,
      share: 0,
      pathIds: [],
      sectionId: section.id,
      itemStyle: { color: PIE_OTHER_COLOR },
    }
  )
}

function relationShareBarStyle(item: RelationPieDatum): Record<string, string> {
  const share = Math.max(4, Math.min(100, Number(item.share || 0) * 100))
  return {
    '--relation-share': `${share}%`,
    '--relation-color': item.itemStyle.color,
  }
}

function handleRelationItemMouseOver(section: RelationPieSection, item: RelationPieDatum) {
  if (!item.pathIds.length) return
  schedulePreviewHighlight(
    sankeyHoverTargetKey(`relation:${section.hoverPrefix}:${item.name}`, item.pathIds),
    item.pathIds,
  )
}

function relationPieTooltipHtml(section: RelationPieSection, item: RelationPieDatum) {
  const otherLine = item.isOther
    ? `<div style="display:flex;justify-content:space-between;gap:16px;margin-top:6px;color:#647985;font-size:12px;font-weight:800;"><span>合并项数</span><strong style="color:#173247;">${formatNumber(item.hiddenItemCount)}</strong></div>`
    : ''
  return `
    <div style="min-width:188px;max-width:260px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <i style="width:10px;height:10px;border-radius:3px;background:${item.itemStyle.color};box-shadow:0 0 0 3px rgba(255,255,255,0.86);"></i>
        <strong style="min-width:0;overflow:hidden;color:#173247;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:950;">${escapeHtml(item.name)}</strong>
      </div>
      <div style="display:grid;gap:6px;padding-top:8px;border-top:1px solid rgba(105,127,140,0.14);">
        <div style="display:flex;justify-content:space-between;gap:16px;color:#647985;font-size:12px;font-weight:800;"><span>权重</span><strong style="color:#173247;">${formatNumber(item.value)}</strong></div>
        <div style="display:flex;justify-content:space-between;gap:16px;color:#647985;font-size:12px;font-weight:800;"><span>${escapeHtml(section.shareLabel)}</span><strong style="color:#173247;">${formatPercent(item.share)}</strong></div>
        <div style="display:flex;justify-content:space-between;gap:16px;color:#647985;font-size:12px;font-weight:800;"><span>关联路径</span><strong style="color:#173247;">${formatNumber(item.pathIds.length)} 条</strong></div>
        ${otherLine}
      </div>
    </div>
  `
}

function setPieChartRef(sectionId: string, element: unknown) {
  if (element instanceof HTMLElement) {
    pieChartElements.set(sectionId, element)
    void nextTick(() => renderRelationPieCharts())
    return
  }
  pieChartElements.delete(sectionId)
  disposeRelationPieChart(sectionId)
}

function renderRelationPieCharts() {
  const activeIds = new Set(relationPieSections.value.map((section) => section.id))
  for (const sectionId of [...pieCharts.keys()]) {
    if (!activeIds.has(sectionId)) disposeRelationPieChart(sectionId)
  }
  for (const section of relationPieSections.value) {
    const element = pieChartElements.get(section.id) ?? null
    const nextChart = renderPieChartInstance(pieCharts.get(section.id) ?? null, element, section, false)
    if (nextChart) {
      pieCharts.set(section.id, nextChart)
    } else {
      pieCharts.delete(section.id)
    }
  }
}

function renderModalRelationPieChart() {
  if (!pieModalOpen.value) return
  modalPieChart = renderPieChartInstance(
    modalPieChart,
    modalPieChartEl.value,
    activePieSection.value,
    true,
  )
}

function renderPieChartInstance(
  instance: ECharts | null,
  element: HTMLElement | null,
  section: RelationPieSection | null,
  large: boolean,
) {
  if (!isRelationPieChartable(section) || !element) {
    instance?.dispose()
    return null
  }
  const nextChart = instance ?? init(element, null, { renderer: 'canvas' })
  bindRelationPieEvents(nextChart)
  nextChart.setOption(
    {
      backgroundColor: 'transparent',
      animation: false,
      stateAnimation: {
        duration: 180,
        easing: 'cubicOut',
      },
      tooltip: {
        trigger: 'item',
        confine: true,
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        borderColor: 'rgba(105, 127, 140, 0.16)',
        borderWidth: 1,
        borderRadius: 10,
        padding: [12, 13],
        textStyle: {
          color: '#173247',
          fontFamily:
            'Microsoft YaHei, Noto Sans CJK SC, Source Han Sans CN, SimHei, Arial, sans-serif',
        },
        extraCssText: [
          'box-shadow: 0 16px 36px rgba(13, 34, 50, 0.18);',
          'backdrop-filter: blur(10px);',
          'line-height: 1.35;',
        ].join(''),
        formatter(params: { data?: RelationPieDatum }) {
          const data = params.data
          if (!data) return ''
          return relationPieTooltipHtml(section, data)
        },
      },
      series: [
        {
          type: 'pie',
          radius: large ? ['50%', '74%'] : ['52%', '76%'],
          center: ['50%', '50%'],
          minAngle: 6,
          avoidLabelOverlap: true,
          selectedOffset: large ? 8 : 5,
          itemStyle: {
            borderColor: 'rgba(255,255,255,0.98)',
            borderWidth: large ? 3 : 2,
            shadowBlur: large ? 12 : 6,
            shadowColor: 'rgba(23, 50, 71, 0.08)',
          },
          label: {
            show: false,
          },
          labelLine: {
            show: false,
          },
          emphasis: {
            focus: 'self',
            scale: true,
            scaleSize: large ? 7 : 4,
            itemStyle: {
              shadowBlur: large ? 18 : 12,
              shadowColor: 'rgba(23, 50, 71, 0.2)',
            },
          },
          blur: {
            itemStyle: {
              opacity: 0.46,
            },
          },
          data: section.items,
        },
      ],
    },
    true,
  )
  return nextChart
}

function bindRelationPieEvents(instance: ECharts) {
  instance.off('mouseover', handleRelationPieMouseOver)
  instance.off('mouseout', scheduleRestoreHighlight)
  instance.getZr().off('globalout', scheduleRestoreHighlight)
  instance.on('mouseover', handleRelationPieMouseOver)
  instance.on('mouseout', scheduleRestoreHighlight)
  instance.getZr().on('globalout', scheduleRestoreHighlight)
}

function disposeRelationPieChart(sectionId: string) {
  pieCharts.get(sectionId)?.dispose()
  pieCharts.delete(sectionId)
}

function disposeRelationPieCharts() {
  for (const chartInstance of pieCharts.values()) chartInstance.dispose()
  pieCharts = new Map<string, ECharts>()
  pieChartElements.clear()
}

function disposeModalRelationPieChart() {
  modalPieChart?.dispose()
  modalPieChart = null
}

function openPieModal(sectionId: string) {
  const section = relationPieSections.value.find((item) => item.id === sectionId)
  if (!isRelationPieChartable(section)) return
  activePieId.value = sectionId
  pieModalOpen.value = true
}

function closePieModal() {
  pieModalOpen.value = false
  activePieId.value = ''
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && pieModalOpen.value) closePieModal()
}

function handleRelationPieMouseOver(params: unknown) {
  const data = (params as { data?: RelationPieDatum }).data
  const section = relationPieSections.value.find((item) => item.id === data?.sectionId)
  if (!data?.pathIds.length) return
  schedulePreviewHighlight(
    sankeyHoverTargetKey(`pie:${section?.hoverPrefix ?? 'relation'}:${data.name}`, data.pathIds),
    data.pathIds,
  )
}

function restoreLockedHighlight() {
  if (!renderedGraph.value) return
  if (currentFocus.value) {
    updateSeriesGraph(styledForNode(renderedGraph.value, currentFocus.value))
    return
  }
  if (lockedEdge.value) {
    updateSeriesGraph(styledForPathIds(renderedGraph.value, lockedEdge.value.pathIds))
    return
  }
  if (lockedPathId.value) {
    updateSeriesGraph(styledForPathIds(renderedGraph.value, [lockedPathId.value]))
    return
  }
  render()
}

function resetView() {
  searchQuery.value = ''
  displayMode.value = 'all'
  selectedLevel1.value = defaultLevel1()
  level1Scope.value = 'linked'
  minWeight.value = 0
  clearLockedState()
  render()
}

function clearLock() {
  clearLockedState()
  detail.value = { kind: 'category' }
  render()
}

function resetInteractionState() {
  searchQuery.value = ''
  displayMode.value = 'all'
  selectedLevel1.value = defaultLevel1()
  level1Scope.value = 'linked'
  minWeight.value = 0
  clearLockedState()
  detail.value = { kind: 'category' }
}

function clearSelectionFromBlank() {
  clearLockedState()
  detail.value = { kind: 'category' }
  render()
}

function clearLockedState() {
  clearHoverTimers()
  activePreviewKey = ''
  pieModalOpen.value = false
  activePieId.value = ''
  lockedEdge.value = null
  lockedPathId.value = ''
  currentFocus.value = ''
}

function statusText() {
  if (searchQuery.value.trim()) return `当前搜索高亮：${searchQuery.value.trim()}`
  return '当前未锁定路径'
}

function displayPaths(baseGraph: Icd11SankeyGraph) {
  return summarizeDisplayPaths(baseGraph).paths
}

function summarizeDisplayPaths(baseGraph: Icd11SankeyGraph) {
  const contextualPaths = pathsForLevel1Scope(
    baseGraph.paths,
    selectedLevel1.value,
    level1Scope.value,
  )
  const filteredPaths = sortSankeyPaths(
    contextualPaths.filter((path) => {
      const weightMatched = minWeight.value <= 0 || path.weight >= minWeight.value
      return weightMatched
    }),
  ).sort(
    (a, b) =>
      Number(b.level1 === selectedLevel1.value) - Number(a.level1 === selectedLevel1.value),
  )
  const limit = displayModeLimit(displayMode.value, filteredPaths.length)
  const paths = limit ? filteredPaths.slice(0, limit) : filteredPaths
  const candidateWeight = sumPathWeight(filteredPaths)
  const shownWeight = sumPathWeight(paths)

  return {
    paths,
    totalPathCount: baseGraph.paths.length,
    candidatePathCount: filteredPaths.length,
    shownPathCount: paths.length,
    totalWeight: Number(baseGraph.stats.totalWeight || 0),
    candidateWeight,
    shownWeight,
    weightCoverage: candidateWeight > 0 ? shownWeight / candidateWeight : 0,
    linkedLevel1Count:
      level1Scope.value === 'linked'
        ? new Set(
            paths.filter((path) => path.level1 !== selectedLevel1.value).map((path) => path.level1),
          ).size
        : 0,
    modeLabel: displayModeLabel(displayMode.value, limit),
  }
}

function defaultLevel1() {
  return level1Options.value[0] ?? ''
}

function displayModeLabel(mode: Icd11SankeyDisplayMode, limit: number | null) {
  if (mode === 'smart') return limit ? `智能精简 Top ${limit}` : '智能精简：全量'
  return DISPLAY_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? '全量'
}

function sumPathWeight(paths: Icd11SankeyPath[]) {
  return paths.reduce((sum, path) => sum + Number(path.weight || 0), 0)
}

function selectedPaths(baseGraph: Icd11SankeyGraph, pathIds: Iterable<string>) {
  const paths = pathMap(baseGraph)
  return [...new Set(pathIds)]
    .map((pathId) => paths.get(pathId))
    .filter((path): path is Icd11SankeyPath => Boolean(path))
    .sort((a, b) => b.weight - a.weight || pathText(a).localeCompare(pathText(b), 'zh-Hans-CN'))
}

function pathIdsForNode(baseGraph: Icd11SankeyGraph, nodeName: string) {
  return baseGraph.paths.filter((path) => path.nodeIds.includes(nodeName)).map((path) => path.pathId)
}

function pathMap(baseGraph: Icd11SankeyGraph) {
  return new Map(baseGraph.paths.map((path) => [path.pathId, path]))
}

function searchSeeds(baseGraph: Icd11SankeyGraph, keyword: string) {
  const query = keyword.trim().toLowerCase()
  if (!query) return null
  const seeds = new Set<string>()
  for (const node of baseGraph.nodes) {
    const haystack = `${node.displayName} ${node.searchText}`.toLowerCase()
    if (haystack.includes(query)) seeds.add(node.name)
  }
  return seeds
}

function setChartHeight(baseGraph: Icd11SankeyGraph) {
  const viewportHeight = Math.max(720, window.innerHeight - HEADER_HEIGHT)
  const maxNodes = Math.max(1, baseGraph.stats.maxNodes)
  const pathCount = baseGraph.paths.length
  const dense = pathCount > 200 || maxNodes > 90
  const medium = pathCount > 80 || maxNodes > 28
  const perNode = dense ? 16 : medium ? 17 : 16
  const extraSpace = dense ? 240 : medium ? 200 : 160
  const maxHeight = dense ? 3000 : medium ? 2100 : 1200
  const contentHeight = maxNodes * perNode + extraSpace
  chartHeight.value = Math.max(viewportHeight, Math.min(maxHeight, contentHeight))
  void nextTick(() => chart?.resize())
}

function nodeGap(baseGraph: Icd11SankeyGraph) {
  const maxNodes = Math.max(12, baseGraph.stats.maxNodes)
  const pathCount = baseGraph.paths.length
  const dense = pathCount > 200 || maxNodes > 90
  const medium = pathCount > 80 || maxNodes > 28
  const availableHeight = Math.max(360, chartHeight.value - SERIES_TOP - SERIES_BOTTOM)
  const density = Math.floor((availableHeight / maxNodes) * (dense ? 0.72 : medium ? 0.72 : 0.6))
  const minGap = dense ? 11 : medium ? 12 : 8
  const maxGap = dense ? 21 : medium ? 24 : 22
  return Math.max(minGap, Math.min(maxGap, density))
}

function handleResize() {
  applyChartLayout()
}

function openDetailPanel() {
  window.setTimeout(applyChartLayout, 0)
}

function applyChartLayout() {
  if (graph.value) setChartHeight(activeBaseGraph.value ?? graph.value)
  chart?.resize()
  for (const chartInstance of pieCharts.values()) chartInstance.resize()
  modalPieChart?.resize()
  chart?.setOption({
    series: [
      {
        left: SERIES_LEFT,
        right: SERIES_RIGHT,
        top: SERIES_TOP,
        bottom: SERIES_BOTTOM,
      },
    ],
  })
}

function handleWindowScroll() {
  const scrollTop = Math.max(window.scrollY, document.documentElement.scrollTop, 0)
  headerScrollProgress.value = Math.min(1, scrollTop / HEADER_FADE_DISTANCE)
}

function pathText(path: Icd11SankeyPath) {
  return [path.level1, path.level2, path.level3, path.drug, path.biomarker].filter(Boolean).join(' → ')
}

function pathSteps(path: Icd11SankeyPath) {
  const steps = [
    { label: 'Level1', value: path.level1 },
    { label: 'Level2', value: path.level2 },
  ]
  if (path.level3) steps.push({ label: 'Level3', value: path.level3 })
  steps.push({ label: '药物', value: path.drug })
  steps.push({ label: '生物标记物', value: path.biomarker })
  return steps
}

function topList(items: Icd11SankeyTopItem[] | undefined) {
  return items ?? []
}

function formatNumber(value: number | string | null | undefined) {
  return Number(value ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 1 })
}

function formatPercent(value: number | string | null | undefined) {
  return `${(Number(value ?? 0) * 100).toFixed(1)}%`
}

function sankeyLinkTooltipHtml(link: ChartLink) {
  const color = level2DisplayColor(link.level1, link.level2, link.color)
  const mappingNote =
    link.edgeType === 'ICD11_Level2 → 药物'
      ? '<div class="sankey-tip__note">该映射正式终止于 Level2，未设置 Level3</div>'
      : ''
  return `
    <div class="sankey-tip">
      <div class="sankey-tip__eyebrow">路径关系</div>
      <div class="sankey-tip__title">${escapeHtml(link.sourceLabel)}<span>→</span>${escapeHtml(link.targetLabel)}</div>
      <div class="sankey-tip__type">${escapeHtml(link.edgeType)}</div>
      <div class="sankey-tip__metrics">
        <div><span>涉及文献数</span><strong>${formatNumber(link.value)}</strong></div>
        <div><span>聚合路径</span><strong>${formatNumber(link.pathIds.length)}<small>条</small></strong></div>
      </div>
      <div class="sankey-tip__color"><i style="background:${color}"></i><span>Level2 路径色</span><strong>${escapeHtml(link.level2)}</strong></div>
      ${mappingNote}
    </div>`
}

function sankeyNodeTooltipHtml(node: ChartNode) {
  return `
    <div class="sankey-tip sankey-tip--node">
      <div class="sankey-tip__node-main">
        <span>${escapeHtml(KIND_LABELS[node.kind])}</span>
        <strong>${escapeHtml(node.displayName)}</strong>
        <div><b>${formatNumber(node.value)}</b><small>权重</small></div>
      </div>
    </div>`
}

function level1DisplayColor(level1: string, _rawColor: string): string {
  return fallbackLevel1Color(level1)
}

function fallbackLevel1Color(level1: string): string {
  let hash = 0
  for (const char of String(level1 || 'level1')) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100000
  }
  return LEVEL1_FALLBACK_COLORS[hash % LEVEL1_FALLBACK_COLORS.length] ?? '#7185B3'
}

function level2DisplayColor(level1: string, level2: string, rawColor: string): string {
  const base = level1DisplayColor(level1, rawColor)
  const hsl = rgbToHsl(hexToRgb(base))
  const variants = [
    { hue: -0.035, saturation: -0.03, lightness: 0.02 },
    { hue: -0.018, saturation: -0.08, lightness: 0.07 },
    { hue: 0.012, saturation: 0.01, lightness: 0.1 },
    { hue: 0.028, saturation: -0.06, lightness: 0.04 },
    { hue: 0.045, saturation: -0.01, lightness: 0.08 },
  ]
  const variant = variants[stableTextHash(level2) % variants.length] ?? variants[0]!
  return hslToHex({
    h: (hsl.h + variant.hue + 1) % 1,
    s: Math.max(0.38, Math.min(0.62, hsl.s + variant.saturation)),
    l: Math.max(0.5, Math.min(0.64, hsl.l + variant.lightness)),
  })
}

function mixHex(hex: string, targetHex: string, amount: number) {
  const source = hexToRgb(hex)
  const target = hexToRgb(targetHex)
  const mix = (from: number, to: number) => Math.round(from + (to - from) * amount)
  return `rgb(${mix(source.r, target.r)}, ${mix(source.g, target.g)}, ${mix(source.b, target.b)})`
}

function hexToRgb(hex: string) {
  const raw = String(hex || '#8F9CAA').replace('#', '')
  const normalized =
    raw.length === 3
      ? raw
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : raw.padEnd(6, '0').slice(0, 6)
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  }
}
function rgbToHsl({ r, g, b }: { r: number; g: number; b: number }) {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: lightness }
  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue = 0
  if (max === red) {
    hue = (green - blue) / delta + (green < blue ? 6 : 0)
  } else if (max === green) {
    hue = (blue - red) / delta + 2
  } else {
    hue = (red - green) / delta + 4
  }
  return { h: hue / 6, s: saturation, l: lightness }
}

function hslToHex({ h, s, l }: { h: number; s: number; l: number }) {
  const hueToRgb = (p: number, q: number, t: number) => {
    let normalized = t
    if (normalized < 0) normalized += 1
    if (normalized > 1) normalized -= 1
    if (normalized < 1 / 6) return p + (q - p) * 6 * normalized
    if (normalized < 1 / 2) return q
    if (normalized < 2 / 3) return p + (q - p) * (2 / 3 - normalized) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const toHex = (value: number) =>
    Math.round(value * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(hueToRgb(p, q, h + 1 / 3))}${toHex(hueToRgb(p, q, h))}${toHex(
    hueToRgb(p, q, h - 1 / 3),
  )}`
}

function hexToRgba(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r},${g},${b},${alpha})`
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return map[char] ?? char
  })
}

function exportPng() {
  if (!chart || !graph.value) return
  const url = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#F6F8F9' })
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${graph.value.category}_五层桑基图.png`
  anchor.click()
}
</script>

<template>
  <main class="sankey-shell">
    <header
      class="site-header sankey-map-header"
      :class="{ 'is-hidden': headerScrollProgress > 0.92 }"
      :style="headerStyle"
    >
      <RouterLink class="brand" to="/" aria-label="污水信息因子数据库首页">
        <span class="brand-logo" aria-hidden="true">
          <span class="brand-drop"></span>
          <span class="brand-bars"><i></i><i></i><i></i></span>
          <span class="brand-line"><i></i><i></i></span>
        </span>
        <span>
          <strong>污水信息因子数据库</strong>
          <small>Wastewater Biomarker Evidence</small>
        </span>
      </RouterLink>

      <div class="header-center">
        <h1 class="page-title">ICD11 桑基图</h1>
        <label class="location-search">
          <span class="search-mark" aria-hidden="true"></span>
          <input v-model="searchQuery" type="search" placeholder="搜索 ICD、药物或 biomarker" />
          <button v-if="searchQuery" type="button" aria-label="清空搜索" @click="searchQuery = ''">×</button>
        </label>
      </div>

      <div class="header-tools">
        <RouterLink class="module-switch-link" to="/map-visualization">
          <span>切换模块</span>
          <strong>地图</strong>
        </RouterLink>
      </div>
    </header>

    <form class="sankey-controls" @submit.prevent>
      <label class="control-field level-field">
        <span>ICD11_Level1</span>
        <select v-model="selectedLevel1">
          <option v-for="level1 in level1Options" :key="level1" :value="level1">
            {{ level1 }}
          </option>
        </select>
      </label>

      <fieldset class="scope-field">
        <legend>关联范围</legend>
        <div class="scope-segmented">
          <label>
            <input v-model="level1Scope" type="radio" value="selected" />
            <span>仅当前</span>
          </label>
          <label>
            <input v-model="level1Scope" type="radio" value="linked" />
            <span>含关联</span>
          </label>
        </div>
      </fieldset>

      <label class="control-field display-field">
        <span>显示模式</span>
        <select v-model="displayMode">
          <option v-for="option in DISPLAY_MODE_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>

      <label class="control-field compact-field">
        <span>最小权重</span>
        <select v-model.number="minWeight">
          <option v-for="option in MIN_WEIGHT_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>

      <button class="control-button reset-button" type="button" @click="resetView">重置</button>
      <button class="control-button clear-lock-button" type="button" @click="clearLock">清除锁定</button>
      <button class="control-button export-button" type="button" @click="exportPng">导出 PNG</button>
    </form>

    <section class="sankey-main" :aria-label="selectedCategoryLabel">
      <section class="chart-panel" :style="chartPanelStyle">
        <div
          class="lock-bar"
          :class="{ 'has-lock': Boolean(lockedEdge || lockedPathId || currentFocus) }"
          aria-live="polite"
        >
          <strong>{{ lockLabel || '状态' }}</strong>
          <span>{{ lockText }}</span>
          <span v-if="displaySummaryText" class="filter-summary">{{ displaySummaryText }}</span>
        </div>
        <p v-if="errorMessage" class="state-message error-state">{{ errorMessage }}</p>
        <p v-else-if="isLoading && !graph" class="state-message">正在加载 ICD11 桑基图数据</p>
        <div class="stage-axis" aria-hidden="true">
          <div class="stage-axis-track">
            <span v-for="title in STAGE_TITLES" :key="title">{{ title }}</span>
          </div>
        </div>
        <div class="sankey-chart-scroll">
          <div class="sankey-chart-shell" :style="{ height: `${chartHeight}px` }">
            <div class="level1-column-rail" aria-hidden="true"></div>
            <div ref="chartEl" class="sankey-chart"></div>
          </div>
        </div>
      </section>

      <aside
        class="side-panel"
        :class="{
          'compact-detail': isCompactDetail,
          'has-selection': Boolean(lockedEdge || lockedPathId || currentFocus),
        }"
        aria-label="ICD11 桑基图说明区"
      >
        <template v-if="detail.kind === 'category' && categoryStats">
          <header class="overview-header">
            <h2>{{ selectedCategoryLabel }}</h2>
            <div v-if="statsSummaryItems.length" class="stats-summary" aria-label="当前类别统计">
              <span v-for="item in statsSummaryItems" :key="item.label">
                <b>{{ item.label }}</b>
                <strong>{{ item.value }}</strong>
              </span>
            </div>
          </header>
          <section class="detail-block">
            <h3>图例说明</h3>
            <p><b>颜色</b>：Level1 确定主色家族，Level2 用同色系中的路径色区分；<b>带宽</b> 代表涉及文献数权重。</p>
            <p><b>Level1 轨道</b>：浅色纵向轨道仅用于层级定位，不代表权重。</p>
            <p><b>关联展开</b>：选中 Level1 后，同时显示与其共享下游节点的其他 Level1 相关路径。</p>
            <p><b>完整路径</b>：ICD11_Level1 → ICD11_Level2 → ICD11_Level3 → 药物 → 生物标记物。</p>
            <p><b>跨层路径</b>：正式终止于 Level2 的映射直接连接药物，透明度较低且不补造 Level3。</p>
            <p><b>聚合</b>：相同有效层级关系已合并，权重为涉及文献数之和。</p>
          </section>
          <section class="detail-block">
            <h3>Top ICD11_Level1</h3>
            <ul class="top-list">
              <li v-for="item in topList(categoryStats.topLevel1)" :key="item.name">
                <b>{{ item.name }}</b>
                <span>{{ formatNumber(item.value) }} · {{ formatPercent(item.share) }}</span>
              </li>
            </ul>
          </section>
          <section class="detail-block">
            <h3>Top ICD11_Level3</h3>
            <p class="path-note">仅统计真实 Level3 路径，权重 {{ formatNumber(categoryStats.level3Weight) }}。</p>
            <ul class="top-list">
              <li v-for="item in topList(categoryStats.topLevel3)" :key="item.name">
                <b>{{ item.name }}</b>
                <span>{{ formatNumber(item.value) }} · {{ formatPercent(item.share) }}</span>
              </li>
            </ul>
          </section>
          <section class="detail-block">
            <h3>Top 药物</h3>
            <ul class="top-list">
              <li v-for="item in topList(categoryStats.topDrug)" :key="item.name">
                <b>{{ item.name }}</b>
                <span>{{ formatNumber(item.value) }} · {{ formatPercent(item.share) }}</span>
              </li>
            </ul>
          </section>
          <section class="detail-block">
            <h3>Top 生物标记物</h3>
            <ul class="top-list">
              <li v-for="item in topList(categoryStats.topBiomarker)" :key="item.name">
                <b>{{ item.name }}</b>
                <span>{{ formatNumber(item.value) }} · {{ formatPercent(item.share) }}</span>
              </li>
            </ul>
          </section>
        </template>

        <template v-else-if="detail.kind === 'paths'">
          <section class="detail-block" :class="{ 'single-path-block': detail.paths.length === 1 }">
            <h3>{{ detail.title }}</h3>
            <dl class="detail-kv">
              <div>
                <dt>高亮状态</dt>
                <dd>{{ detail.status }}</dd>
              </div>
              <div>
                <dt>聚合路径数</dt>
                <dd>{{ formatNumber(detail.paths.length) }}</dd>
              </div>
              <div>
                <dt>合计权重</dt>
                <dd>{{ formatNumber(detailPathSum) }} <span>涉及文献数</span></dd>
              </div>
            </dl>
          </section>
          <section v-if="detail.paths.length === 1" class="detail-block">
            <h3>{{ shownDetailPaths[0]?.mappingLevel === 'Level2' ? '聚合跨层路径' : '聚合五层路径' }}</h3>
            <article v-for="path in shownDetailPaths" :key="path.pathId" class="single-path-card">
              <ol class="single-path-steps">
                <li v-for="step in pathSteps(path)" :key="`${path.pathId}-${step.label}`">
                  <span>{{ step.label }}</span>
                  <strong>{{ step.value }}</strong>
                </li>
              </ol>
              <footer>
                <span>权重（涉及文献数）{{ formatNumber(path.weight) }}</span>
                <strong>占比 {{ formatPercent(path.share) }}</strong>
              </footer>
            </article>
          </section>
        </template>

        <template v-else-if="detail.kind === 'node'">
          <section class="detail-block node-summary-block">
            <h3>{{ detail.title }}</h3>
            <dl class="detail-kv">
              <div>
                <dt>层级</dt>
                <dd>{{ detail.level }}</dd>
              </div>
              <div>
                <dt>节点权重</dt>
                <dd>{{ formatNumber(detail.nodeWeight) }}</dd>
              </div>
              <div>
                <dt>关联聚合路径数</dt>
                <dd>{{ formatNumber(detail.paths.length) }}</dd>
              </div>
            </dl>
          </section>
          <section
            v-for="section in relationPieSections"
            :key="section.id"
            class="detail-block drug-share-block"
          >
            <div class="drug-share-heading">
              <h3>{{ section.title }}</h3>
              <button v-if="isRelationPieChartable(section)" type="button" @click="openPieModal(section.id)">
                放大查看
              </button>
            </div>
            <p>{{ section.description }}</p>
            <div v-if="!section.items.length" class="relation-empty-card">
              <strong>暂无可聚合关系</strong>
              <span>当前节点没有可用于该维度统计的关联路径。</span>
            </div>
            <div
              v-else-if="section.items.length === 1"
              class="single-relation-card"
              :style="relationShareBarStyle(singleRelationItem(section))"
              @mouseenter="handleRelationItemMouseOver(section, singleRelationItem(section))"
              @mouseleave="scheduleRestoreHighlight"
            >
              <i aria-hidden="true"></i>
              <div class="single-relation-main">
                <span>唯一{{ section.centerLabel }}</span>
                <strong>{{ singleRelationItem(section).name }}</strong>
                <em>
                  {{ formatNumber(singleRelationItem(section).value) }} 权重 ·
                  {{ formatPercent(singleRelationItem(section).share) }}
                </em>
              </div>
              <dl>
                <div>
                  <dt>路径</dt>
                  <dd>{{ formatNumber(singleRelationItem(section).pathIds.length) }}</dd>
                </div>
                <div>
                  <dt>占比</dt>
                  <dd>{{ formatPercent(singleRelationItem(section).share) }}</dd>
                </div>
              </dl>
            </div>
            <template v-else>
              <div class="drug-share-chart-shell">
                <div
                  :ref="(element) => setPieChartRef(section.id, element)"
                  class="drug-share-chart"
                  :aria-label="section.ariaLabel"
                ></div>
                <div class="drug-share-center" aria-hidden="true">
                  <strong>{{ section.sourceItemCount }}</strong>
                  <span>{{ section.centerLabel }}</span>
                  <em v-if="section.isCollapsed">Top {{ TOP_RELATION_PIE_ITEMS }} + 其他</em>
                  <em v-else>{{ formatNumber(section.totalWeight) }} 权重</em>
                </div>
              </div>
              <ul class="drug-share-list relation-share-list">
                <li
                  v-for="item in section.items"
                  :key="item.name"
                  :class="{ 'other-relation-item': item.isOther }"
                  :style="relationShareBarStyle(item)"
                  @mouseenter="handleRelationItemMouseOver(section, item)"
                  @mouseleave="scheduleRestoreHighlight"
                >
                  <i :style="{ backgroundColor: item.itemStyle.color }"></i>
                  <b>
                    {{ item.name }}
                    <small v-if="item.isOther">包含 {{ formatNumber(item.hiddenItemCount) }} 项</small>
                  </b>
                  <span>{{ formatNumber(item.value) }} · {{ formatPercent(item.share) }}</span>
                </li>
              </ul>
            </template>
          </section>
        </template>
      </aside>
    </section>

    <div v-if="pieModalOpen && activePieSection" class="pie-modal-backdrop" role="presentation" @click.self="closePieModal">
      <section class="pie-modal" role="dialog" aria-modal="true" :aria-label="`${activePieSection.title}放大查看`">
        <header>
          <div>
            <h2>{{ activePieSection.title }}</h2>
            <p>{{ detail.kind === 'node' ? detail.title : selectedCategoryLabel }}</p>
          </div>
          <button type="button" aria-label="关闭放大查看" @click="closePieModal">关闭</button>
        </header>
        <div class="pie-modal-body">
          <div class="pie-modal-chart-shell">
            <div ref="modalPieChartEl" class="pie-modal-chart" :aria-label="`${activePieSection.ariaLabel}放大图`"></div>
            <div class="pie-modal-center" aria-hidden="true">
              <strong>{{ activePieSection.sourceItemCount }}</strong>
              <span>{{ activePieSection.centerLabel }}</span>
              <em v-if="activePieSection.isCollapsed">Top {{ TOP_RELATION_PIE_ITEMS }} + 其他</em>
              <em v-else>{{ formatNumber(activePieSection.totalWeight) }} 权重</em>
            </div>
          </div>
          <ul class="pie-modal-list">
            <li v-for="item in activePieSection.items" :key="item.name">
              <i :style="{ backgroundColor: item.itemStyle.color }"></i>
              <b>
                {{ item.name }}
                <small v-if="item.isOther">包含 {{ formatNumber(item.hiddenItemCount) }} 项</small>
              </b>
              <span>权重 {{ formatNumber(item.value) }}</span>
              <strong>{{ formatPercent(item.share) }}</strong>
            </li>
          </ul>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.sankey-shell {
  min-height: 100vh;
  background: #fcfcfa;
  color: #20242a;
  font-family:
    Microsoft YaHei,
    Noto Sans CJK SC,
    Source Han Sans CN,
    SimHei,
    Arial,
    sans-serif;
}

.sankey-header {
  position: sticky;
  top: 0;
  z-index: 20;
  padding: 14px 18px 13px;
  border-bottom: 1px solid #e4e7eb;
  background: rgba(252, 252, 250, 0.96);
  backdrop-filter: blur(8px);
}

.sankey-title-row {
  display: grid;
  grid-template-columns: minmax(160px, 220px) minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
  margin-bottom: 12px;
}

.section-kicker {
  margin: 0 0 4px;
  color: #5d7382;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
}

.sankey-title-row h1 {
  margin: 0;
  color: #173247;
  font-size: clamp(20px, 2vw, 25px);
  line-height: 1.22;
  letter-spacing: 0;
}

.home-link,
.map-link {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  border: 1px solid rgba(47, 112, 120, 0.2);
  border-radius: 6px;
  color: #1d5362;
  background: #ffffff;
  font-size: 14px;
  font-weight: 900;
  text-decoration: none;
}

.map-link {
  color: #0f6591;
}

.sankey-controls {
  display: grid;
  grid-template-columns: minmax(250px, 390px) minmax(150px, 220px) 110px auto auto auto;
  align-items: center;
  gap: 10px;
}

.control-field {
  display: grid;
  gap: 5px;
}

.control-field span,
.top-toggle span {
  color: #69707a;
  font-size: 12px;
  font-weight: 800;
}

.control-field select,
.control-field input,
.sankey-controls button,
.top-toggle {
  min-height: 38px;
  border: 1px solid #cfd5dc;
  border-radius: 6px;
  background: #ffffff;
  color: #20242a;
  font: inherit;
  font-size: 14px;
}

.control-field select,
.control-field input {
  width: 100%;
  padding: 0 10px;
  outline: none;
}

.control-field select:focus,
.control-field input:focus {
  border-color: #4f82c4;
  box-shadow: 0 0 0 3px rgba(79, 130, 196, 0.15);
}

.top-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
}

.top-toggle input {
  width: 16px;
  height: 16px;
  margin: 0;
}

.sankey-controls button {
  padding: 0 13px;
  cursor: pointer;
}

.sankey-controls button:hover,
.sankey-controls button:focus-visible,
.home-link:hover,
.home-link:focus-visible,
.map-link:hover,
.map-link:focus-visible {
  border-color: #0f6591;
  color: #0f6591;
  outline: none;
}

.export-button {
  color: #ffffff !important;
  border-color: #0f6591 !important;
  background: #0f6591 !important;
}

.sankey-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 14px;
  padding: 14px 16px 20px;
}

.chart-panel,
.side-panel {
  border: 1px solid #e4e7eb;
  border-radius: 8px;
  background: #ffffff;
}

.chart-panel {
  min-width: 0;
  overflow: hidden;
}

.lock-bar {
  width: 100%;
  box-sizing: border-box;
  min-height: 36px;
  padding: 10px 14px 0;
  color: #69707a;
  border-bottom: 1px solid #eef0f2;
  font-size: 13px;
}

.lock-bar strong {
  color: #20242a;
}

.sankey-chart {
  width: 100%;
  min-width: 0;
}

.state-message {
  width: 100%;
  padding: 18px 16px 0;
  color: #526c7c;
  font-size: 14px;
  font-weight: 800;
}

.error-state {
  color: #a33b36;
}

.side-panel {
  position: sticky;
  top: 124px;
  align-self: start;
  max-height: calc(100vh - 144px);
  overflow: auto;
  padding: 14px;
}

.side-panel h2 {
  margin: 0 0 8px;
  color: #173247;
  font-size: 18px;
  line-height: 1.35;
}

.overview-header {
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(105, 127, 140, 0.12);
}

.overview-header h2 {
  margin-bottom: 10px;
  font-size: 19px;
  line-height: 1.3;
}

.stats-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin: 0;
  padding: 10px;
  border: 1px solid rgba(105, 127, 140, 0.14);
  border-radius: 8px;
  color: #5b7280;
  background:
    radial-gradient(circle at 10% 0%, rgba(214, 233, 250, 0.35), transparent 34%),
    linear-gradient(180deg, rgba(247, 252, 251, 0.94), rgba(255, 255, 255, 0.97));
}

.stats-summary span {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 3px 7px;
  border: 1px solid rgba(105, 127, 140, 0.12);
  border-radius: 999px;
  color: #5b7280;
  background: rgba(255, 255, 255, 0.72);
  font-size: 12px;
  font-weight: 800;
  line-height: 1.35;
}

.stats-summary b {
  color: #5b7280;
  font-weight: 800;
}

.stats-summary strong {
  color: #173247;
  font-weight: 900;
}

.detail-block {
  padding-top: 12px;
  border-top: 1px solid #eef0f2;
}

.overview-header + .detail-block {
  padding-top: 0;
  border-top: 0;
}

.detail-block + .detail-block {
  margin-top: 12px;
}

.detail-block h3 {
  margin: 0 0 8px;
  color: #20242a;
  font-size: 15px;
}

.overview-header ~ .detail-block h3 {
  color: #173247;
  font-size: 14px;
}

.detail-block p {
  margin: 0 0 6px;
  color: #69707a;
  font-size: 13px;
  line-height: 1.65;
}

.overview-header ~ .detail-block p {
  font-size: 12px;
  line-height: 1.55;
}

.detail-block b {
  color: #20242a;
}

.detail-kv {
  display: grid;
  gap: 8px;
  margin: 0;
}

.detail-kv div {
  display: grid;
  grid-template-columns: minmax(72px, 0.72fr) minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  padding: 6px 0;
  border-bottom: 1px solid rgba(105, 127, 140, 0.08);
}

.detail-kv div:last-child {
  border-bottom: 0;
}

.detail-kv dt {
  color: #5b7280;
  font-size: 12px;
  font-weight: 900;
  line-height: 1.45;
}

.detail-kv dd {
  margin: 0;
  color: #173247;
  font-size: 13px;
  font-weight: 900;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.detail-kv dd span {
  color: #78909e;
  font-size: 11px;
  font-weight: 800;
}

.side-panel.compact-detail h2 {
  margin-bottom: 6px;
  font-size: 16px;
  line-height: 1.25;
}

.compact-detail .detail-block {
  padding-top: 8px;
  border-top-color: rgba(105, 127, 140, 0.09);
}

.compact-detail .detail-block + .detail-block {
  margin-top: 8px;
}

.compact-detail .detail-block h3 {
  margin-bottom: 6px;
  font-size: 14px;
  line-height: 1.3;
}

.compact-detail .detail-kv {
  grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
  gap: 6px;
}

.compact-detail .detail-kv div {
  display: flex;
  gap: 5px;
  align-items: baseline;
  min-width: 0;
  padding: 4px 7px;
  border: 1px solid rgba(105, 127, 140, 0.1);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.64);
}

.compact-detail .detail-kv dt {
  flex: 0 0 auto;
  color: #5f7887;
  font-size: 11px;
  line-height: 1.25;
}

.compact-detail .detail-kv dd {
  min-width: 0;
  font-size: 12px;
  line-height: 1.25;
}

.compact-detail .detail-kv dd span {
  font-size: 10px;
}

.compact-detail .drug-share-block {
  padding-top: 8px;
}

.compact-detail .drug-share-heading {
  margin-bottom: 5px;
}

.compact-detail .drug-share-heading h3 {
  font-size: 14px;
}

.compact-detail .drug-share-heading button {
  min-height: 28px;
  padding: 0 9px;
  font-size: 11px;
}

.compact-detail .drug-share-block > p {
  margin-bottom: 5px;
  font-size: 12px;
  line-height: 1.45;
}

.top-list {
  display: grid;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.top-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  color: #69707a;
  font-size: 13px;
}

.top-list b {
  overflow: hidden;
  color: #20242a;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.path-row {
  display: grid;
  gap: 7px;
  padding: 10px 0;
  border-bottom: 1px solid #eef0f2;
}

.path-row p {
  margin: 0;
  color: #20242a;
  font-size: 13px;
}

.path-row span,
.path-note {
  color: #69707a;
  font-size: 12px;
}

.single-path-card {
  display: grid;
  gap: 12px;
  padding: 12px;
  border: 1px solid rgba(105, 127, 140, 0.13);
  border-radius: 10px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(241, 249, 250, 0.9)),
    #ffffff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.78);
}

.single-path-steps {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.single-path-steps li {
  position: relative;
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  gap: 9px;
  align-items: start;
}

.single-path-steps li + li::before {
  position: absolute;
  top: -7px;
  left: 38px;
  width: 1px;
  height: 7px;
  content: '';
  background: rgba(34, 147, 132, 0.28);
}

.single-path-steps span {
  min-height: 24px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  color: #0f766e;
  background: rgba(230, 247, 244, 0.9);
  font-size: 11px;
  font-weight: 950;
}

.single-path-steps strong {
  min-width: 0;
  padding-top: 3px;
  color: #173247;
  font-size: 13px;
  font-weight: 900;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.single-path-card footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid rgba(105, 127, 140, 0.1);
  color: #647985;
  font-size: 12px;
  font-weight: 850;
}

.single-path-card footer strong {
  color: #173247;
}

.path-row button {
  justify-self: start;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid rgba(15, 101, 145, 0.28);
  border-radius: 6px;
  color: #0f6591;
  background: #f4fafc;
  cursor: pointer;
  font-size: 12px;
  font-weight: 900;
}

.path-row button:hover,
.path-row button:focus-visible {
  border-color: #0f6591;
  outline: none;
}

@media (max-width: 1180px) {
  .sankey-title-row,
  .sankey-controls,
  .sankey-main {
    grid-template-columns: 1fr;
  }

  .map-link,
  .home-link {
    justify-self: start;
  }

  .side-panel {
    position: static;
    max-height: none;
  }
}

@media (max-width: 720px) {
  .sankey-header {
    padding: 12px;
  }

  .sankey-main {
    padding: 12px;
  }

  .sankey-title-row h1 {
    font-size: 19px;
  }

}

.sankey-page {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  color: #173247;
  background: #f6f8f9;
  font-family:
    Microsoft YaHei,
    Noto Sans CJK SC,
    Source Han Sans CN,
    SimHei,
    Arial,
    sans-serif;
}

.site-header {
  min-height: 70px;
  display: grid;
  grid-template-columns: minmax(220px, auto) minmax(420px, 760px) auto;
  align-items: center;
  gap: 24px;
  padding: 9px clamp(18px, 4vw, 52px);
  border-bottom: 1px solid rgba(96, 124, 143, 0.2);
  background:
    linear-gradient(90deg, rgba(235, 248, 246, 0.96), rgba(255, 255, 255, 0.98) 42%, rgba(244, 249, 251, 0.96)),
    #ffffff;
  box-shadow: 0 8px 26px rgba(21, 52, 72, 0.07);
  backdrop-filter: blur(18px);
  z-index: 5;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: #132e3f;
  text-decoration: none;
}

.brand-logo {
  position: relative;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  display: block;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.76);
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(15, 101, 145, 0.94), rgba(14, 143, 119, 0.92)), #0f6591;
  box-shadow: 0 14px 30px rgba(15, 101, 145, 0.2);
}

.brand-drop {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 19px;
  height: 19px;
  border: 2px solid rgba(255, 255, 255, 0.92);
  border-radius: 60% 60% 62% 10%;
  background: rgba(255, 255, 255, 0.13);
  transform: rotate(-45deg);
}

.brand-bars {
  position: absolute;
  right: 8px;
  bottom: 9px;
  height: 18px;
  display: inline-flex;
  align-items: end;
  gap: 3px;
}

.brand-bars i {
  width: 4px;
  border-radius: 999px 999px 2px 2px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1);
}

.brand-bars i:nth-child(1) {
  height: 8px;
}

.brand-bars i:nth-child(2) {
  height: 14px;
}

.brand-bars i:nth-child(3) {
  height: 11px;
}

.brand-line {
  position: absolute;
  right: 7px;
  bottom: 26px;
  width: 20px;
  height: 10px;
  border-top: 2px solid rgba(198, 237, 232, 0.95);
  border-right: 2px solid rgba(198, 237, 232, 0.95);
  transform: skewX(-18deg) rotate(-9deg);
}

.brand-line i {
  position: absolute;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #ffffff;
}

.brand-line i:first-child {
  top: -4px;
  left: -2px;
}

.brand-line i:last-child {
  right: -4px;
  bottom: -3px;
}

.brand strong {
  display: block;
  font-size: 17px;
  line-height: 1.2;
}

.brand small {
  display: block;
  margin-top: 3px;
  color: #697d8a;
  font-size: 11px;
  letter-spacing: 0;
  text-transform: uppercase;
}

.header-center {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(260px, 1fr);
  align-items: center;
  justify-self: center;
  gap: 16px;
  width: min(760px, 100%);
}

.page-title {
  min-width: 0;
  margin: 0;
  padding-left: 14px;
  border-left: 4px solid #229384;
  color: #173247;
  font-size: 22px;
  font-weight: 900;
  line-height: 1.2;
  letter-spacing: 0;
  white-space: nowrap;
}

.location-search {
  position: relative;
  min-width: 0;
}

.location-search input {
  width: 100%;
  height: 42px;
  padding: 0 42px 0 40px;
  border: 1px solid rgba(91, 117, 132, 0.2);
  border-radius: 8px;
  color: #173247;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.76);
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  outline: 0;
}

.location-search input:focus {
  border-color: rgba(34, 147, 132, 0.42);
  box-shadow:
    0 0 0 3px rgba(34, 147, 132, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.76);
}

.search-mark {
  position: absolute;
  top: 12px;
  left: 14px;
  width: 13px;
  height: 13px;
  border: 2px solid #607384;
  border-radius: 50%;
  pointer-events: none;
}

.search-mark::after {
  position: absolute;
  right: -6px;
  bottom: -5px;
  width: 7px;
  height: 2px;
  content: '';
  border-radius: 999px;
  background: #607384;
  transform: rotate(45deg);
}

.location-search > button {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(91, 117, 132, 0.14);
  border-radius: 8px;
  color: #607384;
  background: #ffffff;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.header-tools {
  display: flex;
  justify-content: flex-end;
}

.login-button {
  max-width: 220px;
  height: 42px;
  display: inline-grid;
  place-items: center;
  overflow: hidden;
  padding: 0 16px;
  border-radius: 8px;
  color: #ffffff;
  background: #173247;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 900;
}

.module-switch-link {
  min-width: 92px;
  min-height: 42px;
  display: grid;
  place-items: center;
  padding: 6px 12px;
  border: 1px solid rgba(23, 50, 71, 0.14);
  border-radius: 8px;
  color: #173247;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(240, 248, 250, 0.9)),
    #ffffff;
  box-shadow: 0 8px 18px rgba(23, 50, 71, 0.07);
  text-decoration: none;
}

.module-switch-link span {
  color: #6d8190;
  font-size: 10px;
  font-weight: 900;
  line-height: 1.1;
}

.module-switch-link strong {
  margin-top: 2px;
  color: #173247;
  font-size: 14px;
  font-weight: 950;
  line-height: 1.1;
}

.module-switch-link:hover,
.module-switch-link:focus-visible {
  border-color: rgba(34, 147, 132, 0.38);
  background: #ffffff;
  box-shadow: 0 12px 24px rgba(23, 50, 71, 0.11);
  outline: none;
}

.sankey-stage {
  position: relative;
  min-height: calc(100vh - 70px);
  overflow: auto;
  background:
    linear-gradient(115deg, transparent 0 36%, rgba(255, 255, 255, 0.22) 44%, transparent 52%),
    radial-gradient(circle at 20% 24%, rgba(255, 255, 255, 0.45), transparent 23%),
    repeating-linear-gradient(145deg, rgba(45, 102, 128, 0.055) 0 1px, transparent 1px 44px),
    #e7edf1;
}

.sankey-canvas {
  position: relative;
  z-index: 0;
  width: 100%;
  min-width: 1080px;
  min-height: calc(100vh - 70px);
}

.map-tool-stack {
  position: fixed;
  top: 180px;
  right: 28px;
  z-index: 7;
  display: grid;
  gap: 8px;
  transition: right 0.24s ease;
}

.detail-open .map-tool-stack {
  right: min(448px, calc(50vw + 10px));
}

.map-tool-button {
  width: 42px;
  height: 42px;
  display: grid;
  grid-template-rows: 19px auto;
  place-items: center;
  gap: 1px;
  padding: 0;
  border: 1px solid rgba(91, 117, 132, 0.12);
  border-radius: 8px;
  color: #173247;
  background: #ffffff;
  box-shadow: 0 8px 20px rgba(19, 46, 63, 0.13);
  cursor: pointer;
}

.map-tool-button:hover {
  color: #0f766e;
  background: #f7fafb;
}

.tool-label {
  color: currentColor;
  font-size: 9px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: 0;
}

.reset-icon,
.unlock-icon,
.export-icon,
.drawer-icon {
  position: relative;
  width: 18px;
  height: 18px;
  display: block;
}

.reset-icon::before {
  position: absolute;
  inset: 3px;
  content: '';
  border: 2px solid currentColor;
  border-radius: 50%;
}

.reset-icon::after {
  position: absolute;
  top: 2px;
  right: 1px;
  width: 7px;
  height: 7px;
  content: '';
  border-top: 2px solid currentColor;
  border-right: 2px solid currentColor;
  transform: rotate(20deg);
}

.unlock-icon::before,
.export-icon::before,
.drawer-icon::before {
  position: absolute;
  inset: 4px 3px 3px;
  content: '';
  border: 2px solid currentColor;
  border-radius: 3px;
}

.unlock-icon::after {
  position: absolute;
  left: 3px;
  top: 1px;
  width: 8px;
  height: 8px;
  content: '';
  border: 2px solid currentColor;
  border-right: 0;
  border-bottom: 0;
  border-radius: 8px 0 0;
}

.export-icon::after {
  position: absolute;
  top: 0;
  left: 7px;
  width: 5px;
  height: 10px;
  content: '';
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  transform: rotate(45deg);
}

.drawer-icon::after {
  position: absolute;
  top: 4px;
  right: 4px;
  bottom: 3px;
  width: 4px;
  content: '';
  background: currentColor;
  border-radius: 2px;
}

.filter-shell {
  position: fixed;
  top: 108px;
  left: 18px;
  z-index: 6;
  width: 292px;
  transform: translateX(0);
  transition:
    transform 0.3s cubic-bezier(0.2, 0.78, 0.18, 1),
    opacity 0.22s ease;
}

.filter-shell.collapsed {
  transform: translateX(calc(-100% - 7px));
}

.floating-filters {
  position: relative;
  display: grid;
  grid-template-columns: 1fr;
  gap: 11px;
  padding: 14px;
  border: 1px solid rgba(100, 121, 133, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 18px 45px rgba(19, 46, 63, 0.18);
  backdrop-filter: blur(16px);
}

.filter-shell.collapsed .floating-filters {
  pointer-events: none;
  opacity: 0;
  transform: translateX(-10px) scale(0.985);
}

.filter-toggle {
  position: absolute;
  top: 16px;
  right: -19px;
  width: 26px;
  height: 54px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(89, 108, 120, 0.18);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 10px 28px rgba(19, 46, 63, 0.16);
  cursor: pointer;
  backdrop-filter: blur(14px);
}

.filter-toggle span {
  width: 10px;
  height: 10px;
  border-top: 2px solid #173247;
  border-left: 2px solid #173247;
  transform: translateX(2px) rotate(-45deg);
}

.filter-shell.collapsed .filter-toggle span {
  transform: translateX(-2px) rotate(135deg);
}

.floating-filters label {
  min-width: 0;
  display: grid;
  gap: 5px;
}

.floating-filters span,
.detail-drawer header span,
.detail-metrics dt {
  color: #607384;
  font-size: 12px;
  font-weight: 900;
}

.floating-filters select {
  width: 100%;
  min-width: 0;
  height: 40px;
  border: 1px solid rgba(91, 117, 132, 0.22);
  border-radius: 8px;
  color: #173247;
  background: #ffffff;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.top-check {
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 9px !important;
}

.top-check input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: #229384;
}

.map-message {
  position: fixed;
  top: 108px;
  left: 50%;
  z-index: 6;
  margin: 0;
  padding: 10px 13px;
  border-radius: 8px;
  color: #173247;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 14px 35px rgba(19, 46, 63, 0.14);
  transform: translateX(-50%);
}

.map-message.error {
  color: #9c2f1f;
}

.map-status-chip {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 8;
  max-width: min(620px, calc(100% - 36px));
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px 10px;
  padding: 8px 10px;
  border: 1px solid rgba(91, 117, 132, 0.16);
  border-radius: 8px;
  color: #173247;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 10px 28px rgba(19, 46, 63, 0.12);
  backdrop-filter: blur(14px);
  transition: right 0.24s ease;
}

.detail-open .map-status-chip {
  right: min(448px, calc(50vw + 10px));
}

.map-status-chip span,
.map-status-chip strong {
  font-size: 11px;
  line-height: 1.1;
}

.map-status-chip span {
  color: #607384;
  font-weight: 800;
}

.map-status-chip strong {
  font-weight: 900;
}

.detail-drawer {
  position: fixed;
  top: 108px;
  right: 18px;
  z-index: 9;
  box-sizing: border-box;
  width: min(420px, calc(50vw - 28px));
  max-height: calc(100vh - 126px);
  display: grid;
  align-content: start;
  gap: 14px;
  padding: 18px;
  border: 1px solid rgba(100, 121, 133, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 24px 60px rgba(19, 46, 63, 0.2);
  overflow: auto;
  opacity: 0;
  pointer-events: none;
  transform: translateX(calc(100% + 30px)) scale(0.985);
  transform-origin: top right;
  transition:
    transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 0.22s ease;
  backdrop-filter: blur(18px);
}

.detail-drawer.open {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0) scale(1);
}

.detail-drawer header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.detail-drawer header button {
  width: 34px;
  height: 34px;
  border: 1px solid rgba(91, 117, 132, 0.22);
  border-radius: 8px;
  color: #173247;
  background: #ffffff;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.detail-drawer h2,
.source-list h3 {
  margin: 0;
}

.detail-drawer h2 {
  font-size: 23px;
  line-height: 1.25;
}

.detail-metrics {
  display: grid;
  gap: 8px;
  margin: 0;
}

.detail-metrics div {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid rgba(91, 117, 132, 0.14);
}

.detail-metrics dt,
.detail-metrics dd {
  margin: 0;
}

.detail-metrics dd {
  overflow-wrap: anywhere;
  font-weight: 900;
}

.source-list {
  display: grid;
  gap: 10px;
  padding-top: 2px;
  padding-right: 2px;
}

.source-list h3 {
  font-size: 16px;
}

.source-list p,
.drawer-message {
  margin: 0;
  color: #607384;
  line-height: 1.65;
}

.source-list b {
  color: #173247;
}

.source-list article {
  display: grid;
  gap: 5px;
  padding: 12px;
  border: 1px solid rgba(91, 117, 132, 0.16);
  border-radius: 8px;
  background: #ffffff;
}

.source-list.compact article {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  padding: 9px 10px;
}

.source-list strong {
  overflow-wrap: anywhere;
}

.source-list.compact strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-list em {
  color: #607384;
  font-style: normal;
  overflow-wrap: anywhere;
}

.source-list article button {
  justify-self: start;
  min-height: 32px;
  padding: 0 11px;
  border: 1px solid rgba(15, 101, 145, 0.28);
  border-radius: 8px;
  color: #0f6591;
  background: #f4fafc;
  cursor: pointer;
  font-size: 12px;
  font-weight: 900;
}

@media (max-width: 1180px) {
  .site-header {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .header-center {
    grid-template-columns: 1fr;
    justify-self: stretch;
  }

  .header-tools {
    justify-content: flex-start;
  }

  .filter-shell,
  .map-tool-stack,
  .detail-drawer,
  .map-status-chip,
  .detail-open .map-status-chip,
  .detail-open .map-tool-stack {
    position: absolute;
  }

  .filter-shell {
    top: 18px;
  }

  .map-tool-stack,
  .detail-open .map-tool-stack {
    top: 18px;
    right: 18px;
  }

  .detail-drawer {
    top: 78px;
    width: min(420px, calc(100% - 36px));
  }

  .map-status-chip,
  .detail-open .map-status-chip {
    right: 18px;
  }
}

@media (max-width: 720px) {
  .site-header {
    padding: 12px;
  }

  .brand strong {
    font-size: 14px;
  }

  .brand small {
    font-size: 10px;
  }

  .page-title {
    font-size: 20px;
  }

  .filter-shell {
    width: min(316px, calc(100% - 54px));
  }

  .detail-metrics div,
  .source-list.compact article {
    grid-template-columns: 1fr;
  }
}

.sankey-shell {
  --sankey-ink: #143044;
  --sankey-muted: #587283;
  --sankey-canvas: #eef8f7;
  --sankey-control-bg: rgba(247, 252, 251, 0.9);
  --sankey-chart-bg: rgba(248, 254, 253, 0.96);
  --sankey-side-bg: rgba(249, 252, 255, 0.96);
  --sankey-border: rgba(87, 119, 135, 0.2);
  --sankey-blue: #326fb4;
  --sankey-teal: #16857c;
  --sankey-amber: #c77920;
  --sankey-rose: #b45d6b;
  background:
    radial-gradient(circle at 16% 22%, rgba(47, 143, 132, 0.1), transparent 24%),
    radial-gradient(circle at 88% 18%, rgba(50, 111, 180, 0.1), transparent 26%),
    linear-gradient(120deg, #eaf7f4, #f8fbfd 43%, #edf4fb),
    #f4f8f8;
}

.sankey-map-header.site-header {
  position: sticky;
  top: 0;
  z-index: 30;
  border-bottom: 1px solid rgba(96, 124, 143, 0.16);
  background:
    linear-gradient(90deg, rgba(236, 249, 246, 0.97), rgba(255, 255, 255, 0.98) 46%, rgba(239, 247, 251, 0.97)),
    #ffffff;
  box-shadow: 0 10px 30px rgba(21, 52, 72, 0.08);
  opacity: var(--header-opacity, 1);
  transform: translateY(var(--header-offset, 0));
  transition:
    opacity 0.42s ease,
    transform 0.42s ease,
    box-shadow 0.42s ease;
  will-change: opacity, transform;
}

.sankey-map-header.is-hidden {
  pointer-events: none;
  box-shadow: none;
}

.sankey-controls {
  grid-template-columns:
    minmax(260px, 1.3fr)
    minmax(188px, 0.72fr)
    minmax(90px, 110px)
    auto
    auto
    auto;
  gap: 12px;
  margin: 0;
  padding: 16px clamp(16px, 2vw, 24px) 10px;
  border-bottom: 1px solid rgba(83, 118, 133, 0.16);
  background:
    linear-gradient(90deg, rgba(241, 250, 248, 0.92), rgba(252, 253, 252, 0.96) 48%, rgba(242, 248, 253, 0.92)),
    var(--sankey-control-bg);
}

.compact-field {
  max-width: 116px;
}

.control-field select,
.control-field input,
.sankey-controls button,
.top-toggle {
  border-color: rgba(87, 119, 135, 0.24);
  border-radius: 8px;
  color: var(--sankey-ink);
  background: rgba(255, 255, 255, 0.94);
}

.control-field span,
.top-toggle span {
  color: var(--sankey-muted);
}

.control-field select:focus,
.control-field input:focus {
  border-color: rgba(26, 132, 125, 0.55);
  box-shadow: 0 0 0 3px rgba(26, 132, 125, 0.12);
}

.top-toggle input {
  accent-color: #1a847d;
}

.sankey-controls button {
  color: var(--sankey-ink);
  box-shadow: 0 8px 18px rgba(27, 62, 82, 0.06);
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}

.sankey-controls button:hover,
.sankey-controls button:focus-visible {
  outline: none;
}

.export-button {
  color: #ffffff !important;
  border-color: #173247 !important;
  background: linear-gradient(135deg, #173247, #145c67) !important;
}

.sankey-main {
  gap: 16px;
  padding: 14px clamp(14px, 2vw, 22px) 24px;
}

.chart-panel,
.side-panel {
  border-color: rgba(105, 127, 140, 0.17);
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 18px 45px rgba(23, 50, 71, 0.08);
}

.chart-panel {
  scrollbar-color: rgba(26, 132, 125, 0.38) rgba(226, 236, 239, 0.65);
}

.lock-bar {
  border-bottom-color: rgba(105, 127, 140, 0.12);
  color: #5b7280;
  background: linear-gradient(90deg, rgba(248, 253, 252, 0.94), rgba(255, 255, 255, 0.96));
}

.lock-bar strong {
  color: #173247;
}

.side-panel {
  top: 18px;
  padding: 16px;
}

.detail-block p,
.path-row span,
.path-note,
.top-list li {
  color: #5b7280;
}

.detail-block {
  border-top-color: rgba(105, 127, 140, 0.12);
}

.path-row {
  border-bottom-color: rgba(105, 127, 140, 0.12);
}

.path-row button {
  border-color: rgba(26, 132, 125, 0.3);
  color: #0f766e;
  background: rgba(237, 249, 247, 0.92);
}

.path-row button:hover,
.path-row button:focus-visible {
  border-color: #1a847d;
  background: #ffffff;
}

.sankey-controls .control-button {
  position: relative;
  min-width: 76px;
  font-weight: 900;
}

.sankey-controls .reset-button {
  border-color: rgba(50, 111, 180, 0.32);
  color: #2c639f;
  background: linear-gradient(180deg, rgba(248, 251, 255, 0.98), rgba(239, 247, 255, 0.9));
}

.sankey-controls .reset-button:hover,
.sankey-controls .reset-button:focus-visible {
  border-color: rgba(50, 111, 180, 0.62);
  color: #1f5c9a;
  background: linear-gradient(180deg, #ffffff, #e8f2ff);
  box-shadow: 0 11px 24px rgba(50, 111, 180, 0.16);
  transform: translateY(-1px);
}

.sankey-controls .clear-lock-button {
  border-color: rgba(199, 121, 32, 0.36);
  color: #9a5a16;
  background: linear-gradient(180deg, rgba(255, 252, 247, 0.98), rgba(255, 244, 229, 0.9));
}

.sankey-controls .clear-lock-button:hover,
.sankey-controls .clear-lock-button:focus-visible {
  border-color: rgba(199, 121, 32, 0.7);
  color: #87500f;
  background: linear-gradient(180deg, #fffaf3, #ffe9c8);
  box-shadow:
    0 0 0 3px rgba(199, 121, 32, 0.1),
    0 10px 22px rgba(199, 121, 32, 0.15);
}

.sankey-controls .export-button {
  min-width: 96px;
  border-color: #132e47 !important;
  background: linear-gradient(135deg, #173247, #136270 55%, #0f766e) !important;
  box-shadow: 0 12px 24px rgba(19, 50, 71, 0.18);
}

.sankey-controls .export-button:hover,
.sankey-controls .export-button:focus-visible {
  border-color: #0e263d !important;
  color: #ffffff !important;
  background: linear-gradient(135deg, #10283e, #0d5e72 54%, #0a7d72) !important;
  box-shadow: 0 15px 30px rgba(19, 50, 71, 0.24);
  transform: translateY(-1px);
}

.drug-share-block {
  padding-bottom: 2px;
}

.side-panel > .drug-share-block:first-child {
  padding-top: 0;
  border-top: 0;
}

.node-summary-block {
  padding: 11px;
  border: 1px solid rgba(105, 127, 140, 0.1);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.52);
}

.drug-share-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 0 0 8px;
}

.drug-share-heading h3 {
  margin: 0;
}

.drug-share-heading button,
.pie-modal header button {
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid rgba(50, 111, 180, 0.28);
  border-radius: 8px;
  color: #2c639f;
  background: linear-gradient(180deg, rgba(248, 251, 255, 0.98), rgba(235, 244, 254, 0.92));
  cursor: pointer;
  font-size: 12px;
  font-weight: 900;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;
}

.drug-share-heading button:hover,
.drug-share-heading button:focus-visible,
.pie-modal header button:hover,
.pie-modal header button:focus-visible {
  border-color: rgba(50, 111, 180, 0.62);
  color: #1f5c9a;
  background: #ffffff;
  box-shadow: 0 10px 20px rgba(50, 111, 180, 0.14);
  outline: none;
  transform: translateY(-1px);
}

.drug-share-chart-shell,
.pie-modal-chart-shell {
  position: relative;
  display: grid;
  place-items: center;
  border: 1px solid rgba(105, 127, 140, 0.12);
  border-radius: 8px;
  background:
    radial-gradient(circle at 35% 40%, rgba(255, 255, 255, 0.92), transparent 42%),
    linear-gradient(180deg, rgba(248, 253, 252, 0.92), rgba(242, 248, 252, 0.78));
}

.drug-share-chart-shell {
  height: 190px;
  margin: 6px 0 4px;
}

.drug-share-chart {
  width: 100%;
  height: 100%;
}

.drug-share-center,
.pie-modal-center {
  position: absolute;
  inset: 50% auto auto 50%;
  display: grid;
  place-items: center;
  min-width: 76px;
  transform: translate(-50%, -50%);
  pointer-events: none;
  text-align: center;
}

.drug-share-center strong,
.pie-modal-center strong {
  color: #173247;
  font-size: 20px;
  line-height: 1;
}

.drug-share-center span,
.pie-modal-center span {
  margin-top: 4px;
  color: #557080;
  font-size: 11px;
  font-weight: 900;
}

.drug-share-center em,
.pie-modal-center em {
  margin-top: 2px;
  color: #7a8d99;
  font-size: 10px;
  font-style: normal;
  font-weight: 800;
}

.drug-share-list {
  display: grid;
  gap: 6px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.drug-share-list li {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  color: #5b7280;
  font-size: 12px;
}

.drug-share-list i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.9);
}

.drug-share-list b {
  overflow: hidden;
  color: #173247;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drug-share-list span {
  color: #5b7280;
  font-weight: 800;
  white-space: nowrap;
}

.relation-empty-card,
.single-relation-card {
  position: relative;
  overflow: hidden;
  margin-top: 8px;
  border: 1px solid rgba(105, 127, 140, 0.12);
  border-radius: 10px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(240, 248, 250, 0.88)),
    #ffffff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
}

.relation-empty-card {
  display: grid;
  gap: 5px;
  padding: 14px;
}

.relation-empty-card strong {
  color: #173247;
  font-size: 13px;
  font-weight: 950;
}

.relation-empty-card span {
  color: #647985;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.5;
}

.single-relation-card {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr);
  gap: 12px;
  padding: 14px;
  cursor: default;
}

.single-relation-card::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--relation-share);
  min-width: 42px;
  max-width: 100%;
  content: '';
  background: linear-gradient(90deg, color-mix(in srgb, var(--relation-color), transparent 78%), transparent);
  pointer-events: none;
}

.single-relation-card > i {
  position: relative;
  z-index: 1;
  width: 12px;
  height: 100%;
  min-height: 56px;
  border-radius: 999px;
  background: var(--relation-color);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.86);
}

.single-relation-main,
.single-relation-card dl {
  position: relative;
  z-index: 1;
}

.single-relation-main {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.single-relation-main span {
  color: #627a87;
  font-size: 11px;
  font-weight: 900;
}

.single-relation-main strong {
  overflow: hidden;
  color: #173247;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 950;
}

.single-relation-main em {
  color: #557080;
  font-size: 12px;
  font-style: normal;
  font-weight: 900;
}

.single-relation-card dl {
  grid-column: 2;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  margin: 8px 0 0;
}

.single-relation-card dl div {
  display: grid;
  gap: 2px;
  padding: 7px 8px;
  border: 1px solid rgba(105, 127, 140, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.62);
}

.single-relation-card dt,
.single-relation-card dd {
  margin: 0;
}

.single-relation-card dt {
  color: #69818e;
  font-size: 10px;
  font-weight: 900;
}

.single-relation-card dd {
  color: #173247;
  font-size: 13px;
  font-weight: 950;
}

.relation-share-list li {
  position: relative;
  min-height: 32px;
  overflow: hidden;
  padding: 6px 8px;
  border: 1px solid rgba(105, 127, 140, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.72);
}

.relation-share-list li::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--relation-share);
  content: '';
  background: linear-gradient(90deg, color-mix(in srgb, var(--relation-color), transparent 82%), transparent);
  pointer-events: none;
}

.relation-share-list li > * {
  position: relative;
  z-index: 1;
}

.relation-share-list li:hover,
.relation-share-list li:focus-within {
  border-color: rgba(34, 147, 132, 0.24);
  background: rgba(255, 255, 255, 0.92);
}

.relation-share-list b {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 5px;
}

.relation-share-list small,
.pie-modal-list small {
  color: #7a8d99;
  font-size: 10px;
  font-weight: 900;
  white-space: nowrap;
}

.other-relation-item i {
  border-radius: 50%;
}

.pie-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 28px;
  background: rgba(13, 34, 50, 0.34);
  backdrop-filter: blur(8px);
}

.pie-modal {
  width: min(880px, 94vw);
  max-height: min(760px, 88vh);
  overflow: auto;
  border: 1px solid rgba(105, 127, 140, 0.18);
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(252, 254, 255, 0.98), rgba(244, 250, 252, 0.96)),
    #ffffff;
  box-shadow: 0 26px 70px rgba(13, 34, 50, 0.24);
}

.pie-modal header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid rgba(105, 127, 140, 0.12);
}

.pie-modal h2 {
  margin: 0;
  color: #173247;
  font-size: 20px;
  line-height: 1.2;
}

.pie-modal header p {
  margin: 5px 0 0;
  color: #557080;
  font-size: 13px;
  font-weight: 800;
}

.pie-modal-body {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) minmax(240px, 320px);
  gap: 18px;
  padding: 18px 20px 20px;
}

.pie-modal-chart-shell {
  min-height: 390px;
  border-radius: 10px;
}

.pie-modal-chart {
  width: 100%;
  height: 390px;
}

.pie-modal-center strong {
  font-size: 28px;
}

.pie-modal-center span {
  font-size: 12px;
}

.pie-modal-list {
  align-self: start;
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pie-modal-list li {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 7px 9px;
  border: 1px solid rgba(105, 127, 140, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.68);
  color: #5b7280;
  font-size: 12px;
}

.pie-modal-list i {
  width: 12px;
  height: 12px;
  border-radius: 4px;
}

.pie-modal-list b {
  overflow: hidden;
  color: #173247;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pie-modal-list span,
.pie-modal-list strong {
  color: #5b7280;
  font-weight: 900;
  white-space: nowrap;
}

.pie-modal-list strong {
  color: #173247;
}

:global(.sankey-tip) {
  box-sizing: border-box;
  width: min(272px, calc(100vw - 28px));
  padding: 10px 11px 11px;
  color: #173247;
  font-family: Microsoft YaHei, Noto Sans CJK SC, Source Han Sans CN, SimHei, Arial, sans-serif;
}

:global(.sankey-tip__eyebrow) {
  margin-bottom: 3px;
  color: #708691;
  font-size: 10px;
  font-weight: 900;
}

:global(.sankey-tip__title) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  color: #173247;
  font-size: 14px;
  font-weight: 950;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

:global(.sankey-tip__title span) {
  color: #86a0aa;
  font-weight: 800;
}

:global(.sankey-tip__type) {
  display: inline-flex;
  margin-top: 5px;
  padding: 2px 6px;
  border: 1px solid rgba(105, 127, 140, 0.13);
  border-radius: 5px;
  color: #557080;
  background: #f7fafb;
  font-size: 10px;
  font-weight: 900;
}

:global(.sankey-tip__metrics) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  margin-top: 7px;
}

:global(.sankey-tip__metrics--single) {
  grid-template-columns: minmax(0, 1fr);
}

:global(.sankey-tip__metrics > div) {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  padding: 6px 7px;
  border: 1px solid rgba(105, 127, 140, 0.1);
  border-radius: 6px;
  background: rgba(246, 250, 251, 0.86);
  white-space: nowrap;
}

:global(.sankey-tip__metrics span),
:global(.sankey-tip__metrics small) {
  color: #718792;
  font-size: 10px;
  font-weight: 800;
}

:global(.sankey-tip__metrics strong) {
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
  justify-self: end;
  color: #173247;
  font-size: 14px;
  font-weight: 950;
}

:global(.sankey-tip__metrics small) {
  font-size: 9px;
}

:global(.sankey-tip__color) {
  display: grid;
  grid-template-columns: 9px auto minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  margin-top: 7px;
  color: #6a808b;
  font-size: 10px;
  font-weight: 850;
}

:global(.sankey-tip__color i) {
  width: 9px;
  height: 9px;
  border-radius: 3px;
}

:global(.sankey-tip__color strong) {
  overflow: hidden;
  color: #36566a;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(.sankey-tip__note) {
  margin-top: 7px;
  padding: 5px 7px;
  border-left: 3px solid #d79243;
  border-radius: 4px;
  color: #725226;
  background: #fff8ee;
  font-size: 10px;
  font-weight: 850;
  line-height: 1.45;
}

:global(.sankey-tip--node) {
  width: min(248px, calc(100vw - 28px));
  padding: 8px 10px;
}

:global(.sankey-tip__node-main) {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}

:global(.sankey-tip__node-main > span) {
  padding: 2px 5px;
  border-radius: 4px;
  color: #617985;
  background: #f0f5f6;
  font-size: 9px;
  font-weight: 900;
  white-space: nowrap;
}

:global(.sankey-tip__node-main > strong) {
  overflow: hidden;
  color: #173247;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 950;
}

:global(.sankey-tip__node-main > div) {
  display: flex;
  align-items: baseline;
  gap: 3px;
  white-space: nowrap;
}

:global(.sankey-tip__node-main b) {
  color: #173247;
  font-size: 15px;
  font-weight: 950;
}

:global(.sankey-tip__node-main small) {
  color: #718792;
  font-size: 9px;
  font-weight: 850;
}

.sankey-controls {
  grid-template-columns:
    minmax(280px, 1.2fr)
    minmax(148px, 0.42fr)
    minmax(150px, 0.52fr)
    minmax(96px, 0.34fr)
    auto
    auto
    auto;
  align-items: end;
  gap: 8px;
  padding: 8px clamp(14px, 2vw, 22px) 6px;
}

.scope-field {
  min-width: 148px;
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 0;
  border: 0;
}

.scope-field legend {
  padding: 0;
  color: var(--sankey-muted);
  font-size: 11px;
  font-weight: 800;
  line-height: 1.2;
}

.scope-segmented {
  height: 34px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: 2px;
  border: 1px solid rgba(87, 119, 135, 0.24);
  border-radius: 8px;
  background: rgba(237, 243, 245, 0.92);
}

.scope-segmented label {
  position: relative;
  min-width: 0;
  cursor: pointer;
}

.scope-segmented input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.scope-segmented span {
  height: 100%;
  display: grid;
  place-items: center;
  padding: 0 6px;
  border-radius: 6px;
  color: #647985;
  font-size: 11px;
  font-weight: 900;
  white-space: nowrap;
  transition: color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}

.scope-segmented input:checked + span {
  color: #075762;
  background: #ffffff;
  box-shadow: 0 2px 7px rgba(23, 50, 71, 0.13);
}

.scope-segmented input:focus-visible + span {
  outline: 2px solid rgba(26, 132, 125, 0.42);
  outline-offset: 1px;
}

.sankey-controls .control-field {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  align-items: center;
  gap: 6px;
}

.sankey-controls .control-field > span {
  font-size: 11px;
  line-height: 1.2;
}

.sankey-controls .control-field select,
.sankey-controls .control-button {
  min-height: 34px;
  height: 34px;
}

.display-field {
  min-width: 150px;
}

.level-field {
  min-width: 240px;
}

.compact-field {
  max-width: 112px;
}

.chart-panel {
  position: relative;
  overflow: clip;
  background:
    linear-gradient(180deg, rgba(250, 255, 254, 0.98), rgba(238, 249, 247, 0.88)),
    var(--sankey-chart-bg);
}

.sankey-chart-shell {
  position: relative;
  width: 100%;
}

.sankey-chart-scroll {
  width: 100%;
  overflow: visible;
}

.sankey-chart-shell .sankey-chart {
  position: absolute;
  z-index: 1;
  inset: 0;
  height: 100%;
}

.level1-column-rail {
  position: absolute;
  z-index: 0;
  top: 10px;
  bottom: 44px;
  left: calc(var(--series-left) - 7px);
  width: 28px;
  border: 1px solid rgba(113, 133, 179, 0.07);
  border-radius: 7px;
  background: linear-gradient(180deg, rgba(85, 166, 191, 0.03), rgba(130, 183, 168, 0.055));
  pointer-events: none;
}

.sankey-main {
  gap: 12px;
  padding-top: 8px;
}

.chart-panel::before,
.side-panel::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 3px;
  pointer-events: none;
}

.chart-panel::before {
  background: linear-gradient(90deg, var(--sankey-teal), rgba(50, 111, 180, 0.78), rgba(199, 121, 32, 0.55));
}

.side-panel::before {
  background: linear-gradient(90deg, rgba(50, 111, 180, 0.76), rgba(138, 111, 197, 0.64), rgba(22, 133, 124, 0.48));
}

.side-panel {
  background:
    linear-gradient(180deg, rgba(252, 254, 255, 0.98), rgba(243, 248, 253, 0.92)),
    var(--sankey-side-bg);
}

.stats-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.stats-summary span {
  min-width: 0;
  justify-content: center;
  padding: 5px 6px;
  border-radius: 6px;
  text-align: center;
  white-space: nowrap;
}

.lock-bar {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  min-height: 32px;
  gap: 4px 9px;
  padding: 6px 14px 5px;
  font-size: 12px;
}

.lock-bar > span {
  color: #5b7280;
}

.lock-bar.has-lock {
  border-bottom-color: rgba(11, 102, 112, 0.2);
  background: linear-gradient(90deg, rgba(222, 246, 243, 0.96), rgba(246, 252, 252, 0.96));
  box-shadow: inset 3px 0 0 #0b6670;
}

.lock-bar.has-lock strong {
  color: #075762;
}

.side-panel.has-selection {
  border-color: rgba(11, 102, 112, 0.28);
  box-shadow: 0 18px 45px rgba(23, 50, 71, 0.08), 0 0 0 2px rgba(11, 102, 112, 0.06);
}

.side-panel.has-selection::before {
  height: 4px;
  background: linear-gradient(90deg, #0b6670, #2f88a0, rgba(50, 111, 180, 0.5));
}

.filter-summary {
  display: inline-flex;
  align-items: center;
  min-height: 21px;
  padding: 0 7px;
  border: 1px solid rgba(22, 133, 124, 0.24);
  border-radius: 999px;
  color: #175b65 !important;
  background: linear-gradient(180deg, rgba(232, 249, 246, 0.94), rgba(219, 242, 246, 0.78));
  font-size: 11px;
  font-weight: 900;
}

.stage-axis {
  position: sticky;
  top: 0;
  z-index: 18;
  width: 100%;
  box-sizing: border-box;
  padding: 7px var(--series-right) 0 var(--series-left);
  border-bottom: 1px solid rgba(105, 127, 140, 0.08);
  background:
    linear-gradient(180deg, rgba(250, 255, 254, 0.98), rgba(248, 253, 252, 0.92)),
    var(--sankey-chart-bg);
}

.stage-axis-track {
  position: relative;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  min-height: 23px;
}

.stage-axis-track::before,
.stage-axis-track::after {
  display: none;
}

.stage-axis-track span {
  min-width: 0;
  display: grid;
  place-items: center;
  padding: 3px 5px;
  border: 1px solid rgba(105, 127, 140, 0.1);
  border-radius: 8px;
  color: #102a3d;
  background: rgba(255, 255, 255, 0.58);
  font-size: 12px;
  font-weight: 950;
  line-height: 1.05;
  text-align: center;
  text-shadow:
    0 1px 0 rgba(255, 255, 255, 0.86),
    0 6px 14px rgba(33, 63, 78, 0.08);
  white-space: nowrap;
}

.stage-axis-track span::after {
  display: none;
}

.sankey-chart {
  width: 100%;
  min-width: 0;
  background:
    radial-gradient(circle at 13% 20%, rgba(255, 255, 255, 0.74), transparent 24%),
    radial-gradient(circle at 86% 16%, rgba(214, 233, 250, 0.35), transparent 22%),
    linear-gradient(180deg, rgba(250, 254, 253, 0.78), rgba(242, 250, 251, 0.72));
}

@media (max-width: 1180px) {
  .sankey-controls {
    grid-template-columns: 1fr;
  }

  .compact-field {
    max-width: none;
  }

  .side-panel {
    position: relative;
  }

}

@media (max-width: 720px) {
  .chart-panel {
    overflow: clip;
  }

  .sankey-chart-scroll {
    overflow-x: auto;
    overflow-y: hidden;
  }

  .stage-axis {
    min-width: 760px;
    padding: 10px 12px 8px;
  }

  .stage-axis-track {
    height: auto;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 4px;
  }

  .stage-axis-track span {
    position: static;
    display: grid;
    min-height: 30px;
    place-items: center;
    padding: 4px 3px;
    border: 1px solid rgba(105, 127, 140, 0.12);
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.72);
    font-size: 10px;
    line-height: 1.15;
    overflow-wrap: anywhere;
    white-space: nowrap;
    transform: none !important;
  }

  .sankey-chart-shell {
    min-width: 760px;
  }

  .stats-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
