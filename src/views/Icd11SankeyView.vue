<script setup lang="ts">
import { PieChart, SankeyChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { init, use, type ECharts } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import BrandMark from '../components/BrandMark.vue'
import { ApiTimeoutError } from '../services/api'
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
  resolveUpstreamPathIds,
  sankeyHoverTargetKey,
  sortSankeyPaths,
  upstreamContext as summarizeUpstreamContext,
  upstreamLayerText,
  type RelationPieSection as BaseRelationPieSection,
  type RelationShareItem,
  type Icd11SankeyDisplayMode,
  type Level1Scope,
} from '../utils/icd11SankeyDisplay'
import {
  buildDynamicLevel2ColorMap,
  SANKEY_LEVEL2_FALLBACK_COLOR,
  sankeyLevel2ColorKey,
} from '../utils/icd11SankeyColors'
import { icd11SankeyGraphIndex } from '../utils/icd11SankeyGraphIndex'

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
  cursor?: 'pointer'
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
      color?: string
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

type LoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'timeout' | 'error'

interface DisplayPathSummary {
  paths: Icd11SankeyPath[]
  totalPathCount: number
  candidatePathCount: number
  shownPathCount: number
  totalWeight: number
  candidateWeight: number
  shownWeight: number
  weightCoverage: number
  linkedLevel1Count: number
  modeLabel: string
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
const SERIES_RIGHT = 156
const SERIES_TOP = 10
const SERIES_BOTTOM = 44
const MOBILE_CHART_MIN_WIDTH = 900
const LONG_CHART_HEIGHT_RATIO = 1.35
const LONG_CHART_MIN_NODES = 60
const UPSTREAM_CONTEXT_ENTRY_MIN = 780
const UPSTREAM_CONTEXT_ENTRY_VIEWPORT_RATIO = 1.05
const HEADER_HEIGHT = 70
const HEADER_SCROLL_THRESHOLD = 12
const HOVER_INTENT_DELAY = 85
const HOVER_RESTORE_DELAY = 110
const SANKEY_NODE_COLOR = '#4B78A8'
const SANKEY_NODE_HOVER_COLOR = '#356A9C'
const SANKEY_NODE_LOCKED_COLOR = '#245F8E'
const PIE_COLORS = [
  '#4C78A8',
  '#66A182',
  '#8A7EB5',
  '#5CA7A9',
  '#B79A4A',
  '#7E8A98',
  '#B67A9C',
  '#E39A65',
]
const PIE_OTHER_COLOR = '#A5ADB1'
const MAX_RELATION_PIE_ITEMS = 8
const TOP_RELATION_PIE_ITEMS = 7
const MAX_FILTER_CACHE_ENTRIES = 24
const MAX_HIGHLIGHT_CACHE_ENTRIES = 12
const MAX_CHART_HEIGHT = 4_200
const MAX_CHART_DEVICE_PIXEL_RATIO = 2

use([SankeyChart, PieChart, TooltipComponent, CanvasRenderer])

const chartEl = ref<HTMLElement | null>(null)
const chartShellEl = ref<HTMLElement | null>(null)
const chartScrollEl = ref<HTMLElement | null>(null)
const modalPieChartEl = ref<HTMLElement | null>(null)
const currentCategory = ref('')
const categories = ref<string[]>([])
const graph = ref<Icd11SankeyGraph | null>(null)
const activeBaseGraph = ref<Icd11SankeyGraph | null>(null)
const renderedGraph = ref<Icd11SankeyGraph | null>(null)
const isLoading = ref(false)
const loadState = ref<LoadState>('idle')
const errorMessage = ref('')
const searchQuery = ref('')
const displayMode = ref<Icd11SankeyDisplayMode>('all')
const selectedLevel1 = ref('')
const level1Scope = ref<Level1Scope>('linked')
const minWeight = ref(0)
const chartHeight = ref(760)
const viewportHeight = ref(720)
const chartScrollLeft = ref(0)
const upstreamContextVisible = ref(false)
const hoverContextPathIds = ref<string[]>([])
const hoverContextTitle = ref('')
const lockLabel = ref('')
const lockText = ref('当前未锁定路径')
const lockedEdge = ref<Icd11SankeyLink | null>(null)
const lockedPathId = ref('')
const currentFocus = ref('')
const detail = ref<DetailState>({ kind: 'category' })
const headerVisible = ref(true)
const pieModalOpen = ref(false)
const activePieId = ref('')

let chart: ECharts | null = null
let pieCharts = new Map<string, ECharts>()
const pieChartElements = new Map<string, HTMLElement>()
let modalPieChart: ECharts | null = null
let categoryController: AbortController | null = null
let graphController: AbortController | null = null
let hoverPreviewTimer: number | null = null
let hoverRestoreTimer: number | null = null
let activePreviewKey = ''
let lastHeaderScrollTop = 0
let headerScrollTravel = 0
let headerScrollDirection = 0
const displaySummaryCache = new WeakMap<Icd11SankeyGraph, Map<string, DisplayPathSummary>>()
const filteredGraphCache = new WeakMap<Icd11SankeyGraph, Map<string, Icd11SankeyGraph>>()
const chartGraphCache = new WeakMap<Icd11SankeyGraph, ChartGraph>()
const highlightGraphCache = new WeakMap<Icd11SankeyGraph, Map<string, ChartGraph>>()

const statsSummaryItems = computed(() => {
  const stats = graph.value?.stats
  if (!stats) return []
  return [
    { label: '总权重', value: formatNumber(stats.totalWeight) },
    { label: '源映射', value: formatNumber(stats.mappingRows ?? stats.relations) },
    { label: '聚合关系', value: formatNumber(stats.relations) },
    { label: 'Level1', value: formatNumber(stats.level1) },
    { label: 'Level2', value: formatNumber(stats.level2) },
    { label: 'Level3', value: formatNumber(stats.level3) },
    { label: '止于 Level2', value: formatNumber(stats.level2OnlyPaths) },
    { label: '药物', value: formatNumber(stats.drug) },
    { label: '生物标记物', value: formatNumber(stats.biomarker) },
  ]
})
const isCompactDetail = computed(
  () =>
    detail.value.kind === 'node' ||
    (detail.value.kind === 'paths' && detail.value.paths.length > 1),
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
const hasRenderableGraph = computed(() => Boolean(graph.value?.paths.length))
const selectedCategoryLabel = computed(
  () => graph.value?.category || currentCategory.value || 'ICD11 桑基图',
)
const headerStyle = computed(() => ({
  '--header-opacity': headerVisible.value ? '1' : '0',
}))
const chartPanelStyle = computed(() => ({
  '--series-left': `${SERIES_LEFT}px`,
  '--series-right': `${SERIES_RIGHT}px`,
  '--chart-min-width': `${MOBILE_CHART_MIN_WIDTH}px`,
}))
const stageAxisCanvasStyle = computed(() => ({
  transform: `translate3d(${-chartScrollLeft.value}px, 0, 0)`,
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
  const linkedText =
    summary.linkedLevel1Count > 0 ? ` · 关联 ${summary.linkedLevel1Count} 个其他 Level1` : ''
  const scopeText = level1Scope.value === 'linked' ? '含关联' : '仅当前'
  return `${baseText} · 权重覆盖 ${formatPercent(summary.weightCoverage)}${linkedText} · ${scopeText} · ${summary.modeLabel}`
})
const relationPieSections = computed<RelationPieSection[]>(() => {
  if (detail.value.kind !== 'node') return []
  return relationPieSectionsForNode(detail.value.nodeKind, detail.value.paths).map((section) =>
    normalizeRelationPieSection(section),
  )
})
const activePieSection = computed(
  () => relationPieSections.value.find((section) => section.id === activePieId.value) ?? null,
)
const isLongChart = computed(() => {
  const maxNodes = activeBaseGraph.value?.stats.maxNodes ?? 0
  return (
    chartHeight.value > viewportHeight.value * LONG_CHART_HEIGHT_RATIO ||
    maxNodes > LONG_CHART_MIN_NODES
  )
})
const persistentContextPathIds = computed(() => {
  const baseGraph = activeBaseGraph.value
  if (!baseGraph) return []
  if (currentFocus.value) return pathIdsForNode(baseGraph, currentFocus.value)
  if (lockedEdge.value) return lockedEdge.value.pathIds
  if (lockedPathId.value) return [lockedPathId.value]
  return []
})
const upstreamContextPathIds = computed(() =>
  resolveUpstreamPathIds(hoverContextPathIds.value, persistentContextPathIds.value),
)
const upstreamContextPaths = computed(() => {
  const baseGraph = activeBaseGraph.value
  if (!baseGraph) return []
  const pathIds = upstreamContextPathIds.value
  return pathIds.length ? selectedPaths(baseGraph, pathIds) : baseGraph.paths
})
const upstreamContextData = computed(() => summarizeUpstreamContext(upstreamContextPaths.value))
const upstreamContextFocused = computed(() => upstreamContextPathIds.value.length > 0)
const upstreamContextTitle = computed(() => {
  if (hoverContextTitle.value) return hoverContextTitle.value
  const baseGraph = activeBaseGraph.value
  if (currentFocus.value && baseGraph) {
    return (
      baseGraph.nodes.find((node) => node.name === currentFocus.value)?.displayName ?? '已锁定节点'
    )
  }
  if (lockedEdge.value) return `${lockedEdge.value.sourceLabel} → ${lockedEdge.value.targetLabel}`
  if (lockedPathId.value && baseGraph) {
    const path = pathMap(baseGraph).get(lockedPathId.value)
    if (path) return pathText(path)
  }
  return '当前筛选范围'
})
const upstreamContextRows = computed(() => {
  const context = upstreamContextData.value
  const focused = upstreamContextFocused.value
  const relatedLevel1Count = context.level1.filter((name) => name !== selectedLevel1.value).length
  const level1Text = focused
    ? upstreamLayerText(context.level1)
    : relatedLevel1Count > 0
      ? `${selectedLevel1.value} · 含关联 ${relatedLevel1Count} 项`
      : selectedLevel1.value || upstreamLayerText(context.level1)
  const level2Text = focused ? upstreamLayerText(context.level2) : `${context.level2.length} 项`
  let level3Text = focused ? upstreamLayerText(context.level3) : `${context.level3.length} 项`
  if (!context.level3.length && context.level2OnlyPathCount > 0) {
    level3Text = '止于 Level2'
  } else if (context.level2OnlyPathCount > 0) {
    level3Text = `${level3Text} · 含直接 Level2`
  }
  return [
    { label: 'Level1', value: level1Text },
    { label: 'Level2', value: level2Text },
    { label: 'Level3', value: level3Text },
  ]
})

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
  viewportHeight.value = window.innerHeight
  await nextTick()
  initChart()
  window.addEventListener('resize', handleResize)
  window.addEventListener('scroll', handleWindowScroll, { passive: true })
  window.addEventListener('keydown', handleKeydown)
  handleWindowScroll()
  await loadCategories()
})

onBeforeUnmount(() => {
  categoryController?.abort()
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
  categoryController?.abort()
  const controller = new AbortController()
  categoryController = controller
  isLoading.value = true
  loadState.value = 'loading'
  errorMessage.value = ''
  try {
    const response = await fetchIcd11SankeyCategories(controller.signal)
    if (controller.signal.aborted) return
    categories.value = response.categories.filter((category) => Boolean(category?.trim()))
    if (!categories.value.length) {
      graph.value = null
      currentCategory.value = ''
      activeBaseGraph.value = null
      renderedGraph.value = null
      chart?.clear()
      loadState.value = 'empty'
      return
    }
    const initialCategory = response.defaultCategory || categories.value[0] || ''
    currentCategory.value = initialCategory
    if (initialCategory) {
      await loadGraph(initialCategory)
    }
  } catch (error) {
    if (controller.signal.aborted) return
    setLoadError(error, 'ICD11 分类列表加载失败')
  } finally {
    if (!controller.signal.aborted) isLoading.value = false
  }
}

async function loadGraph(category: string) {
  graphController?.abort()
  const controller = new AbortController()
  graphController = controller
  isLoading.value = true
  loadState.value = 'loading'
  errorMessage.value = ''
  try {
    const response = await fetchIcd11SankeyGraph(category, controller.signal)
    if (controller.signal.aborted) return
    graph.value = response
    currentCategory.value = response.category
    loadState.value = response.paths.length ? 'ready' : 'empty'
    resetInteractionState()
    await nextTick()
    render()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    if (controller.signal.aborted) return
    setLoadError(error, 'ICD11 桑基图加载失败')
  } finally {
    if (!controller.signal.aborted) {
      isLoading.value = false
    }
  }
}

function setLoadError(error: unknown, fallback: string) {
  if (error instanceof ApiTimeoutError) {
    loadState.value = 'timeout'
    errorMessage.value = '请求超时，服务可能繁忙或网络不稳定'
    return
  }
  loadState.value = 'error'
  errorMessage.value = error instanceof Error ? error.message : fallback
}

function retryLoad() {
  if (categories.value.length && currentCategory.value) {
    void loadGraph(currentCategory.value)
  } else {
    void loadCategories()
  }
}

function initChart() {
  if (!chartEl.value || chart) return
  chart = init(chartEl.value, null, {
    renderer: 'canvas',
    devicePixelRatio: Math.min(window.devicePixelRatio || 1, MAX_CHART_DEVICE_PIXEL_RATIO),
    useDirtyRect: true,
  })
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
        borderRadius: 2,
        padding: 0,
        extraCssText: 'box-shadow:0 4px 12px rgba(20,47,65,0.12);overflow:hidden;',
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
          nodeWidth: 22,
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
              borderWidth: 1,
            },
            label: {
              color: '#173247',
              textBorderColor: 'transparent',
              textBorderWidth: 0,
            },
            lineStyle: { opacity: 0.74 },
          },
          blur: {
            itemStyle: {
              opacity: 0.18,
            },
            label: {
              color: 'rgba(34, 56, 75, 0.34)',
              textBorderColor: 'transparent',
              textBorderWidth: 0,
            },
            lineStyle: { opacity: 0.04 },
          },
          label: {
            color: '#22384B',
            fontSize: sankeyLabelFontSize(baseGraph),
            fontFamily: 'Inter, PingFang SC, Microsoft YaHei, Helvetica Neue, Arial, sans-serif',
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
  const key = displayTransformKey()
  const cached = filteredGraphCache.get(baseGraph)?.get(key)
  if (cached) return cached
  const transformed = buildGraphFromPaths(baseGraph, displayPaths(baseGraph))
  setBoundedWeakCacheEntry(
    filteredGraphCache,
    baseGraph,
    key,
    transformed,
    MAX_FILTER_CACHE_ENTRIES,
  )
  return transformed
}

function buildGraphFromPaths(
  baseGraph: Icd11SankeyGraph,
  paths: Icd11SankeyPath[],
): Icd11SankeyGraph {
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
  const visibleLevel2Colors = buildDynamicLevel2ColorMap(paths, selectedLevel1.value)

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
    const color =
      visibleLevel2Colors.get(sankeyLevel2ColorKey(level1, level2)) ?? SANKEY_LEVEL2_FALLBACK_COLOR
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
    paths.filter((path) => path.level1 === selectedLevel1.value).flatMap((path) => path.nodeIds),
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
  const cached = chartGraphCache.get(baseGraph)
  if (cached) return cached
  const transformed = {
    ...baseGraph,
    nodes: baseGraph.nodes.map((node) => chartNode(node, true, false)),
    links: baseGraph.links.map((link) => chartLink(link, true, false)),
  }
  chartGraphCache.set(baseGraph, transformed)
  return transformed
}

function styledForPathIds(baseGraph: Icd11SankeyGraph, pathIds: Iterable<string>): ChartGraph {
  const activePathIds = new Set(pathIds)
  const cacheKey = [...activePathIds].sort().join('\u001f')
  const cached = highlightGraphCache.get(baseGraph)?.get(cacheKey)
  if (cached) return cached
  const activeNodes = new Set<string>()
  for (const path of selectedPaths(baseGraph, activePathIds)) {
    for (const nodeName of path.nodeIds) activeNodes.add(nodeName)
  }
  const transformed = {
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
  setBoundedWeakCacheEntry(
    highlightGraphCache,
    baseGraph,
    cacheKey,
    transformed,
    MAX_HIGHLIGHT_CACHE_ENTRIES,
  )
  return transformed
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
  const position = 'right'
  const isRelatedContext =
    (node.kind === 'level1' || node.kind === 'level2') && node.level1 !== selectedLevel1.value
  return {
    ...node,
    cursor: 'pointer',
    itemStyle: {
      color: highlighted ? SANKEY_NODE_LOCKED_COLOR : SANKEY_NODE_COLOR,
      opacity: active ? (isRelatedContext && !highlighted ? 0.7 : 1) : 0.2,
      borderColor: active ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.5)',
      borderWidth: 1,
    },
    emphasis: {
      itemStyle: {
        color: highlighted ? SANKEY_NODE_LOCKED_COLOR : SANKEY_NODE_HOVER_COLOR,
        opacity: active ? 1 : 0.58,
        borderColor: 'rgba(255,255,255,0.96)',
        borderWidth: 1,
      },
      label: {
        color: active ? '#173247' : 'rgba(34, 56, 75, 0.56)',
        textBorderColor: 'transparent',
        textBorderWidth: 0,
      },
    },
    blur: {
      itemStyle: {
        opacity: active ? 0.2 : 0.12,
      },
      label: {
        color: active ? 'rgba(34, 56, 75, 0.36)' : 'rgba(34, 56, 75, 0.24)',
        textBorderColor: 'transparent',
        textBorderWidth: 0,
      },
    },
    label: {
      show: true,
      position,
      formatter: label.text,
      color: highlighted
        ? '#12344A'
        : active
          ? isRelatedContext
            ? 'rgba(34, 56, 75, 0.72)'
            : '#22384B'
          : 'rgba(34, 56, 75, 0.56)',
      width: label.width,
      lineHeight: label.lineHeight,
      overflow: 'truncate',
      align: position === 'right' ? 'left' : 'right',
      fontWeight: highlighted ? 700 : active ? 600 : 500,
      textBorderColor: 'transparent',
      textBorderWidth: 0,
    },
  }
}

function chartLink(link: Icd11SankeyLink, active: boolean, highlighted: boolean): ChartLink {
  const color = link.color || SANKEY_LEVEL2_FALLBACK_COLOR
  const crossesLevel3 = link.edgeType === 'ICD11_Level2 → 药物'
  const isRelatedContext = link.level1 !== selectedLevel1.value
  const activeOpacity = crossesLevel3
    ? isRelatedContext
      ? 0.16
      : 0.2
    : isRelatedContext
      ? 0.28
      : 0.34
  return {
    ...link,
    lineStyle: {
      color,
      opacity: highlighted ? 0.78 : active ? activeOpacity : 0.08,
      curveness: 0.52,
    },
    emphasis: {
      lineStyle: {
        opacity: active ? 0.62 : 0.42,
      },
    },
    blur: {
      lineStyle: {
        opacity: active ? 0.08 : 0.04,
      },
    },
  }
}

function nodeLabel(node: Icd11SankeyNode) {
  const config = [
    { width: 126, lineHeight: 18 },
    { width: 126, lineHeight: 18 },
    { width: 126, lineHeight: 18 },
    { width: 118, lineHeight: 18 },
    { width: 134, lineHeight: 18 },
  ][node.depth] ?? { width: 132, lineHeight: 19 }
  return {
    ...config,
    text: singleLineLabel(node.displayName),
  }
}

function singleLineLabel(value: string) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function sankeyLabelFontSize(baseGraph: Icd11SankeyGraph) {
  if (baseGraph.stats.maxNodes > 120 || baseGraph.paths.length > 200) return 11
  if (baseGraph.stats.maxNodes > 48 || baseGraph.paths.length > 90) return 12
  if (baseGraph.stats.maxNodes > 20) return 13
  return 14
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
  schedulePreviewHighlight(target.key, target.pathIds, target.title)
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
      title: `${edge.sourceLabel} → ${edge.targetLabel}`,
    }
  }
  if (event.dataType === 'node') {
    const node = event.data as ChartNode
    const pathIds = pathIdsForNode(baseGraph, node.name)
    if (!pathIds.length) return null
    return {
      key: sankeyHoverTargetKey(`node:${node.name}`, pathIds),
      pathIds,
      title: node.displayName,
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

function schedulePreviewHighlight(key: string, pathIds: string[], contextTitle = '') {
  if (!renderedGraph.value || !pathIds.length) return
  if (key === activePreviewKey && !hoverPreviewTimer) return
  clearTimer('restore')
  clearTimer('preview')
  hoverPreviewTimer = window.setTimeout(() => {
    hoverPreviewTimer = null
    if (!renderedGraph.value || key === activePreviewKey) return
    activePreviewKey = key
    hoverContextPathIds.value = [...pathIds]
    hoverContextTitle.value = contextTitle
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
  hoverContextPathIds.value = []
  hoverContextTitle.value = ''
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

function collapsedOtherRelationItem(
  items: RelationShareItem[],
  totalWeight: number,
): RelationPieSourceItem {
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

function relationPieChartShellStyle(
  section: RelationPieSection,
  large: boolean,
): Record<string, string> {
  const itemCount = Math.max(2, section.items.length)
  const rowHeight = large ? 18 : 15
  const rowGap = large ? 5 : 3
  const legendPadding = large ? 14 : 10
  const legendHeight = itemCount * rowHeight + (itemCount - 1) * rowGap + legendPadding
  const minimumHeight = large ? 430 : 300
  const chartClearance = large ? 260 : 250
  return {
    '--relation-pie-shell-height': `${Math.max(minimumHeight, chartClearance + legendHeight)}px`,
  }
}

function handleRelationItemMouseOver(section: RelationPieSection, item: RelationPieDatum) {
  if (!item.pathIds.length) return
  schedulePreviewHighlight(
    sankeyHoverTargetKey(`relation:${section.hoverPrefix}:${item.name}`, item.pathIds),
    item.pathIds,
    item.name,
  )
}

function relationPieTooltipHtml(section: RelationPieSection, item: RelationPieDatum) {
  const otherLine = item.isOther
    ? `<div style="display:flex;justify-content:space-between;gap:16px;margin-top:6px;color:#647985;font-size:12px;font-weight:500;"><span>合并项数</span><strong style="color:#173247;font-weight:700;">${formatNumber(item.hiddenItemCount)}</strong></div>`
    : ''
  return `
    <div style="min-width:188px;max-width:260px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <i style="width:10px;height:10px;border-radius:1px;background:${item.itemStyle.color};"></i>
        <strong style="min-width:0;overflow:hidden;color:#173247;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:700;">${escapeHtml(item.name)}</strong>
      </div>
      <div style="display:grid;gap:6px;padding-top:8px;border-top:1px solid rgba(105,127,140,0.14);">
        <div style="display:flex;justify-content:space-between;gap:16px;color:#647985;font-size:12px;font-weight:500;"><span>权重</span><strong style="color:#173247;font-weight:700;">${formatNumber(item.value)}</strong></div>
        <div style="display:flex;justify-content:space-between;gap:16px;color:#647985;font-size:12px;font-weight:500;"><span>${escapeHtml(section.shareLabel)}</span><strong style="color:#173247;font-weight:700;">${formatPercent(item.share)}</strong></div>
        <div style="display:flex;justify-content:space-between;gap:16px;color:#647985;font-size:12px;font-weight:500;"><span>关联路径</span><strong style="color:#173247;font-weight:700;">${formatNumber(item.pathIds.length)} 条</strong></div>
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
    const nextChart = renderPieChartInstance(
      pieCharts.get(section.id) ?? null,
      element,
      section,
      false,
    )
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
  const compactLayout = element.clientWidth < 360
  const compactLargeLayout = large && element.clientWidth < 520
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
        borderRadius: 2,
        padding: [12, 13],
        textStyle: {
          color: '#173247',
          fontFamily: 'Arial, Noto Sans CJK SC, Source Han Sans CN, Microsoft YaHei, sans-serif',
        },
        extraCssText: ['box-shadow: 0 4px 12px rgba(13, 34, 50, 0.12);', 'line-height: 1.35;'].join(
          '',
        ),
        formatter(params: { data?: RelationPieDatum }) {
          const data = params.data
          if (!data) return ''
          return relationPieTooltipHtml(section, data)
        },
      },
      series: [
        {
          type: 'pie',
          radius: large
            ? compactLargeLayout
              ? ['37%', '55%']
              : ['46%', '72%']
            : compactLayout
              ? ['36%', '53%']
              : ['39%', '64%'],
          center: large
            ? compactLargeLayout
              ? ['50%', '40%']
              : ['40%', '46%']
            : compactLayout
              ? ['50%', '34%']
              : ['50%', '35%'],
          minAngle: 6,
          avoidLabelOverlap: true,
          selectedOffset: large ? 8 : 5,
          itemStyle: {
            borderColor: 'rgba(255,255,255,0.98)',
            borderWidth: large ? 2 : 1,
            shadowBlur: 0,
            shadowColor: 'transparent',
          },
          label: {
            show: true,
            position: 'outside',
            alignTo: 'labelLine',
            bleedMargin: 4,
            distanceToLabelLine: 3,
            color: '#4C5967',
            fontFamily:
              "Inter, 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif",
            fontSize: large && !compactLargeLayout ? 12 : 11,
            fontWeight: 650,
            lineHeight: large && !compactLargeLayout ? 18 : 16,
            textBorderColor: 'transparent',
            textBorderWidth: 0,
            formatter(params: { data?: RelationPieDatum }) {
              const data = params.data
              if (!data) return ''
              return `${formatNumber(data.value)} · ${formatPercent(data.share)}`
            },
          },
          labelLine: {
            show: true,
            length: large && !compactLargeLayout ? 12 : 4,
            length2: large && !compactLargeLayout ? 8 : 4,
            smooth: false,
            lineStyle: {
              color: '#8A96A3',
              width: 1,
              opacity: 0.82,
            },
          },
          emphasis: {
            focus: 'self',
            scale: true,
            scaleSize: large ? 7 : 4,
            itemStyle: {
              shadowBlur: 0,
              shadowColor: 'transparent',
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
    data.name,
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
  hoverContextPathIds.value = []
  hoverContextTitle.value = ''
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

function summarizeDisplayPaths(baseGraph: Icd11SankeyGraph): DisplayPathSummary {
  const cacheKey = displayTransformKey()
  const cached = displaySummaryCache.get(baseGraph)?.get(cacheKey)
  if (cached) return cached
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
    (a, b) => Number(b.level1 === selectedLevel1.value) - Number(a.level1 === selectedLevel1.value),
  )
  const limit = displayModeLimit(displayMode.value, filteredPaths.length)
  const paths = limit ? filteredPaths.slice(0, limit) : filteredPaths
  const candidateWeight = sumPathWeight(filteredPaths)
  const shownWeight = sumPathWeight(paths)

  const summary = {
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
  setBoundedWeakCacheEntry(
    displaySummaryCache,
    baseGraph,
    cacheKey,
    summary,
    MAX_FILTER_CACHE_ENTRIES,
  )
  return summary
}

function displayTransformKey() {
  return [selectedLevel1.value, level1Scope.value, displayMode.value, String(minWeight.value)].join(
    '\u001f',
  )
}

function setBoundedWeakCacheEntry<K extends object, V>(
  cache: WeakMap<K, Map<string, V>>,
  owner: K,
  key: string,
  value: V,
  maxEntries: number,
) {
  let entries = cache.get(owner)
  if (!entries) {
    entries = new Map<string, V>()
    cache.set(owner, entries)
  }
  if (entries.has(key)) entries.delete(key)
  entries.set(key, value)
  while (entries.size > maxEntries) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) break
    entries.delete(oldest)
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
  const paths = icd11SankeyGraphIndex(baseGraph).pathById
  return [...new Set(pathIds)]
    .map((pathId) => paths.get(pathId))
    .filter((path): path is Icd11SankeyPath => Boolean(path))
    .sort((a, b) => b.weight - a.weight || pathText(a).localeCompare(pathText(b), 'zh-Hans-CN'))
}

function pathIdsForNode(baseGraph: Icd11SankeyGraph, nodeName: string) {
  return [...(icd11SankeyGraphIndex(baseGraph).pathIdsByNode.get(nodeName) ?? [])]
}

function pathMap(baseGraph: Icd11SankeyGraph) {
  return icd11SankeyGraphIndex(baseGraph).pathById
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
  const availableViewportHeight = Math.max(720, window.innerHeight - HEADER_HEIGHT)
  const maxNodes = Math.max(1, baseGraph.stats.maxNodes)
  const pathCount = baseGraph.paths.length
  const dense = pathCount > 200 || maxNodes > 90
  const medium = pathCount > 80 || maxNodes > 28
  const perNode = dense ? 22 : medium ? 28 : 16
  const extraSpace = dense ? 320 : medium ? 260 : 160
  const maxHeight = dense ? MAX_CHART_HEIGHT : medium ? 3000 : 1200
  const contentHeight = maxNodes * perNode + extraSpace
  chartHeight.value = Math.max(availableViewportHeight, Math.min(maxHeight, contentHeight))
  void nextTick(() => {
    chart?.resize()
    updateUpstreamContextVisibility()
  })
}

function nodeGap(baseGraph: Icd11SankeyGraph) {
  const maxNodes = Math.max(12, baseGraph.stats.maxNodes)
  const pathCount = baseGraph.paths.length
  const dense = pathCount > 200 || maxNodes > 90
  const medium = pathCount > 80 || maxNodes > 28
  const availableHeight = Math.max(360, chartHeight.value - SERIES_TOP - SERIES_BOTTOM)
  const density = Math.floor((availableHeight / maxNodes) * (dense ? 0.68 : medium ? 0.7 : 0.6))
  const minGap = dense ? 4 : medium ? 6 : 8
  const maxGap = dense ? 9 : medium ? 14 : 20
  return Math.max(minGap, Math.min(maxGap, density))
}

function handleResize() {
  viewportHeight.value = window.innerHeight
  applyChartLayout()
  updateUpstreamContextVisibility()
}

function handleChartScroll(event: Event) {
  chartScrollLeft.value = (event.currentTarget as HTMLElement).scrollLeft
}

function openDetailPanel() {
  window.setTimeout(applyChartLayout, 0)
}

function applyChartLayout() {
  if (graph.value) setChartHeight(activeBaseGraph.value ?? graph.value)
  chart?.resize()
  for (const chartInstance of pieCharts.values()) chartInstance.resize()
  modalPieChart?.resize()
  window.requestAnimationFrame(() => {
    renderRelationPieCharts()
    renderModalRelationPieChart()
  })
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
  if (scrollTop <= 8) {
    headerVisible.value = true
    lastHeaderScrollTop = scrollTop
    headerScrollTravel = 0
    headerScrollDirection = 0
  } else {
    const delta = scrollTop - lastHeaderScrollTop
    lastHeaderScrollTop = scrollTop
    if (Math.abs(delta) >= 1) {
      const direction = delta > 0 ? 1 : -1
      if (direction !== headerScrollDirection) {
        headerScrollDirection = direction
        headerScrollTravel = 0
      }
      headerScrollTravel += Math.abs(delta)
      if (headerScrollTravel >= HEADER_SCROLL_THRESHOLD) {
        headerVisible.value = direction < 0
        headerScrollTravel = 0
      }
    }
  }
  updateUpstreamContextVisibility()
}

function updateUpstreamContextVisibility() {
  const shell = chartShellEl.value
  if (!shell || !isLongChart.value) {
    upstreamContextVisible.value = false
    return
  }
  const bounds = shell.getBoundingClientRect()
  const entryOffset = Math.max(
    UPSTREAM_CONTEXT_ENTRY_MIN,
    viewportHeight.value * UPSTREAM_CONTEXT_ENTRY_VIEWPORT_RATIO,
  )
  upstreamContextVisible.value = bounds.top < -entryOffset && bounds.bottom > 220
}

function pathText(path: Icd11SankeyPath) {
  return [path.level1, path.level2, path.level3, path.drug, path.biomarker]
    .filter(Boolean)
    .join(' → ')
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
  const color = link.color || SANKEY_LEVEL2_FALLBACK_COLOR
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
      <div class="sankey-tip__color"><i style="background:${color}"></i><span>Level2 动态色</span><strong>${escapeHtml(link.level2)}</strong></div>
      <div class="sankey-tip__taxonomy"><span>所属 Level1</span><strong>${escapeHtml(link.level1)}</strong></div>
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
      :class="{ 'is-hidden': !headerVisible }"
      :style="headerStyle"
    >
      <RouterLink class="brand" to="/" aria-label="污水信息因子数据库首页">
        <BrandMark :size="40" />
        <span>
          <strong>污水信息因子数据库</strong>
          <small>Wastewater Biomarker Evidence</small>
        </span>
      </RouterLink>

      <div class="header-center">
        <h1 class="page-title">ICD11 桑基图</h1>
        <label class="location-search">
          <span class="search-mark" aria-hidden="true"></span>
          <input
            v-model="searchQuery"
            type="search"
            placeholder="搜索 ICD、药物或 biomarker"
            :disabled="isLoading || !hasRenderableGraph"
          />
          <button v-if="searchQuery" type="button" aria-label="清空搜索" @click="searchQuery = ''">
            ×
          </button>
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
        <select v-model="selectedLevel1" :disabled="isLoading || !hasRenderableGraph">
          <option v-for="level1 in level1Options" :key="level1" :value="level1">
            {{ level1 }}
          </option>
        </select>
      </label>

      <fieldset class="scope-field">
        <legend>关联范围</legend>
        <div class="scope-segmented">
          <label>
            <input
              v-model="level1Scope"
              type="radio"
              value="selected"
              :disabled="isLoading || !hasRenderableGraph"
            />
            <span>仅当前</span>
          </label>
          <label>
            <input
              v-model="level1Scope"
              type="radio"
              value="linked"
              :disabled="isLoading || !hasRenderableGraph"
            />
            <span>含关联</span>
          </label>
        </div>
      </fieldset>

      <label class="control-field display-field">
        <span>显示模式</span>
        <select v-model="displayMode" :disabled="isLoading || !hasRenderableGraph">
          <option v-for="option in DISPLAY_MODE_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>

      <label class="control-field compact-field">
        <span>最小权重</span>
        <select v-model.number="minWeight" :disabled="isLoading || !hasRenderableGraph">
          <option v-for="option in MIN_WEIGHT_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>

      <div class="toolbar-actions" role="group" aria-label="图表操作">
        <button
          class="control-button reset-button"
          type="button"
          :disabled="isLoading || !hasRenderableGraph"
          @click="resetView"
        >
          重置
        </button>
        <button
          class="control-button clear-lock-button"
          type="button"
          :disabled="isLoading || !hasRenderableGraph"
          @click="clearLock"
        >
          清除锁定
        </button>
        <button
          class="control-button export-button"
          type="button"
          :disabled="isLoading || !hasRenderableGraph"
          @click="exportPng"
        >
          导出 PNG
        </button>
      </div>
    </form>

    <section class="sankey-main" :aria-label="selectedCategoryLabel">
      <section class="chart-panel" :style="chartPanelStyle" :aria-busy="isLoading">
        <div
          class="lock-bar"
          :class="{ 'has-lock': Boolean(lockedEdge || lockedPathId || currentFocus) }"
          aria-live="polite"
        >
          <strong>{{ lockLabel || '状态' }}</strong>
          <span>{{ lockText }}</span>
          <span v-if="displaySummaryText" class="filter-summary">{{ displaySummaryText }}</span>
        </div>
        <div v-if="isLoading" class="state-message loading-state" role="status" aria-live="polite">
          <span class="loading-spinner" aria-hidden="true"></span>
          <span>正在加载 ICD11 桑基图数据…</span>
        </div>
        <div v-else-if="loadState === 'timeout'" class="state-message error-state" role="alert">
          <span>{{ errorMessage }}</span>
          <button type="button" @click="retryLoad">重新加载</button>
        </div>
        <div v-else-if="loadState === 'error'" class="state-message error-state" role="alert">
          <span>{{ errorMessage || 'ICD11 桑基图接口请求失败' }}</span>
          <button type="button" @click="retryLoad">重试</button>
        </div>
        <div v-else-if="loadState === 'empty'" class="state-message empty-state" role="status">
          <span>
            {{
              categories.length
                ? '当前分类没有可展示的 ICD11 桑基路径'
                : '暂无可用的 ICD11 分类数据'
            }}
          </span>
          <button type="button" @click="retryLoad">刷新数据</button>
        </div>
        <div v-if="hasRenderableGraph" class="stage-axis" aria-hidden="true">
          <div class="stage-axis-canvas" :style="stageAxisCanvasStyle">
            <div class="stage-axis-track">
              <span
                v-for="(title, index) in STAGE_TITLES"
                :key="title"
                :data-stage-index="index"
                :style="{ left: `${index * 25}%` }"
              >
                {{ title }}
              </span>
            </div>
          </div>
        </div>
        <div
          v-show="hasRenderableGraph"
          ref="chartScrollEl"
          class="sankey-chart-scroll"
          @scroll.passive="handleChartScroll"
        >
          <div
            ref="chartShellEl"
            class="sankey-chart-shell"
            :style="{ height: `${chartHeight}px` }"
          >
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
        <section
          v-if="upstreamContextVisible"
          class="upstream-context is-visible"
          aria-label="当前上游层级上下文"
          aria-live="polite"
        >
          <header>
            <span>上游上下文</span>
            <strong :title="upstreamContextTitle">{{ upstreamContextTitle }}</strong>
          </header>
          <dl>
            <template v-for="row in upstreamContextRows" :key="row.label">
              <dt>{{ row.label }}</dt>
              <dd :title="row.value">{{ row.value }}</dd>
            </template>
          </dl>
        </section>
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
          <section class="detail-block legend-block">
            <h3>图例说明</h3>
            <dl class="legend-list">
              <div>
                <dt>颜色与带宽</dt>
                <dd>
                  节点统一为青灰色；流带按 Level2 动态着色，优先区分当前
                  Level1。带宽代表涉及文献数权重。
                </dd>
              </div>
              <div>
                <dt>Level1 轨道</dt>
                <dd>浅色纵向轨道仅用于层级定位，不代表权重。</dd>
              </div>
              <div>
                <dt>关联展开</dt>
                <dd>同时显示与当前 Level1 共享下游节点的其他 Level1 路径。</dd>
              </div>
              <div>
                <dt>完整路径</dt>
                <dd>Level1 → Level2 → Level3 → 药物 → 生物标记物。</dd>
              </div>
              <div>
                <dt>跨层路径</dt>
                <dd>正式终止于 Level2 的映射直接连接药物，透明度较低且不补造 Level3。</dd>
              </div>
              <div>
                <dt>聚合规则</dt>
                <dd>相同有效层级关系合并，权重为涉及文献数之和。</dd>
              </div>
            </dl>
          </section>
          <section class="detail-block ranking-block">
            <h3>Top ICD11_Level1</h3>
            <ul class="top-list">
              <li v-for="(item, index) in topList(categoryStats.topLevel1)" :key="item.name">
                <span class="top-rank">{{ index + 1 }}</span>
                <b>{{ item.name }}</b>
                <span>{{ formatNumber(item.value) }} · {{ formatPercent(item.share) }}</span>
              </li>
            </ul>
          </section>
          <section class="detail-block ranking-block">
            <h3>Top ICD11_Level3</h3>
            <p class="path-note">
              仅统计真实 Level3 路径，权重 {{ formatNumber(categoryStats.level3Weight) }}。
            </p>
            <ul class="top-list">
              <li v-for="(item, index) in topList(categoryStats.topLevel3)" :key="item.name">
                <span class="top-rank">{{ index + 1 }}</span>
                <b>{{ item.name }}</b>
                <span>{{ formatNumber(item.value) }} · {{ formatPercent(item.share) }}</span>
              </li>
            </ul>
          </section>
          <section class="detail-block ranking-block">
            <h3>Top 药物</h3>
            <ul class="top-list">
              <li v-for="(item, index) in topList(categoryStats.topDrug)" :key="item.name">
                <span class="top-rank">{{ index + 1 }}</span>
                <b>{{ item.name }}</b>
                <span>{{ formatNumber(item.value) }} · {{ formatPercent(item.share) }}</span>
              </li>
            </ul>
          </section>
          <section class="detail-block ranking-block">
            <h3>Top 生物标记物</h3>
            <ul class="top-list">
              <li v-for="(item, index) in topList(categoryStats.topBiomarker)" :key="item.name">
                <span class="top-rank">{{ index + 1 }}</span>
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
            <h3>
              {{ shownDetailPaths[0]?.mappingLevel === 'Level2' ? '聚合跨层路径' : '聚合五层路径' }}
            </h3>
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
                <dt>聚合路径</dt>
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
              <button
                v-if="isRelationPieChartable(section)"
                type="button"
                @click="openPieModal(section.id)"
              >
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
              <div
                class="drug-share-chart-shell"
                :style="relationPieChartShellStyle(section, false)"
              >
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
                <ul class="relation-pie-legend" aria-label="颜色图例">
                  <li
                    v-for="item in section.items"
                    :key="item.name"
                    :class="{ 'other-relation-item': item.isOther }"
                    :title="item.name"
                    tabindex="0"
                    @mouseenter="handleRelationItemMouseOver(section, item)"
                    @mouseleave="scheduleRestoreHighlight"
                    @focus="handleRelationItemMouseOver(section, item)"
                    @blur="scheduleRestoreHighlight"
                  >
                    <i :style="{ backgroundColor: item.itemStyle.color }" aria-hidden="true"></i>
                    <span>{{ item.name }}</span>
                    <span class="visually-hidden">
                      权重 {{ formatNumber(item.value) }}，占比 {{ formatPercent(item.share) }}
                    </span>
                  </li>
                </ul>
              </div>
            </template>
          </section>
        </template>
      </aside>
    </section>

    <div
      v-if="pieModalOpen && activePieSection"
      class="pie-modal-backdrop"
      role="presentation"
      @click.self="closePieModal"
    >
      <section
        class="pie-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="`${activePieSection.title}放大查看`"
      >
        <header>
          <div>
            <h2>{{ activePieSection.title }}</h2>
            <p>{{ detail.kind === 'node' ? detail.title : selectedCategoryLabel }}</p>
          </div>
          <button type="button" aria-label="关闭放大查看" @click="closePieModal">关闭</button>
        </header>
        <div class="pie-modal-body">
          <div
            class="pie-modal-chart-shell"
            :style="relationPieChartShellStyle(activePieSection, true)"
          >
            <div
              ref="modalPieChartEl"
              class="pie-modal-chart"
              :aria-label="`${activePieSection.ariaLabel}放大图`"
            ></div>
            <div class="pie-modal-center" aria-hidden="true">
              <strong>{{ activePieSection.sourceItemCount }}</strong>
              <span>{{ activePieSection.centerLabel }}</span>
              <em v-if="activePieSection.isCollapsed">Top {{ TOP_RELATION_PIE_ITEMS }} + 其他</em>
              <em v-else>{{ formatNumber(activePieSection.totalWeight) }} 权重</em>
            </div>
            <ul class="relation-pie-legend pie-modal-legend" aria-label="颜色图例">
              <li
                v-for="item in activePieSection.items"
                :key="item.name"
                :class="{ 'other-relation-item': item.isOther }"
                :title="item.name"
                tabindex="0"
                @mouseenter="handleRelationItemMouseOver(activePieSection, item)"
                @mouseleave="scheduleRestoreHighlight"
                @focus="handleRelationItemMouseOver(activePieSection, item)"
                @blur="scheduleRestoreHighlight"
              >
                <i :style="{ backgroundColor: item.itemStyle.color }" aria-hidden="true"></i>
                <span>{{ item.name }}</span>
                <span class="visually-hidden">
                  权重 {{ formatNumber(item.value) }}，占比 {{ formatPercent(item.share) }}
                </span>
              </li>
            </ul>
          </div>
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
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 92px;
  padding: 18px 16px;
  color: #526c7c;
  font-size: 14px;
  font-weight: 800;
  text-align: center;
}

.error-state {
  color: #a33b36;
}

.state-message button {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid currentColor;
  border-radius: 2px;
  color: inherit;
  background: #fff;
  font: inherit;
  cursor: pointer;
}

.state-message button:hover,
.state-message button:focus-visible {
  background: #f1f4f3;
  outline: 2px solid rgba(63, 119, 122, 0.2);
  outline-offset: 1px;
}

.loading-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(63, 119, 122, 0.22);
  border-top-color: #3f777a;
  border-radius: 50%;
  animation: sankey-loading-spin 0.8s linear infinite;
}

@keyframes sankey-loading-spin {
  to {
    transform: rotate(360deg);
  }
}

.sankey-controls :disabled,
.location-search :disabled {
  cursor: not-allowed;
  opacity: 0.56;
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
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(241, 249, 250, 0.9)), #ffffff;
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
    linear-gradient(
      90deg,
      rgba(235, 248, 246, 0.96),
      rgba(255, 255, 255, 0.98) 42%,
      rgba(244, 249, 251, 0.96)
    ),
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
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(240, 248, 250, 0.9)), #ffffff;
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
    linear-gradient(120deg, #eaf7f4, #f8fbfd 43%, #edf4fb), #f4f8f8;
}

.sankey-map-header.site-header {
  position: sticky;
  top: 0;
  z-index: 30;
  border-bottom: 1px solid rgba(96, 124, 143, 0.16);
  background:
    linear-gradient(
      90deg,
      rgba(236, 249, 246, 0.97),
      rgba(255, 255, 255, 0.98) 46%,
      rgba(239, 247, 251, 0.97)
    ),
    #ffffff;
  box-shadow: 0 10px 30px rgba(21, 52, 72, 0.08);
  opacity: var(--header-opacity, 1);
  transition:
    opacity 0.45s ease,
    box-shadow 0.45s ease;
  will-change: opacity;
}

.sankey-map-header.is-hidden {
  pointer-events: none;
  box-shadow: none;
}

@media (prefers-reduced-motion: reduce) {
  .sankey-map-header.site-header {
    transition: none;
  }
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
    linear-gradient(
      90deg,
      rgba(241, 250, 248, 0.92),
      rgba(252, 253, 252, 0.96) 48%,
      rgba(242, 248, 253, 0.92)
    ),
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
  display: grid;
  place-items: center;
  min-width: 76px;
  transform: translate(-50%, -50%);
  pointer-events: none;
  text-align: center;
}

.drug-share-center {
  inset: 35% auto auto 50%;
}

.pie-modal-center {
  inset: 46% auto auto 40%;
}

.relation-pie-legend {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 2;
  display: grid;
  width: min(124px, 38%);
  grid-template-columns: minmax(0, 1fr);
  row-gap: 3px;
  margin: 0;
  padding: 5px 6px;
  border: 1px solid #cfdae5;
  border-radius: 4px;
  background: #edf3f8;
  list-style: none;
}

.relation-pie-legend li {
  display: grid;
  min-width: 0;
  grid-template-columns: 8px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  min-height: 15px;
  color: #4c5967;
  cursor: default;
  font-size: 10px;
  line-height: 1.2;
}

.relation-pie-legend li:focus-visible {
  border-radius: 2px;
  outline: 1px solid #5b83b0;
  outline-offset: 2px;
}

.relation-pie-legend i {
  width: 8px;
  height: 8px;
  border-radius: 1px;
}

.relation-pie-legend li.other-relation-item i {
  border-radius: 50%;
}

.relation-pie-legend li > span:not(.visually-hidden) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
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
    linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(240, 248, 250, 0.88)), #ffffff;
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
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--relation-color), transparent 78%),
    transparent
  );
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
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--relation-color), transparent 82%),
    transparent
  );
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
    linear-gradient(180deg, rgba(252, 254, 255, 0.98), rgba(244, 250, 252, 0.96)), #ffffff;
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
  display: block;
  padding: 18px 20px 20px;
}

.pie-modal-chart-shell {
  min-height: var(--relation-pie-shell-height, 430px);
  height: var(--relation-pie-shell-height, 430px);
  border-radius: 10px;
}

.pie-modal-chart {
  width: 100%;
  height: 100%;
}

.pie-modal-center strong {
  font-size: 28px;
}

.pie-modal-center span {
  font-size: 12px;
}

.pie-modal-legend {
  right: 16px;
  bottom: 16px;
  width: 180px;
  row-gap: 5px;
  padding: 7px 8px;
}

.pie-modal-legend li {
  grid-template-columns: 10px minmax(0, 1fr);
  gap: 7px;
  min-height: 18px;
  font-size: 12px;
}

.pie-modal-legend i {
  width: 10px;
  height: 10px;
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
  font-family:
    Microsoft YaHei,
    Noto Sans CJK SC,
    Source Han Sans CN,
    SimHei,
    Arial,
    sans-serif;
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

:global(.sankey-tip__taxonomy) {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  margin-top: 5px;
  color: #6a808b;
  font-size: 10px;
  font-weight: 500;
}

:global(.sankey-tip__taxonomy strong) {
  overflow: hidden;
  color: #36566a;
  font-weight: 600;
  text-align: right;
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
  transition:
    color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease;
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
  left: calc(var(--series-left) - 10px);
  width: 42px;
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
  background: linear-gradient(
    90deg,
    var(--sankey-teal),
    rgba(50, 111, 180, 0.78),
    rgba(199, 121, 32, 0.55)
  );
}

.side-panel::before {
  background: linear-gradient(
    90deg,
    rgba(50, 111, 180, 0.76),
    rgba(138, 111, 197, 0.64),
    rgba(22, 133, 124, 0.48)
  );
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
  box-shadow:
    0 18px 45px rgba(23, 50, 71, 0.08),
    0 0 0 2px rgba(11, 102, 112, 0.06);
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
  overflow: hidden;
  padding: 7px 0 0;
  border-bottom: 1px solid rgba(105, 127, 140, 0.08);
  background:
    linear-gradient(180deg, rgba(250, 255, 254, 0.98), rgba(248, 253, 252, 0.92)),
    var(--sankey-chart-bg);
}

.stage-axis-canvas {
  width: 100%;
  box-sizing: border-box;
  padding: 0 var(--series-right) 0 var(--series-left);
  will-change: transform;
}

.stage-axis-track {
  position: relative;
  min-height: 26px;
}

.stage-axis-track::before,
.stage-axis-track::after {
  display: none;
}

.stage-axis-track span {
  position: absolute;
  top: 0;
  width: clamp(112px, 19%, 210px);
  min-width: 0;
  box-sizing: border-box;
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
  transform: translateX(-50%);
}

.stage-axis-track span::after {
  display: none;
}

.upstream-context {
  width: 100%;
  box-sizing: border-box;
  margin: 0 0 12px;
  padding: 10px 11px;
  border: 1px solid rgba(91, 125, 137, 0.2);
  border-left: 3px solid rgba(113, 133, 179, 0.72);
  border-radius: 7px;
  background: rgba(245, 250, 252, 0.96);
  pointer-events: none;
}

.upstream-context.is-visible {
  animation: upstream-context-enter 0.18s ease both;
}

@keyframes upstream-context-enter {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.upstream-context header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  padding-bottom: 7px;
  border-bottom: 1px solid rgba(105, 127, 140, 0.11);
}

.upstream-context header span {
  color: #6a808b;
  font-size: 10px;
  font-weight: 900;
  white-space: nowrap;
}

.upstream-context header strong,
.upstream-context dd {
  min-width: 0;
  overflow: hidden;
  color: #173247;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upstream-context header strong {
  font-size: 12px;
  font-weight: 950;
}

.upstream-context dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 6px 8px;
  margin: 8px 0 0;
}

.upstream-context dt {
  color: #718792;
  font-size: 10px;
  font-weight: 900;
}

.upstream-context dd {
  margin: 0;
  font-size: 11px;
  font-weight: 900;
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
    padding: 9px 0 7px;
  }

  .stage-axis-canvas {
    width: var(--chart-min-width);
    min-width: var(--chart-min-width);
    padding-right: var(--series-right);
    padding-left: var(--series-left);
  }

  .stage-axis-track span {
    width: 118px;
    min-height: 28px;
    padding: 4px 3px;
    border: 1px solid rgba(105, 127, 140, 0.12);
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.72);
    font-size: 10px;
    line-height: 1.15;
    white-space: nowrap;
  }

  .sankey-chart-shell {
    min-width: var(--chart-min-width);
  }

  .upstream-context {
    width: 100%;
    margin: 0 0 10px;
    padding: 8px 9px;
  }

  .upstream-context header {
    padding-bottom: 6px;
  }

  .upstream-context dl {
    grid-template-columns: repeat(3, auto minmax(0, 1fr));
    gap: 4px 6px;
    margin-top: 6px;
  }

  .stats-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* Visual language shared with the core-marker analysis module. */
.sankey-shell {
  --sankey-ink: #17212b;
  --sankey-muted: #667382;
  --sankey-border: #d7dee6;
  --sankey-line-strong: #aeb9c6;
  --sankey-blue: #2566d4;
  --sankey-blue-soft: #eaf1ff;
  --sankey-teal: #16845b;
  color: var(--sankey-ink);
  background: #eef3f6;
  font-family: Inter, 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif;
}

.sankey-map-header.site-header {
  min-height: 72px;
  padding-top: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(96, 124, 143, 0.24);
  background: #ffffff;
  box-shadow: 0 8px 28px rgba(21, 52, 72, 0.08);
  backdrop-filter: none;
}

.brand-logo {
  border-color: #386f73;
  border-radius: 2px;
  background: #386f73;
  box-shadow: none;
}

.brand strong,
.page-title,
.module-switch-link strong {
  font-weight: 800;
}

.brand small {
  color: #697d8a;
  font-weight: 400;
}

.page-title {
  padding-left: 11px;
  border-left-width: 3px;
  border-left-color: var(--sankey-teal);
  color: #173247;
  font-size: 20px;
}

.location-search input,
.location-search > button,
.module-switch-link {
  border: 1px solid var(--sankey-border);
  border-radius: 6px;
  background: #ffffff;
  box-shadow: none;
}

.location-search input {
  height: 38px;
  color: var(--sankey-ink);
  font-weight: 400;
}

.location-search input:focus,
.location-search > button:focus-visible,
.module-switch-link:focus-visible {
  border-color: #5f84b3;
  outline: 2px solid rgba(37, 102, 212, 0.12);
  outline-offset: 1px;
  box-shadow: none;
}

.module-switch-link {
  min-height: 38px;
  color: #385466;
  background: #f8fbfc;
}

.module-switch-link span {
  color: #697d8a;
  font-weight: 600;
}

.module-switch-link:hover {
  border-color: rgba(14, 143, 119, 0.48);
  background: #eef8f6;
  box-shadow: none;
}

.sankey-controls {
  grid-template-columns:
    minmax(320px, 560px)
    150px
    minmax(190px, 260px)
    108px
    minmax(298px, 1fr);
  align-items: end;
  gap: 8px;
  padding-top: 8px;
  padding-bottom: 7px;
  border-bottom: 1px solid var(--sankey-border);
  background: #ffffff;
  box-shadow: 0 4px 14px rgba(21, 52, 72, 0.04);
}

.sankey-controls .control-field,
.scope-field {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: stretch;
  gap: 4px;
}

.sankey-controls .control-field > span,
.scope-field legend {
  min-height: 13px;
  color: #637487;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.15;
}

.control-field select,
.control-field input,
.sankey-controls button,
.top-toggle,
.scope-segmented {
  border: 1px solid #b8c3ce;
  border-radius: 6px;
  color: var(--sankey-ink);
  background: #ffffff;
  box-shadow: none;
}

.control-field select,
.control-field input,
.sankey-controls button {
  font-weight: 650;
}

.scope-segmented {
  padding: 2px;
  background: #f3f6f8;
}

.scope-segmented span {
  border-radius: 4px;
  color: #566575;
  font-weight: 650;
}

.scope-segmented input:checked + span {
  color: var(--sankey-blue);
  background: var(--sankey-blue-soft);
  box-shadow: none;
  outline: 1px solid rgba(37, 102, 212, 0.24);
}

.control-field select:focus,
.control-field input:focus,
.sankey-controls button:focus-visible,
.scope-segmented input:focus-visible + span {
  border-color: #5f84b3;
  outline: 2px solid rgba(37, 102, 212, 0.14);
  outline-offset: 1px;
  box-shadow: none;
}

.sankey-controls .control-button {
  min-width: 78px;
  font-weight: 700;
  white-space: nowrap;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background 0.15s ease;
}

.sankey-controls .clear-lock-button {
  min-width: 96px;
}

.sankey-controls .export-button {
  min-width: 100px;
}

.toolbar-actions {
  display: flex;
  align-items: end;
  justify-content: flex-end;
  gap: 6px;
  padding-left: 12px;
  border-left: 1px solid var(--sankey-border);
}

.sankey-controls .reset-button,
.sankey-controls .clear-lock-button {
  border-color: var(--sankey-line-strong);
  color: #3e566b;
  background: #ffffff;
}

.sankey-controls .reset-button:hover,
.sankey-controls .reset-button:focus-visible,
.sankey-controls .clear-lock-button:hover,
.sankey-controls .clear-lock-button:focus-visible {
  border-color: #6f879c;
  color: #203a51;
  background: #f3f6f8;
  box-shadow: none;
  transform: none;
}

.sankey-shell:has(.lock-bar.has-lock) .clear-lock-button {
  border-color: rgba(22, 132, 91, 0.55);
  color: #116c4d;
}

.sankey-shell:has(.lock-bar.has-lock) .clear-lock-button:hover,
.sankey-shell:has(.lock-bar.has-lock) .clear-lock-button:focus-visible {
  border-color: var(--sankey-teal);
  color: #0d5d42;
  background: #eef8f4;
}

.sankey-controls .export-button,
.sankey-controls .export-button:hover,
.sankey-controls .export-button:focus-visible {
  border-color: var(--sankey-blue) !important;
  color: #ffffff !important;
  background: var(--sankey-blue) !important;
  box-shadow: none;
  transform: none;
}

.sankey-controls .export-button:hover,
.sankey-controls .export-button:focus-visible {
  border-color: #1f56b5 !important;
  background: #1f56b5 !important;
}

.sankey-main {
  gap: 12px;
  background: #eef3f6;
}

.chart-panel,
.side-panel {
  border: 1px solid var(--sankey-border);
  border-radius: 6px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(21, 52, 72, 0.06);
}

.chart-panel::before,
.side-panel::before {
  display: none;
}

.chart-panel {
  background: #ffffff;
}

.side-panel,
.side-panel.has-selection {
  border-color: var(--sankey-border);
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(21, 52, 72, 0.06);
}

.side-panel.has-selection {
  border-color: rgba(22, 132, 91, 0.42);
  box-shadow:
    0 8px 24px rgba(21, 52, 72, 0.06),
    0 0 0 1px rgba(22, 132, 91, 0.08);
}

.lock-bar,
.lock-bar.has-lock {
  min-height: 34px;
  border-bottom: 1px solid #dce1e2;
  border-left: 2px solid transparent;
  color: #5d6a70;
  background: #ffffff;
  box-shadow: none;
}

.lock-bar.has-lock {
  border-left-color: var(--sankey-teal);
  background: #eef8f4;
}

.lock-bar strong,
.lock-bar.has-lock strong {
  color: #173247;
  font-weight: 750;
}

.filter-summary {
  min-height: 0;
  display: inline;
  padding: 0;
  border: 0;
  border-radius: 0;
  color: #53666d !important;
  background: transparent;
  font-weight: 500;
}

.filter-summary::before {
  margin-right: 7px;
  color: #899699;
  content: '·';
}

.stage-axis {
  padding-top: 6px;
  border-bottom: 1px solid #dce1e2;
  background: #ffffff;
}

.stage-axis-track {
  min-height: 32px;
}

.stage-axis-track span {
  min-height: 30px;
  padding: 5px;
  border: 0;
  border-radius: 0;
  color: #344657;
  background: transparent;
  font-size: 14px;
  font-weight: 750;
  line-height: 1.2;
  text-shadow: none;
}

.sankey-chart,
.sankey-chart-shell {
  background: #ffffff;
}

.level1-column-rail {
  border-color: #e3e9ee;
  border-radius: 4px;
  background: #f8fafc;
}

.overview-header {
  border-bottom-color: #dce1e2;
}

.side-panel h2,
.side-panel h3,
.side-panel strong,
.side-panel b {
  color: #173247;
  font-weight: 750;
}

.detail-block {
  border-top-color: #dce1e2;
}

.detail-block p,
.path-row span,
.path-note,
.top-list li {
  color: var(--sankey-muted);
  font-weight: 400;
}

.stats-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  padding: 1px;
  border: 1px solid var(--sankey-border);
  border-radius: 5px;
  background: var(--sankey-border);
}

.stats-summary span {
  min-width: 0;
  justify-content: space-between;
  padding: 7px 8px;
  border: 0;
  border-radius: 0;
  color: var(--sankey-muted);
  background: #ffffff;
  font-weight: 400;
  text-align: left;
}

.stats-summary b {
  color: var(--sankey-muted);
  font-weight: 600;
}

.stats-summary strong {
  color: #173247;
  font-weight: 800;
}

.upstream-context,
.node-summary-block,
.single-path-card,
.relation-empty-card,
.single-relation-card,
.single-relation-card dl div,
.relation-share-list li,
.drug-share-chart-shell,
.pie-modal-chart-shell,
.pie-modal-list li,
.compact-detail .detail-kv div {
  border: 1px solid var(--sankey-border);
  border-radius: 5px;
  background: #ffffff;
  box-shadow: none;
}

.upstream-context {
  border-left: 2px solid #6f898c;
}

.compact-detail .detail-kv div {
  padding: 5px 7px;
}

.detail-kv dt,
.detail-kv dd,
.single-path-card strong,
.single-path-card footer,
.single-path-steps strong,
.single-relation-main span,
.single-relation-main strong,
.single-relation-main em,
.single-relation-card dt,
.single-relation-card dd,
.relation-empty-card strong,
.relation-empty-card span {
  font-weight: 500;
}

.detail-kv dd,
.single-path-card strong,
.single-relation-main strong,
.single-relation-card dd,
.relation-empty-card strong {
  font-weight: 700;
}

.single-path-steps span {
  border: 1px solid #b9cceb;
  border-radius: 4px;
  color: #24558d;
  background: #eef4ff;
  font-weight: 650;
}

.path-row button,
.drug-share-heading button,
.pie-modal header button {
  border: 1px solid #8aa9cf;
  border-radius: 5px;
  color: #24558d;
  background: #ffffff;
  box-shadow: none;
  font-weight: 700;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background 0.15s ease;
}

.path-row button:hover,
.path-row button:focus-visible,
.drug-share-heading button:hover,
.drug-share-heading button:focus-visible,
.pie-modal header button:hover,
.pie-modal header button:focus-visible {
  border-color: var(--sankey-blue);
  color: #1f56b5;
  background: #eef4ff;
  box-shadow: none;
  transform: none;
}

.drug-share-list i,
.pie-modal-list i {
  border-radius: 1px;
  box-shadow: none;
}

.single-relation-card::before,
.relation-share-list li::before {
  width: 3px;
  min-width: 0;
  background: var(--relation-color);
}

.single-relation-card > i {
  border-radius: 0;
  box-shadow: none;
}

.pie-modal-backdrop {
  background: rgba(18, 32, 39, 0.42);
  backdrop-filter: none;
}

.pie-modal {
  border: 1px solid var(--sankey-line-strong);
  border-radius: 6px;
  background: #ffffff;
  box-shadow: 0 18px 48px rgba(21, 52, 72, 0.18);
}

.pie-modal-chart-shell {
  border-radius: 5px;
}

.drug-share-center span,
.pie-modal-center span,
.drug-share-center em,
.pie-modal-center em,
.drug-share-list span,
.pie-modal-list span,
.pie-modal-list strong {
  font-weight: 500;
}

.drug-share-center strong,
.pie-modal-center strong {
  font-weight: 700;
}

:global(.sankey-tip) {
  color: #27333f;
  font-family: Inter, 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif;
}

:global(.sankey-tip__eyebrow),
:global(.sankey-tip__title),
:global(.sankey-tip__type),
:global(.sankey-tip__metrics span),
:global(.sankey-tip__metrics small),
:global(.sankey-tip__metrics strong),
:global(.sankey-tip__color),
:global(.sankey-tip__taxonomy),
:global(.sankey-tip__note),
:global(.sankey-tip__node-main > span),
:global(.sankey-tip__node-main > strong),
:global(.sankey-tip__node-main b),
:global(.sankey-tip__node-main small) {
  font-weight: 500;
}

:global(.sankey-tip__title),
:global(.sankey-tip__metrics strong),
:global(.sankey-tip__node-main > strong),
:global(.sankey-tip__node-main b) {
  font-weight: 700;
}

:global(.sankey-tip__type),
:global(.sankey-tip__metrics > div),
:global(.sankey-tip__note),
:global(.sankey-tip__node-main > span) {
  border-radius: 4px;
}

.state-message button {
  border: 1px solid var(--sankey-blue);
  border-radius: 5px;
  color: #ffffff;
  background: var(--sankey-blue);
  font-weight: 700;
}

.state-message button:hover,
.state-message button:focus-visible {
  border-color: #1f56b5;
  color: #ffffff;
  background: #1f56b5;
  outline: 2px solid rgba(37, 102, 212, 0.14);
  outline-offset: 2px;
}

.sankey-controls :disabled,
.location-search :disabled {
  border-color: #d7dee6 !important;
  color: #8a96a3 !important;
  background: #f3f5f7 !important;
  box-shadow: none !important;
  opacity: 0.72;
}

/* Research-sidebar information hierarchy. */
.overview-header {
  margin-bottom: 16px;
  padding-bottom: 16px;
}

.overview-header h2 {
  margin-bottom: 12px;
  font-size: 21px;
  line-height: 1.25;
}

.stats-summary span {
  min-height: 48px;
  display: grid;
  align-content: center;
  justify-content: stretch;
  gap: 3px;
  padding: 7px 9px;
}

.stats-summary span:nth-child(-n + 3) {
  background: #f8fafc;
}

.stats-summary b {
  overflow: hidden;
  font-size: 11px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stats-summary strong {
  justify-self: start;
  font-size: 15px;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
}

.legend-block h3,
.ranking-block h3 {
  margin-bottom: 10px;
  font-size: 15px;
}

.legend-list {
  display: grid;
  margin: 0;
}

.legend-list div {
  display: grid;
  grid-template-columns: 86px minmax(0, 1fr);
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid #edf1f4;
}

.legend-list div:last-child {
  border-bottom: 0;
}

.legend-list dt,
.legend-list dd {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
}

.legend-list dt {
  color: #344657;
  font-weight: 700;
}

.legend-list dd {
  color: var(--sankey-muted);
  font-weight: 400;
}

.top-list {
  gap: 0;
}

.top-list li {
  grid-template-columns: 20px minmax(0, 1fr) auto;
  gap: 7px;
  min-height: 34px;
  padding: 6px 0;
  border-bottom: 1px solid #edf1f4;
  font-size: 12px;
}

.top-list li:last-child {
  border-bottom: 0;
}

.top-list .top-rank {
  color: #8a969a;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.top-list b {
  color: #344657;
  font-weight: 700;
}

.top-list li > span:last-child {
  color: var(--sankey-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.compact-detail .node-summary-block {
  padding: 0 0 14px;
  border: 0;
  border-bottom: 1px solid #dce1e2;
  border-radius: 0;
  background: transparent;
}

.compact-detail .node-summary-block h3 {
  margin-bottom: 10px;
  font-size: 18px;
}

.compact-detail .node-summary-block .detail-kv {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  border-top: 1px solid #dce1e2;
  border-bottom: 1px solid #dce1e2;
}

.compact-detail .node-summary-block .detail-kv div {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: center;
  align-items: start;
  gap: 3px;
  padding: 8px 10px;
  border: 0;
  border-right: 1px solid #dce1e2;
  border-radius: 0;
  background: #f8fafc;
}

.compact-detail .node-summary-block .detail-kv div:last-child {
  border-right: 0;
}

.compact-detail .node-summary-block .detail-kv dt {
  color: var(--sankey-muted);
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
}

.compact-detail .node-summary-block .detail-kv dd {
  color: #344657;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
}

.compact-detail .drug-share-block {
  padding-top: 14px;
}

.drug-share-heading {
  margin-bottom: 6px;
}

.compact-detail .drug-share-heading h3 {
  font-size: 16px;
}

.drug-share-chart-shell {
  height: var(--relation-pie-shell-height, 300px);
  margin: 10px 0 0;
  border: 0;
  border-top: 1px solid #e1e5e6;
  border-bottom: 1px solid #e1e5e6;
  border-radius: 0;
  background: #f8fafc;
}

.drug-share-list {
  gap: 0;
  margin-top: 0;
}

.relation-share-list li {
  min-height: 40px;
  padding: 9px 4px;
  border: 0;
  border-bottom: 1px solid #e1e5e6;
  border-radius: 0;
  background: transparent;
}

.relation-share-list li::before {
  display: none;
}

.relation-share-list li:hover,
.relation-share-list li:focus-within {
  border-color: #e1e5e6;
  background: #f5f8fb;
}

.drug-share-list i {
  width: 8px;
  height: 8px;
}

.drug-share-list b {
  color: #344657;
  font-weight: 700;
}

.drug-share-list span {
  color: var(--sankey-muted);
  font-variant-numeric: tabular-nums;
}

.single-relation-card {
  padding: 12px 4px;
  border: 0;
  border-top: 1px solid #e1e5e6;
  border-bottom: 1px solid #e1e5e6;
  border-radius: 0;
  background: #f8fafc;
}

.single-relation-card dl div {
  padding: 6px 8px;
  border: 0;
  border-left: 1px solid #dce1e2;
  border-radius: 0;
  background: transparent;
}

@media (max-width: 720px) {
  .relation-pie-legend {
    right: 7px;
    bottom: 7px;
    width: min(124px, 42%);
    row-gap: 2px;
    padding: 4px 5px;
  }

  .relation-pie-legend li {
    grid-template-columns: 7px minmax(0, 1fr);
    gap: 5px;
    min-height: 12px;
    font-size: 9px;
  }

  .relation-pie-legend i {
    width: 7px;
    height: 7px;
  }

  .pie-modal-backdrop {
    padding: 12px;
  }

  .pie-modal-body {
    padding: 12px;
  }

  .pie-modal-chart-shell {
    min-height: var(--relation-pie-shell-height, 430px);
    height: var(--relation-pie-shell-height, 430px);
  }

  .pie-modal-chart {
    min-height: 0;
    height: 100%;
  }

  .pie-modal-legend {
    right: 10px;
    bottom: 10px;
    width: min(132px, 42%);
  }

  .drug-share-center {
    inset: 34% auto auto 50%;
  }

  .pie-modal-center {
    inset: 40% auto auto 50%;
  }

  .stage-axis-track {
    min-height: 30px;
  }

  .stage-axis-track span {
    min-height: 28px;
    padding: 4px 3px;
    border-radius: 5px;
    font-size: 12px;
    line-height: 1.15;
  }

  .upstream-context {
    border-radius: 5px;
  }

  .stats-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .sankey-controls {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .level-field,
  .display-field,
  .toolbar-actions {
    grid-column: 1 / -1;
  }

  .compact-field {
    max-width: none;
  }

  .toolbar-actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    padding-top: 7px;
    padding-left: 0;
    border-top: 1px solid var(--sankey-border);
    border-left: 0;
  }
}

@media (min-width: 721px) and (max-width: 1180px) {
  .sankey-controls {
    grid-template-columns:
      minmax(260px, 1fr)
      minmax(150px, 180px)
      minmax(180px, 0.8fr)
      minmax(96px, 120px);
  }

  .toolbar-actions {
    grid-column: 1 / -1;
    justify-self: end;
    padding-top: 7px;
    padding-left: 0;
    border-top: 1px solid var(--sankey-border);
    border-left: 0;
  }
}
</style>
