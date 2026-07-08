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
  relationPieSectionsForNode,
  sankeyHoverTargetKey,
  sortSankeyPaths,
  type RelationPieSection as BaseRelationPieSection,
  type RelationShareItem,
  type Icd11SankeyDisplayMode,
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

type RelationPieDatum = RelationShareItem & {
  sectionId: string
  itemStyle: {
    color: string
  }
}

type RelationPieSection = Omit<BaseRelationPieSection, 'items'> & {
  items: RelationPieDatum[]
  totalWeight: number
}

const KIND_LABELS: Record<Icd11SankeyNode['kind'], string> = {
  level1: 'ICD11_Level1',
  level2: 'ICD11_Level2',
  drug: '药物',
  biomarker: '生物标记物',
}
const DISPLAY_MODE_OPTIONS: { value: Icd11SankeyDisplayMode; label: string }[] = [
  { value: 'smart', label: '智能精简' },
  { value: 'all', label: '全量' },
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
const STAGE_TITLES = ['ICD11_Level1', 'ICD11_Level2', '药物', '生物标记物']
const SERIES_LEFT = 68
const SERIES_RIGHT = 68
const SERIES_TOP = 14
const SERIES_BOTTOM = 112
const HEADER_HEIGHT = 70
const HEADER_FADE_DISTANCE = 190
const HOVER_INTENT_DELAY = 85
const HOVER_RESTORE_DELAY = 110
const LEVEL1_FALLBACK_COLORS = [
  '#416FB8',
  '#2B9D91',
  '#D98C42',
  '#8A6FC5',
  '#C95F6C',
  '#689E55',
  '#4B8EA1',
  '#B96D43',
  '#5C7EBA',
  '#B05D8A',
  '#798E43',
  '#5F76A8',
]
const PIE_COLORS = ['#326FB4', '#16857C', '#D98C42', '#8A6FC5', '#C95F6C', '#689E55', '#4B8EA1', '#B05D8A']

use([SankeyChart, PieChart, TooltipComponent, CanvasRenderer])

const chartEl = ref<HTMLElement | null>(null)
const modalPieChartEl = ref<HTMLElement | null>(null)
const categories = ref<string[]>([])
const currentCategory = ref('')
const graph = ref<Icd11SankeyGraph | null>(null)
const activeBaseGraph = ref<Icd11SankeyGraph | null>(null)
const renderedGraph = ref<Icd11SankeyGraph | null>(null)
const isLoading = ref(false)
const errorMessage = ref('')
const searchQuery = ref('')
const displayMode = ref<Icd11SankeyDisplayMode>('smart')
const selectedLevel1 = ref('ALL')
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
    { label: '药物', value: formatNumber(stats.drug) },
    { label: '生物标记物', value: formatNumber(stats.biomarker) },
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
  return [...new Set(graph.value.paths.map((path) => path.level1))].sort((a, b) =>
    a.localeCompare(b, 'zh-Hans-CN'),
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
  return `${baseText} · 权重覆盖 ${formatPercent(summary.weightCoverage)} · ${summary.modeLabel}`
})
const relationPieSections = computed<RelationPieSection[]>(() => {
  if (detail.value.kind !== 'node') return []
  return relationPieSectionsForNode(detail.value.nodeKind, detail.value.paths)
    .map((section) => ({
      ...section,
      items: section.items.map((item, index) => ({
        ...item,
        sectionId: section.id,
        itemStyle: {
          color: PIE_COLORS[index % PIE_COLORS.length] ?? '#326FB4',
        },
      })),
      totalWeight: section.items.reduce((sum, item) => sum + Number(item.value || 0), 0),
    }))
    .filter((section) => section.items.length > 0)
})
const activePieSection = computed(
  () => relationPieSections.value.find((section) => section.id === activePieId.value) ?? null,
)

watch([searchQuery, displayMode, selectedLevel1, minWeight], () => {
  if (!graph.value) return
  clearLockedState()
  render()
})

watch(relationPieSections, async (sections) => {
  if (activePieId.value && !sections.some((section) => section.id === activePieId.value)) {
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
    categories.value = response.categories
    currentCategory.value = response.defaultCategory || response.categories[0] || ''
    if (currentCategory.value) {
      await loadGraph(currentCategory.value)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'ICD11 桑基图数据暂时不可用'
  } finally {
    isLoading.value = false
  }
}

async function loadSelectedCategory() {
  if (currentCategory.value) {
    await loadGraph(currentCategory.value)
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
  chart.on('click', handleChartClick)
  chart.on('mouseover', handleSankeyMouseOver)
  chart.on('mouseout', scheduleRestoreHighlight)
  chart.getZr().on('click', (event) => {
    if (!event.target) resetView()
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
        formatter(params: { dataType?: string; data: ChartNode | ChartLink }) {
          if (params.dataType === 'edge') {
            const link = params.data as ChartLink
            return `<b>${escapeHtml(link.edgeType)}</b><br>${escapeHtml(link.sourceLabel)} → ${escapeHtml(link.targetLabel)}<br>权重（涉及文献数）：${formatNumber(link.value)}<br>聚合路径数：${formatNumber(link.pathIds.length)}<br>颜色依据：${escapeHtml(link.level1)}`
          }
          const node = params.data as ChartNode
          return `<b>${escapeHtml(node.displayName)}</b><br>${escapeHtml(KIND_LABELS[node.kind])}<br>节点权重：${formatNumber(node.value)}`
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
          nodeWidth: 18,
          nodeGap: nodeGap(baseGraph),
          nodeAlign: 'justify',
          layoutIterations: 0,
          draggable: true,
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
            lineStyle: { opacity: 0.82 },
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
            opacity: 0.38,
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
    edgeType: string,
    pathId: string,
  ) {
    const key = `${source}@@${target}@@${edgeType}@@${level1}`
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
        sourceLabel,
        targetLabel,
        edgeType,
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
    const [level1Id, level2Id, drugId, biomarkerId] = path.nodeIds
    if (!level1Id || !level2Id || !drugId || !biomarkerId) continue
    for (const nodeName of path.nodeIds) addNodeWeight(nodeName, path.weight)
    addLink(level1Id, level2Id, path.weight, path.level1, 'ICD11_Level1 → ICD11_Level2', path.pathId)
    addLink(level2Id, drugId, path.weight, path.level1, 'ICD11_Level2 → 药物', path.pathId)
    addLink(drugId, biomarkerId, path.weight, path.level1, '药物 → 生物标记物', path.pathId)
  }

  const nodes = baseGraph.nodes
    .filter((node) => nodeWeights.has(node.name))
    .map((node) => ({ ...node, value: nodeWeights.get(node.name) ?? node.value }))
  const depthCounts = [0, 1, 2, 3].map(
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
    nodes: baseGraph.nodes.map((node) => chartNode(node, true)),
    links: baseGraph.links.map((link) => chartLink(link, true)),
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
    nodes: baseGraph.nodes.map((node) => chartNode(node, activeNodes.has(node.name))),
    links: baseGraph.links.map((link) =>
      chartLink(
        link,
        link.pathIds.some((pathId) => activePathIds.has(pathId)),
      ),
    ),
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

function chartNode(node: Icd11SankeyNode, active: boolean): ChartNode {
  const label = nodeLabel(node)
  const position = node.depth === 3 ? 'left' : 'right'
  return {
    ...node,
    itemStyle: {
      color: nodeDepthColor(node),
      opacity: active ? 1 : 0.46,
      borderColor: active ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.72)',
      borderWidth: 1.2,
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
      color: active ? '#173247' : 'rgba(23, 50, 71, 0.58)',
      width: label.width,
      lineHeight: label.lineHeight,
      overflow: 'truncate',
      align: position === 'right' ? 'left' : 'right',
      fontWeight: active ? 800 : 700,
      textBorderColor: active ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.66)',
      textBorderWidth: active ? 3 : 2,
    },
  }
}

function chartLink(link: Icd11SankeyLink, active: boolean): ChartLink {
  const color = level1DisplayColor(link.level1, link.color)
  return {
    ...link,
    lineStyle: {
      color: hexToRgba(color, active ? 0.42 : 0.18),
      opacity: active ? 0.84 : 0.28,
      curveness: 0.52,
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
    { width: 132, lineHeight: 18 },
    { width: 136, lineHeight: 18 },
    { width: 122, lineHeight: 18 },
    { width: 136, lineHeight: 18 },
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
  const depthMix = [0, 0.08, 0.17, 0.25][node.depth] ?? 0.16
  return mixHex(baseColor, '#ffffff', depthMix)
}

function sankeyLabelFontSize(baseGraph: Icd11SankeyGraph) {
  if (baseGraph.stats.maxNodes > 120 || baseGraph.paths.length > 200) return 10
  if (baseGraph.stats.maxNodes > 48 || baseGraph.paths.length > 90) return 11
  if (baseGraph.stats.maxNodes > 20) return 12
  return 13
}

function handleChartClick(params: unknown) {
  const event = params as { dataType?: string; data?: ChartNode | ChartLink }
  const baseGraph = activeBaseGraph.value
  if (!baseGraph || !event.data) return
  clearHoverPreview()
  if (event.dataType === 'node') {
    openDetailPanel()
    const node = event.data as ChartNode
    currentFocus.value = node.name
    lockedEdge.value = null
    lockedPathId.value = ''
    render(currentFocus.value)
    const paths = selectedPaths(baseGraph, pathIdsForNode(baseGraph, node.name))
    lockLabel.value = '当前锁定节点'
    lockText.value = node.displayName
    detail.value = {
      kind: 'node',
      title: node.displayName,
      level: KIND_LABELS[node.kind],
      nodeKind: node.kind,
      nodeWeight: node.value,
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
    title: '聚合四层路径',
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
  if (!section?.items.length || !element) {
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
        formatter(params: { data?: RelationPieDatum }) {
          const data = params.data
          if (!data) return ''
          return `<b>${escapeHtml(data.name)}</b><br>权重（涉及文献数）：${formatNumber(data.value)}<br>${escapeHtml(section.shareLabel)}：${formatPercent(data.share)}`
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
  displayMode.value = 'smart'
  selectedLevel1.value = 'ALL'
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
  displayMode.value = 'smart'
  selectedLevel1.value = 'ALL'
  minWeight.value = 0
  clearLockedState()
  detail.value = { kind: 'category' }
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
  const filteredPaths = sortSankeyPaths(
    baseGraph.paths.filter((path) => {
      const level1Matched = selectedLevel1.value === 'ALL' || path.level1 === selectedLevel1.value
      const weightMatched = minWeight.value <= 0 || path.weight >= minWeight.value
      return level1Matched && weightMatched
    }),
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
    modeLabel: displayModeLabel(displayMode.value, limit),
  }
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
  const perNode = dense ? 24 : medium ? 22 : 20
  const extraSpace = dense ? 780 : medium ? 500 : 400
  const maxHeight = dense ? 5200 : medium ? 3000 : 1800
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
  const density = Math.floor((availableHeight / maxNodes) * (dense ? 0.74 : medium ? 0.62 : 0.56))
  const minGap = dense ? 13 : medium ? 10 : 8
  const maxGap = dense ? 44 : medium ? 30 : 22
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
  return `${path.level1} → ${path.level2} → ${path.drug} → ${path.biomarker}`
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

function level1DisplayColor(level1: string, rawColor: string): string {
  const fallbackColor = fallbackLevel1Color(level1)
  const normalized = normalizeHexColor(rawColor)
  const baseColor = normalized || fallbackColor
  const hsl = rgbToHsl(hexToRgb(baseColor))
  if (!normalized || hsl.s < 0.32 || hsl.l > 0.72) return fallbackColor
  return hslToHex({
    h: hsl.h,
    s: Math.min(0.72, hsl.s + 0.14),
    l: Math.max(0.38, Math.min(0.55, hsl.l - 0.03)),
  })
}

function fallbackLevel1Color(level1: string): string {
  let hash = 0
  for (const char of String(level1 || 'level1')) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100000
  }
  return LEVEL1_FALLBACK_COLORS[hash % LEVEL1_FALLBACK_COLORS.length] ?? '#416FB8'
}

function normalizeHexColor(value: string) {
  const raw = String(value || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw
      .slice(1)
      .split('')
      .map((char) => `${char}${char}`)
      .join('')}`
  }
  return ''
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
  anchor.download = `${graph.value.category}_四层桑基图.png`
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
        <RouterLink class="login-button" to="/map-visualization">地图可视化</RouterLink>
      </div>
    </header>

    <form class="sankey-controls" @submit.prevent>
      <label class="control-field">
        <span>目标类别</span>
        <select v-model="currentCategory" :disabled="isLoading || !categories.length" @change="loadSelectedCategory">
          <option v-for="category in categories" :key="category" :value="category">
            {{ category }}
          </option>
        </select>
      </label>

      <label class="control-field display-field">
        <span>显示模式</span>
        <select v-model="displayMode">
          <option v-for="option in DISPLAY_MODE_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>

      <label class="control-field level-field">
        <span>ICD11_Level1</span>
        <select v-model="selectedLevel1">
          <option value="ALL">全部</option>
          <option v-for="level1 in level1Options" :key="level1" :value="level1">
            {{ level1 }}
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
        <div class="lock-bar" aria-live="polite">
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
        <div ref="chartEl" class="sankey-chart" :style="{ height: `${chartHeight}px` }"></div>
      </section>

      <aside
        class="side-panel"
        :class="{ 'compact-detail': isCompactDetail }"
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
            <p><b>颜色</b> 代表 ICD11_Level1；<b>带宽</b> 代表涉及文献数权重。</p>
            <p><b>节点层级</b>：ICD11_Level1 → ICD11_Level2 → 药物 → 生物标记物。</p>
            <p><b>聚合</b>：相同四层关系已合并，权重为涉及文献数之和。</p>
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
            <h3>聚合四层路径</h3>
            <div v-for="path in shownDetailPaths" :key="path.pathId" class="path-row">
              <p>{{ pathText(path) }}</p>
              <span>权重（涉及文献数）{{ formatNumber(path.weight) }} · 占比 {{ formatPercent(path.share) }}</span>
            </div>
          </section>
        </template>

        <template v-else-if="detail.kind === 'node'">
          <section class="detail-block">
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
              <button type="button" @click="openPieModal(section.id)">放大查看</button>
            </div>
            <p>{{ section.description }}</p>
            <div class="drug-share-chart-shell">
              <div
                :ref="(element) => setPieChartRef(section.id, element)"
                class="drug-share-chart"
                :aria-label="section.ariaLabel"
              ></div>
              <div class="drug-share-center" aria-hidden="true">
                <strong>{{ section.items.length }}</strong>
                <span>{{ section.centerLabel }}</span>
                <em>{{ formatNumber(section.totalWeight) }} 权重</em>
              </div>
            </div>
            <ul class="drug-share-list">
              <li v-for="item in section.items" :key="item.name">
                <i :style="{ backgroundColor: item.itemStyle.color }"></i>
                <b>{{ item.name }}</b>
                <span>{{ formatNumber(item.value) }} · {{ formatPercent(item.share) }}</span>
              </li>
            </ul>
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
              <strong>{{ activePieSection.items.length }}</strong>
              <span>{{ activePieSection.centerLabel }}</span>
              <em>{{ formatNumber(activePieSection.totalWeight) }} 权重</em>
            </div>
          </div>
          <ul class="pie-modal-list">
            <li v-for="item in activePieSection.items" :key="item.name">
              <i :style="{ backgroundColor: item.itemStyle.color }"></i>
              <b>{{ item.name }}</b>
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
  grid-template-columns: minmax(260px, 390px) minmax(220px, 320px) auto 110px auto auto auto;
  align-items: end;
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
  width: 42px;
  height: 42px;
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
  font-size: 16px;
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

.sankey-controls {
  grid-template-columns:
    minmax(260px, 1.15fr)
    minmax(150px, 0.52fr)
    minmax(240px, 0.9fr)
    minmax(96px, 0.34fr)
    auto
    auto
    auto;
  align-items: end;
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
  background:
    linear-gradient(180deg, rgba(250, 255, 254, 0.98), rgba(238, 249, 247, 0.88)),
    var(--sankey-chart-bg);
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

.lock-bar {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  padding: 12px 16px 10px;
}

.lock-bar > span {
  color: #5b7280;
}

.filter-summary {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 9px;
  border: 1px solid rgba(22, 133, 124, 0.24);
  border-radius: 999px;
  color: #175b65 !important;
  background: linear-gradient(180deg, rgba(232, 249, 246, 0.94), rgba(219, 242, 246, 0.78));
  font-size: 12px;
  font-weight: 900;
}

.stage-axis {
  width: 100%;
  box-sizing: border-box;
  padding: 12px var(--series-right) 0 var(--series-left);
}

.stage-axis-track {
  position: relative;
  height: 22px;
}

.stage-axis-track::before,
.stage-axis-track::after {
  display: none;
}

.stage-axis-track span {
  position: absolute;
  top: 0;
  padding: 0 2px;
  color: #102a3d;
  font-size: 17px;
  font-weight: 950;
  line-height: 1;
  text-align: center;
  text-shadow:
    0 1px 0 rgba(255, 255, 255, 0.86),
    0 6px 14px rgba(33, 63, 78, 0.08);
  white-space: nowrap;
}

.stage-axis-track span:nth-child(1) {
  left: 0;
  transform: translateX(-4%);
}

.stage-axis-track span:nth-child(2) {
  left: 34%;
  transform: translateX(-50%);
}

.stage-axis-track span:nth-child(3) {
  left: 67%;
  transform: translateX(-50%);
}

.stage-axis-track span:nth-child(4) {
  left: 100%;
  transform: translateX(-100%);
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
}
</style>
