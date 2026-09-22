<script setup lang="ts">
import { PieChart, SankeyChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { init, use, type ECharts } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import OperationGuide, { type OperationGuideStep } from '../components/OperationGuide.vue'
import PlatformHeader from '../components/PlatformHeader.vue'
import PrescriptionRatio from '../components/sankey/PrescriptionRatio.vue'
import SankeyMobileDrawer from '../components/sankey/SankeyMobileDrawer.vue'
import SankeyNodeSearch from '../components/sankey/SankeyNodeSearch.vue'
import SankeySelect, { type SankeySelectOption } from '../components/sankey/SankeySelect.vue'
import SankeyStageNavigator from '../components/sankey/SankeyStageNavigator.vue'
import { ApiTimeoutError } from '../services/api'
import { getUserErrorMessage } from '../services/errors'
import { fetchIcd11SankeyCategories, fetchIcd11SankeyGraph } from '../services/icd11Sankey'
import type {
  DrugPrescriptionStatus,
  Icd11SankeyGraph,
  Icd11SankeyLink,
  Icd11SankeyNode,
  Icd11SankeyPath,
} from '../types/icd11Sankey'
import {
  displayModeLimit,
  mergeSankeyHighlightPathIds,
  sankeyScopeCandidates,
  selectSankeyDisplayPaths,
  overviewPieSections,
  promoteConnectedSankeyNodes,
  summarizeDrugPrescriptions,
  relationPieSectionsForNode,
  resolveUpstreamPathIds,
  sankeyHoverTargetKey,
  collapseRelationShares,
  summarizeSankeyOverview,
  upstreamContext as summarizeUpstreamContext,
  upstreamLayerText,
  type RelationPieSection as BaseRelationPieSection,
  type RelationShareItem,
  type Icd11SankeyDisplayMode,
  type Level1Scope,
} from '../utils/icd11SankeyDisplay'
import {
  buildDynamicLevel2ColorMap,
  relationPieColor,
  SANKEY_LEVEL2_FALLBACK_COLOR,
  sankeyLevel2ColorKey,
} from '../utils/icd11SankeyColors'
import { icd11SankeyGraphIndex } from '../utils/icd11SankeyGraphIndex'
import {
  connectRoutingLinkToBridge,
  layoutRoutingBridgeLanes,
  orderSankeyRoutingNodes,
  raiseSankeyNodeLabelLayer,
  routingHorizontalBridgeBounds,
  sankeyLayoutMotionProgress,
  sankeyRouteNodeName,
  splitLevel2OnlyLinks,
} from '../utils/icd11SankeyRouting'
import {
  ensureSearchTargetVisible,
  pathsForSearchNode,
  representativeSearchPath,
  resolveSearchLevel1,
  searchSankeyNodes,
  type SankeyNodeSearchResult,
} from '../utils/icd11SankeySearch'

type DetailState =
  | { kind: 'category' }
  | {
      kind: 'paths'
      title: string
      paths: Icd11SankeyPath[]
      limit: number
      edge?: {
        source: string
        target: string
        sourceLabel: string
        targetLabel: string
        value: number
        sourceShare: number
        targetShare: number
        associatedNodeCount: number
        sourceKind: Icd11SankeyNode['kind']
        targetKind: Icd11SankeyNode['kind']
        drug?: {
          id: string
          name: string
          prescriptionStatus: DrugPrescriptionStatus
        }
      }
    }
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
  cursor?: 'pointer' | 'default'
  localY?: number | null
  focused?: boolean
  routing?: boolean
  routePathIds?: string[]
  routeSource?: string
  tooltip?: {
    show: boolean
  }
  itemStyle?: {
    color?: string
    opacity?: number
    borderColor?: string
    borderWidth?: number
    borderType?: 'solid' | 'dashed' | 'dotted'
    shadowBlur?: number
    shadowColor?: string
  }
  emphasis?: {
    itemStyle?: {
      color?: string
      opacity?: number
      borderColor?: string
      borderWidth?: number
      borderType?: 'solid' | 'dashed' | 'dotted'
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
    offset: [number, number]
    formatter: string
    color: string
    width: number
    lineHeight: number
    overflow: 'truncate'
    align: 'left' | 'right'
    fontWeight: number
    textBorderColor: string
    textBorderWidth: number
    verticalAlign: 'middle'
    backgroundColor: string
    borderColor: string
    borderWidth: number
    borderRadius: number
    padding: [number, number]
  }
}

type ChartLink = Icd11SankeyLink & {
  focused?: boolean
  semanticLinkId?: string
  semanticSource?: string
  semanticTarget?: string
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

interface SankeyHighlightStyleOptions {
  priorityPathIds?: Iterable<string>
  preserveLinkOrder?: boolean
}

type ShapeSnapshot = Record<string, unknown>
type SankeyGeometrySnapshot = {
  nodes: Map<string, ShapeSnapshot>
  links: Map<string, ShapeSnapshot>
}

type SankeyGraphicElement = {
  shape?: ShapeSnapshot
  silent?: boolean
  invisible?: boolean
  z2?: number
  getTextContent?: () => SankeyGraphicElement | undefined
  markRedraw?: () => void
  attr?: (value: { shape?: ShapeSnapshot; invisible?: boolean }) => void
  stopAnimation?: () => void
  animateTo?: (
    value: { shape: ShapeSnapshot },
    config: { duration: number; easing: string },
  ) => void
}

type SankeyInternalData = {
  count?: () => number
  indexOfName?: (name: string) => number
  getRawDataItem?: (index: number) => ChartNode | ChartLink | undefined
  getItemLayout?: (index: number) => { y?: number; dy?: number } | undefined
  getItemGraphicEl?: (index: number) => SankeyGraphicElement | undefined
}

type SankeyInternalSeries = {
  layoutInfo?: { height?: number }
  getData?: (dataType?: 'edge') => SankeyInternalData | undefined
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
  injectedSearchPath: boolean
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
const EDGE_KIND_LABELS: Record<Icd11SankeyNode['kind'], string> = {
  level1: 'Level1 分类',
  level2: 'Level2 分类',
  level3: 'Level3 分类',
  drug: '药物',
  biomarker: '生物标记物',
}
const PRESCRIPTION_STATUS_LABELS: Record<DrugPrescriptionStatus, string> = {
  prescription: '处方药',
  nonprescription: '非处方药',
  conflict: '属性记录不一致',
  unknown: '处方属性未知',
}
const DISPLAY_MODE_OPTIONS: (SankeySelectOption & { value: Icd11SankeyDisplayMode })[] = [
  { value: 'smart', label: '智能精简', description: '桌面最多 50 条，手机最多 20 条' },
  { value: 'top20', label: 'Top 20', description: '最多 20 条，含关联时保留关联分支' },
  { value: 'top50', label: 'Top 50', description: '最多 50 条，含关联时保留关联分支' },
  { value: 'top100', label: 'Top 100', description: '适合大屏浏览', advanced: true },
  {
    value: 'all',
    label: '全量',
    description: '路径较多时可能影响可读性',
    advanced: true,
  },
]
const MIN_WEIGHT_OPTIONS: SankeySelectOption[] = [
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
const MOBILE_BREAKPOINT = 720
const MOBILE_STAGE_TITLES = ['L1', 'L2', 'L3', '药物', '标记物']
const MOBILE_SWIPE_HINT_KEY = 'icd11-sankey-swipe-hint-v2'
const LONG_CHART_HEIGHT_RATIO = 1.35
const LONG_CHART_MIN_NODES = 60
const UPSTREAM_CONTEXT_ENTRY_MIN = 780
const UPSTREAM_CONTEXT_ENTRY_VIEWPORT_RATIO = 1.05
const HEADER_HEIGHT = 70
const HOVER_INTENT_DELAY = 85
const HOVER_RESTORE_DELAY = 110
const SANKEY_NODE_COLOR = '#4B78A8'
const SANKEY_NODE_HOVER_COLOR = '#356A9C'
const SANKEY_NODE_LOCKED_COLOR = '#245F8E'
const MAX_RELATION_PIE_ITEMS = 7
const TOP_RELATION_PIE_ITEMS = 7
const MAX_FILTER_CACHE_ENTRIES = 24
const MAX_HIGHLIGHT_CACHE_ENTRIES = 12
const MAX_CHART_HEIGHT = 4_200
const MAX_CHART_DEVICE_PIXEL_RATIO = 2
const SANKEY_LAYOUT_ANIMATION_MS = 940
const SANKEY_ACTIVE_LABEL_LANE_HEIGHT = 52
const SANKEY_NODE_WIDTH = 22
const SANKEY_LINK_CURVENESS = 0.52
const SANKEY_OPERATION_GUIDE_STORAGE_KEY = 'wbe:icd11-sankey-operation-guide:v2'
const SANKEY_OPERATION_GUIDE_DELAY_MS = 600
const SANKEY_OPERATION_GUIDE_STEPS: OperationGuideStep[] = [
  {
    title: '快速定位五层节点',
    description: '输入疾病分类、药物或生物标记物名称，从搜索结果中直接定位对应节点。',
    targetSelectors: ['.search-field'],
    placement: 'bottom',
    scrollIntoView: true,
    scrollBlock: 'center',
  },
  {
    title: '限定要展示的路径',
    description: '选择 Level1、关联范围、显示模式和最小权重，控制桑基图中的候选路径。',
    targetSelectors: ['.level-field', '.scope-field', '.display-field', '.weight-reset-group'],
    placement: 'bottom',
    scrollIntoView: true,
    scrollBlock: 'center',
  },
  {
    title: '阅读并锁定关系',
    description: '悬停查看关系摘要，单击节点或流带锁定路径；移动端可横向滑动查看下游层级。',
    targetSelectors: ['.chart-panel'],
    placement: 'right',
    scrollIntoView: true,
  },
  {
    title: '查看统计与路径详情',
    description: '右侧查看当前范围或全局构成，药物图下查看处方比例；移动端点击“查看概览”。',
    targetSelectors: ['.side-panel', '.mobile-overview-button'],
    placement: 'left',
    scrollIntoView: true,
  },
  {
    title: '理解图例与统计口径',
    description: '点击统计区右上角的图表说明，在浮窗中查看颜色、关联路径与比例的统计方式。',
    targetSelectors: ['#reading-guide'],
    placement: 'bottom',
    scrollIntoView: true,
    scrollBlock: 'center',
  },
  {
    title: '管理并导出当前视图',
    description: '可重置筛选、清除已锁定路径，并将当前桑基图导出为 PNG 图片。',
    targetSelectors: ['.toolbar-actions'],
    placement: 'left',
    scrollIntoView: true,
    scrollBlock: 'center',
  },
]

use([SankeyChart, PieChart, TooltipComponent, CanvasRenderer])

const chartEl = ref<HTMLElement | null>(null)
const chartShellEl = ref<HTMLElement | null>(null)
const chartScrollEl = ref<HTMLElement | null>(null)
const modalPieChartEl = ref<HTMLElement | null>(null)
const pieDialogEl = ref<HTMLElement | null>(null)
let piePreviousFocus: HTMLElement | null = null
let pieSavedBodyOverflow: string | null = null
const currentCategory = ref('')
const categories = ref<string[]>([])
const graph = ref<Icd11SankeyGraph | null>(null)
const activeBaseGraph = ref<Icd11SankeyGraph | null>(null)
const renderedGraph = ref<Icd11SankeyGraph | null>(null)
const isLoading = ref(false)
const loadState = ref<LoadState>('idle')
const errorMessage = ref('')
const searchQuery = ref('')
const displayMode = ref<Icd11SankeyDisplayMode>('smart')
const selectedLevel1 = ref('')
const level1Scope = ref<Level1Scope>('selected')
const minWeight = ref(0)
const chartHeight = ref(760)
const viewportHeight = ref(720)
const chartScrollLeft = ref(0)
const upstreamContextVisible = ref(false)
const hoverContextPathIds = ref<string[]>([])
const hoverContextTitle = ref('')
const lockLabel = ref('')
const lockText = ref('当前范围')
const lockedEdge = ref<ChartLink | null>(null)
const lockedPathId = ref('')
const currentFocus = ref('')
const promoteRelatedNodes = ref(true)
const detail = ref<DetailState>({ kind: 'category' })
const pieModalOpen = ref(false)
const readingGuideOpen = ref(false)
const readingGuideButton = ref<HTMLButtonElement | null>(null)
const readingGuidePanel = ref<HTMLElement | null>(null)
const readingGuidePopoverStyle = ref<Record<string, string>>({})
const sankeyHeaderHidden = ref(false)
const activePieId = ref('')
const overviewScope = ref<'current' | 'global'>('current')
const isMobileViewport = ref(
  typeof window !== 'undefined' ? window.innerWidth <= MOBILE_BREAKPOINT : false,
)
const mobileDrawerOpen = ref(false)
const activeMobileStage = ref(0)
const showMobileSwipeHint = ref(false)
const selectedSearchNodeId = ref('')
const forcedSearchPathId = ref('')
const sankeyGuideOpen = ref(false)
const sankeyGuideStep = ref(0)
const sankeyGuideSeen = ref(readSankeyOperationGuideSeen())
const sankeyGuideSuppressedForVisit = ref(false)
const sankeyGuideShownThisVisit = ref(false)
const sankeyGuideButton = ref<HTMLButtonElement | null>(null)

let chart: ECharts | null = null
let pieCharts = new Map<string, ECharts>()
const pieChartElements = new Map<string, HTMLElement>()
let modalPieChart: ECharts | null = null
let categoryController: AbortController | null = null
let graphController: AbortController | null = null
let hoverPreviewTimer: number | null = null
let hoverRestoreTimer: number | null = null
let activePreviewKey = ''
let swipeHintTimer: number | null = null
let searchDrawerTimer: number | null = null
let searchCommitInProgress = false
let searchLevel1ChangeInProgress = false
let sankeyGuideTimer: number | undefined
let sankeyGuideScrollSnapshot: { left: number; top: number } | null = null
let viewportFollowFrame: number | null = null
let routingGeometryFrame: number | null = null
let layoutAnimationFrame: number | null = null
let animateNextLayout = false
let activeNodeLocalY = new Map<string, number>()
let activeNodeLabelOffsetY = new Map<string, number>()
const displaySummaryCache = new WeakMap<Icd11SankeyGraph, Map<string, DisplayPathSummary>>()
const filteredGraphCache = new WeakMap<Icd11SankeyGraph, Map<string, Icd11SankeyGraph>>()
const chartGraphCache = new WeakMap<Icd11SankeyGraph, ChartGraph>()
const highlightGraphCache = new WeakMap<Icd11SankeyGraph, Map<string, ChartGraph>>()

const statsSummaryItems = computed(() => {
  const stats = categoryStats.value
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
  () => detail.value.kind === 'node' || detail.value.kind === 'paths',
)
const detailPathSum = computed(() => {
  if (detail.value.kind === 'category') return 0
  return detail.value.paths.reduce((sum, path) => sum + Number(path.weight || 0), 0)
})
const shownDetailPaths = computed(() => {
  if (detail.value.kind === 'category') return []
  return detail.value.paths.slice(0, detail.value.limit)
})
const currentScopePaths = computed(() =>
  graph.value
    ? sankeyScopeCandidates(
        graph.value.paths,
        selectedLevel1.value,
        level1Scope.value,
        minWeight.value,
      )
    : [],
)
const overviewPaths = computed(() =>
  overviewScope.value === 'current' ? currentScopePaths.value : (graph.value?.paths ?? []),
)
const categoryStats = computed(() =>
  graph.value ? summarizeSankeyOverview(overviewPaths.value) : null,
)
const overviewTitle = computed(() => (overviewScope.value === 'current' ? '当前范围' : '全局概览'))
const overviewScopeLabel = computed(() =>
  overviewScope.value === 'current'
    ? `${selectedLevel1.value || '未选择分类'} · ${level1Scope.value === 'linked' ? '含关联' : '仅当前'}${minWeight.value > 0 ? ` · 权重 ≥${minWeight.value}` : ''}`
    : '全部分类与路径',
)
const pieScopePaths = computed(() =>
  detail.value.kind === 'category' ? overviewPaths.value : detail.value.paths,
)
const prescriptionSummary = computed(() =>
  summarizeDrugPrescriptions(pieScopePaths.value, graph.value),
)
const singlePrescriptionLabel = computed(() => {
  if (!prescriptionSummary.value.available || prescriptionSummary.value.total !== 1) return ''
  const entry = Object.entries(prescriptionSummary.value.counts).find(([, count]) => count === 1)
  return entry ? PRESCRIPTION_STATUS_LABELS[entry[0] as DrugPrescriptionStatus] : ''
})
const detailContextLabel = computed(() => {
  if (detail.value.kind === 'node') return '节点详情'
  if (detail.value.kind === 'paths' && detail.value.edge) return '流带详情'
  if (detail.value.kind === 'paths') return '路径详情'
  return '关系统计'
})
const hasRenderableGraph = computed(() => Boolean(graph.value?.paths.length))
const hasVisibleLevel2Route = computed(() =>
  Boolean(
    (activeBaseGraph.value ?? graph.value)?.paths.some((path) => path.mappingLevel === 'Level2'),
  ),
)
const sankeyChartAriaLabel = computed(() =>
  hasVisibleLevel2Route.value
    ? 'ICD11 疾病、药物与生物标记物关系桑基图。缺少 Level3 的路径由 Level2 直接关联药物。'
    : 'ICD11 疾病、药物与生物标记物关系桑基图。',
)
const canAutoOpenSankeyGuide = computed(
  () =>
    window.location.hash !== '#reading-guide' &&
    loadState.value === 'ready' &&
    hasRenderableGraph.value &&
    !isLoading.value &&
    !pieModalOpen.value &&
    !mobileDrawerOpen.value &&
    !sankeyGuideSeen.value &&
    !sankeyGuideSuppressedForVisit.value &&
    !sankeyGuideShownThisVisit.value,
)
const selectedCategoryLabel = computed(
  () => graph.value?.category || currentCategory.value || 'ICD11 桑基图',
)
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
const level1SelectOptions = computed<SankeySelectOption[]>(() =>
  level1Options.value.map((level1) => ({ value: level1, label: level1 })),
)
const mobileDrawerTitle = computed(() => {
  if (detail.value.kind === 'category') return overviewTitle.value
  return detail.value.title
})
const smartPathLimit = computed(() => (isMobileViewport.value ? 20 : 50))
const searchResults = computed(() =>
  graph.value ? searchSankeyNodes(graph.value, searchQuery.value) : [],
)
const displaySummary = computed(() => (graph.value ? summarizeDisplayPaths(graph.value) : null))
const displaySummaryText = computed(() => {
  const summary = displaySummary.value
  if (!summary) return ''
  const baseText =
    summary.shownPathCount === summary.candidatePathCount
      ? `${summary.shownPathCount} 条路径`
      : `${summary.shownPathCount} / ${summary.candidatePathCount} 条路径，覆盖 ${formatPercent(summary.weightCoverage)}`
  const linkedText =
    summary.linkedLevel1Count > 0
      ? `，含 ${summary.linkedLevel1Count} 个关联分类`
      : level1Scope.value === 'linked'
        ? '，暂无关联分类'
        : ''
  const searchText = summary.injectedSearchPath ? '，含搜索定位结果' : ''
  return `${baseText}${linkedText}${searchText}`
})
const relationPieSections = computed<RelationPieSection[]>(() => {
  if (detail.value.kind === 'paths' && detail.value.edge) return []
  let sections =
    detail.value.kind === 'category'
      ? overviewPieSections(overviewPaths.value, overviewScope.value)
      : detail.value.kind === 'node'
        ? relationPieSectionsForNode(detail.value.nodeKind, detail.value.paths)
        : []
  return sections.map((section) => normalizeRelationPieSection(section))
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

watch(selectedLevel1, (value, previous) => {
  if (!graph.value || value === previous) return
  if (searchLevel1ChangeInProgress) return
  clearSearchSelection()
  overviewScope.value = 'current'
  clearLockedState()
  detail.value = { kind: 'category' }
  mobileDrawerOpen.value = false
  chartScrollLeft.value = 0
  activeMobileStage.value = 0
  chartScrollEl.value?.scrollTo({
    left: 0,
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  })
  animateNextLayout = true
  render()
})

watch(searchQuery, () => {
  if (!graph.value) return
  if (searchCommitInProgress) return
  clearSearchSelection()
  clearLockedState()
  detail.value = { kind: 'category' }
  mobileDrawerOpen.value = false
  render()
})

watch([displayMode, level1Scope, minWeight], () => {
  if (!graph.value) return
  clearSearchSelection()
  clearLockedState()
  detail.value = { kind: 'category' }
  mobileDrawerOpen.value = false
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
  if (isOpen) {
    pieSavedBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  } else if (pieSavedBodyOverflow !== null) {
    document.body.style.overflow = pieSavedBodyOverflow
    pieSavedBodyOverflow = null
  }
  await nextTick()
  if (isOpen) {
    renderModalRelationPieChart()
    pieDialogEl.value?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  } else {
    disposeModalRelationPieChart()
    restoreLockedHighlight()
    if (piePreviousFocus?.isConnected) piePreviousFocus.focus({ preventScroll: true })
    piePreviousFocus = null
  }
})

watch(
  canAutoOpenSankeyGuide,
  (eligible) => {
    clearSankeyGuideTimer()
    if (!eligible) return
    sankeyGuideTimer = window.setTimeout(() => {
      sankeyGuideTimer = undefined
      if (!canAutoOpenSankeyGuide.value) return
      void openSankeyOperationGuide('auto')
    }, SANKEY_OPERATION_GUIDE_DELAY_MS)
  },
  { immediate: true },
)

onMounted(async () => {
  window.scrollTo({ top: 0, left: 0 })
  viewportHeight.value = window.innerHeight
  isMobileViewport.value = window.innerWidth <= MOBILE_BREAKPOINT
  await nextTick()
  window.addEventListener('resize', handleResize)
  window.addEventListener('scroll', handleWindowScroll, { passive: true })
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('hashchange', openReadingGuideFromHash)
  handleWindowScroll()
  await loadCategories()
  await openReadingGuideFromHash()
})

onBeforeUnmount(() => {
  clearSankeyGuideTimer()
  if (viewportFollowFrame !== null) window.cancelAnimationFrame(viewportFollowFrame)
  if (routingGeometryFrame !== null) window.cancelAnimationFrame(routingGeometryFrame)
  if (layoutAnimationFrame !== null) window.cancelAnimationFrame(layoutAnimationFrame)
  categoryController?.abort()
  graphController?.abort()
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('scroll', handleWindowScroll)
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('hashchange', openReadingGuideFromHash)
  clearHoverTimers()
  if (swipeHintTimer !== null) window.clearTimeout(swipeHintTimer)
  if (searchDrawerTimer !== null) window.clearTimeout(searchDrawerTimer)
  chart?.dispose()
  chart = null
  disposeRelationPieCharts()
  disposeModalRelationPieChart()
  if (pieSavedBodyOverflow !== null) document.body.style.overflow = pieSavedBodyOverflow
})

async function openReadingGuideFromHash() {
  if (window.location.hash !== '#reading-guide') return
  readingGuideOpen.value = true
  if (isMobileViewport.value) mobileDrawerOpen.value = true
  await nextTick()
  readingGuideButton.value?.scrollIntoView({ block: 'nearest' })
  readingGuideButton.value?.focus({ preventScroll: true })
  updateReadingGuidePosition()
}

function closeReadingGuide(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !readingGuideOpen.value) return
  event.preventDefault()
  event.stopPropagation()
  readingGuideOpen.value = false
  readingGuideButton.value?.focus({ preventScroll: true })
}

function updateReadingGuidePosition() {
  const trigger = readingGuideButton.value
  if (!trigger) return
  const viewportPadding = 12
  const gap = 8
  const triggerRect = trigger.getBoundingClientRect()
  const width = Math.min(340, window.innerWidth - viewportPadding * 2)
  const maxHeight = Math.min(420, Math.max(220, window.innerHeight - viewportPadding * 2))
  const measuredHeight = Math.min(readingGuidePanel.value?.offsetHeight ?? 380, maxHeight)
  const left = Math.max(
    viewportPadding,
    Math.min(triggerRect.right - width, window.innerWidth - width - viewportPadding),
  )
  const below = triggerRect.bottom + gap
  const top =
    below + measuredHeight <= window.innerHeight - viewportPadding
      ? below
      : Math.max(viewportPadding, triggerRect.top - measuredHeight - gap)
  readingGuidePopoverStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.round(maxHeight)}px`,
  }
}

async function toggleReadingGuide() {
  readingGuideOpen.value = !readingGuideOpen.value
  if (!readingGuideOpen.value) return
  await nextTick()
  updateReadingGuidePosition()
}

function dismissReadingGuide() {
  readingGuideOpen.value = false
}

function readSankeyOperationGuideSeen() {
  if (typeof window === 'undefined') return false
  try {
    return Boolean(window.localStorage.getItem(SANKEY_OPERATION_GUIDE_STORAGE_KEY))
  } catch {
    return false
  }
}

function markSankeyOperationGuideSeen() {
  sankeyGuideSeen.value = true
  try {
    window.localStorage.setItem(SANKEY_OPERATION_GUIDE_STORAGE_KEY, 'shown')
  } catch {
    // The in-memory flag still prevents repeated automatic display during this visit.
  }
}

function clearSankeyGuideTimer() {
  if (sankeyGuideTimer == null) return
  window.clearTimeout(sankeyGuideTimer)
  sankeyGuideTimer = undefined
}

function handleSankeyWorkspaceInteraction() {
  if (sankeyGuideOpen.value || sankeyGuideShownThisVisit.value) return
  sankeyGuideSuppressedForVisit.value = true
  clearSankeyGuideTimer()
}

async function openSankeyOperationGuide(source: 'auto' | 'manual' = 'manual') {
  if (sankeyGuideOpen.value || !hasRenderableGraph.value || loadState.value !== 'ready') return
  clearSankeyGuideTimer()
  if (source === 'auto') {
    sankeyGuideShownThisVisit.value = true
    markSankeyOperationGuideSeen()
  }
  sankeyGuideScrollSnapshot = { left: window.scrollX, top: window.scrollY }
  pieModalOpen.value = false
  mobileDrawerOpen.value = false
  sankeyGuideStep.value = 0
  await nextTick()
  sankeyGuideOpen.value = true
}

function closeSankeyOperationGuide() {
  sankeyGuideOpen.value = false
  const snapshot = sankeyGuideScrollSnapshot
  sankeyGuideScrollSnapshot = null
  if (!snapshot) return
  void nextTick(() => window.scrollTo({ left: snapshot.left, top: snapshot.top, behavior: 'auto' }))
}

function previousSankeyGuideStep() {
  sankeyGuideStep.value = Math.max(0, sankeyGuideStep.value - 1)
}

function nextSankeyGuideStep() {
  sankeyGuideStep.value = Math.min(
    SANKEY_OPERATION_GUIDE_STEPS.length - 1,
    sankeyGuideStep.value + 1,
  )
}

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
    initChart()
    render()
    maybeShowMobileSwipeHint()
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
  errorMessage.value = getUserErrorMessage(error, fallback)
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
  const previousGeometry = animateNextLayout ? captureSankeyGeometry() : null
  cancelSankeyLayoutAnimation()
  activeNodeLabelOffsetY = new Map<string, number>()
  activeNodeLocalY =
    focusName && promoteRelatedNodes.value
      ? promotedNodeLocalY(baseGraph, focusName)
      : new Map<string, number>()
  const layoutGraph =
    focusName && promoteRelatedNodes.value
      ? {
          ...baseGraph,
          nodes: promoteConnectedSankeyNodes(baseGraph.nodes, baseGraph.paths, focusName),
        }
      : baseGraph
  renderedGraph.value = layoutGraph
  setChartHeight(baseGraph, 'immediate')

  let chartGraph = asChartGraph(layoutGraph)
  const seeds = searchSeeds(layoutGraph, searchQuery.value)
  if (focusName) {
    chartGraph = styledForNode(layoutGraph, focusName)
  } else if (seeds && seeds.size > 0) {
    chartGraph = styledForSearch(layoutGraph, seeds)
  }
  chartGraph = withActiveNodePositions(chartGraph)

  const animateLayout = animateNextLayout && !prefersReducedMotion()
  animateNextLayout = false

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
          nodeWidth: SANKEY_NODE_WIDTH,
          nodeGap: nodeGap(baseGraph),
          nodeAlign: 'justify',
          layoutIterations: 0,
          draggable: false,
          emphasis: {
            focus: 'none',
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
            fontFamily: 'Microsoft YaHei, 微软雅黑, Arial, sans-serif',
          },
          lineStyle: {
            color: 'source',
            opacity: 0.3,
            curveness: SANKEY_LINK_CURVENESS,
          },
        },
      ],
    },
    false,
  )
  if (focusName && promoteRelatedNodes.value) {
    packActiveLinkEndpoints(new Set(pathIdsForNode(layoutGraph, focusName)))
  }
  applyRoutingBridgeGeometry()
  raiseSankeyLabels()
  if (animateLayout && previousGeometry) animateSankeyGeometry(previousGeometry)

  if (!focusName && !lockedEdge.value && !lockedPathId.value) {
    detail.value = { kind: 'category' }
    lockLabel.value = ''
    lockText.value = statusText()
  }
}

function sankeyInternalSeries() {
  const internalChart = chart as unknown as {
    getModel?: () => { getSeriesByIndex?: (index: number) => SankeyInternalSeries | undefined }
  }
  const model = internalChart.getModel?.()
  return model?.getSeriesByIndex?.(0)
}

function cloneShape(shape: ShapeSnapshot | undefined): ShapeSnapshot | null {
  if (!shape) return null
  return Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, value]))
}

function captureDataGeometry(data: SankeyInternalData | undefined, key: 'name' | 'linkId') {
  const snapshots = new Map<string, ShapeSnapshot>()
  const count = data?.count?.() ?? 0
  for (let index = 0; index < count; index++) {
    const id = sankeyRawItemKey(data?.getRawDataItem?.(index), key)
    const shape = cloneShape(data?.getItemGraphicEl?.(index)?.shape)
    if (id && shape) snapshots.set(id, shape)
  }
  return snapshots
}

function sankeyRawItemKey(item: ChartNode | ChartLink | undefined, key: 'name' | 'linkId') {
  return key === 'name'
    ? (item as ChartNode | undefined)?.name
    : (item as ChartLink | undefined)?.linkId
}

function captureSankeyGeometry(): SankeyGeometrySnapshot | null {
  const series = sankeyInternalSeries()
  if (!series) return null
  return {
    nodes: captureDataGeometry(series.getData?.(), 'name'),
    links: captureDataGeometry(series.getData?.('edge'), 'linkId'),
  }
}

function collectDataGeometryAnimation(
  data: SankeyInternalData | undefined,
  previous: Map<string, ShapeSnapshot>,
  key: 'name' | 'linkId',
) {
  const entries: Array<{
    element: SankeyGraphicElement
    from: ShapeSnapshot
    to: ShapeSnapshot
  }> = []
  const count = data?.count?.() ?? 0
  for (let index = 0; index < count; index++) {
    const id = sankeyRawItemKey(data?.getRawDataItem?.(index), key)
    const element = data?.getItemGraphicEl?.(index)
    const from = id ? previous.get(id) : null
    const to = cloneShape(element?.shape)
    if (!element || !from || !to) continue
    element.stopAnimation?.()
    element.attr?.({ shape: from })
    entries.push({ element, from, to })
  }
  return entries
}

function interpolateShape(from: ShapeSnapshot, to: ShapeSnapshot, progress: number) {
  const shape = { ...to }
  for (const [key, target] of Object.entries(to)) {
    const start = from[key]
    if (typeof start === 'number' && typeof target === 'number') {
      shape[key] = start + (target - start) * progress
    }
  }
  return shape
}

function cancelSankeyLayoutAnimation() {
  if (layoutAnimationFrame === null) return
  window.cancelAnimationFrame(layoutAnimationFrame)
  layoutAnimationFrame = null
}

function animateSankeyGeometry(previous: SankeyGeometrySnapshot) {
  const series = sankeyInternalSeries()
  if (!series) return
  const entries = [
    ...collectDataGeometryAnimation(series.getData?.(), previous.nodes, 'name'),
    ...collectDataGeometryAnimation(series.getData?.('edge'), previous.links, 'linkId'),
  ]
  if (!entries.length) return

  const startedAt = performance.now()
  const step = (timestamp: number) => {
    const elapsed = Math.max(0, timestamp - startedAt)
    const rawProgress = Math.min(1, elapsed / SANKEY_LAYOUT_ANIMATION_MS)
    const progress = sankeyLayoutMotionProgress(rawProgress)
    for (const entry of entries) {
      entry.element.attr?.({ shape: interpolateShape(entry.from, entry.to, progress) })
    }
    if (rawProgress < 1) {
      layoutAnimationFrame = window.requestAnimationFrame(step)
    } else {
      layoutAnimationFrame = null
    }
  }
  layoutAnimationFrame = window.requestAnimationFrame(step)
}

function numericShapeValue(shape: ShapeSnapshot | undefined, key: string) {
  const value = shape?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function applyRoutingBridgeGeometry() {
  const series = sankeyInternalSeries()
  const nodeData = series?.getData?.()
  const edgeData = series?.getData?.('edge')
  if (!nodeData || !edgeData) return

  const bridges = new Map<string, ReturnType<typeof routingHorizontalBridgeBounds>>()
  for (let index = 0; index < (nodeData.count?.() ?? 0); index++) {
    const node = nodeData.getRawDataItem?.(index) as ChartNode | undefined
    const element = nodeData.getItemGraphicEl?.(index)
    const shape = cloneShape(element?.shape)
    if (!node?.routing || !element || !shape) continue
    const width = numericShapeValue(shape, 'width') || SANKEY_NODE_WIDTH
    const height = numericShapeValue(shape, 'height')
    const bounds = routingHorizontalBridgeBounds(
      numericShapeValue(shape, 'x'),
      numericShapeValue(shape, 'y'),
      width,
      height,
    )
    bridges.set(node.name, bounds)
    element.silent = true
    element.z2 = 12
    element.attr?.({
      invisible: true,
      shape: {
        ...shape,
        x: bounds.joinX - 0.5,
        y: bounds.centerY - 0.5,
        width: 1,
        height: 1,
      },
    })
  }

  if (!bridges.size) return
  const routingEdges: Array<{
    link: ChartLink
    element: SankeyGraphicElement
    shape: ShapeSnapshot
  }> = []
  for (let index = 0; index < (edgeData.count?.() ?? 0); index++) {
    const link = edgeData.getRawDataItem?.(index) as ChartLink | undefined
    const element = edgeData.getItemGraphicEl?.(index)
    const shape = cloneShape(element?.shape)
    if (!link || !element || !shape) continue
    if (bridges.has(link.source) || bridges.has(link.target)) {
      routingEdges.push({ link, element, shape })
    }
  }

  for (const [routeName, bridge] of bridges) {
    const incomingById = new Map(
      routingEdges
        .filter(({ link }) => link.target === routeName)
        .map((edge) => [routingSemanticLinkKey(edge.link), edge]),
    )
    const outgoingById = new Map(
      routingEdges
        .filter(({ link }) => link.source === routeName)
        .map((edge) => [routingSemanticLinkKey(edge.link), edge]),
    )
    const pairedIds = [...incomingById.keys()].filter((id) => outgoingById.has(id))
    const lanes = layoutRoutingBridgeLanes(
      pairedIds.map((id) => {
        const incoming = incomingById.get(id)!
        const outgoing = outgoingById.get(id)!
        return {
          id,
          incomingY: numericShapeValue(incoming.shape, 'y2'),
          outgoingY: numericShapeValue(outgoing.shape, 'y1'),
          incomingExtent: numericShapeValue(incoming.shape, 'extent'),
          outgoingExtent: numericShapeValue(outgoing.shape, 'extent'),
        }
      }),
      bridge.centerY,
    )
    for (const lane of lanes) {
      const incoming = incomingById.get(lane.id)
      const outgoing = outgoingById.get(lane.id)
      if (!incoming || !outgoing) continue
      const point = { x: bridge.joinX, y: lane.y, extent: lane.extent }
      incoming.element.attr?.({
        shape: connectRoutingLinkToBridge(incoming.shape, 'target', point, SANKEY_LINK_CURVENESS),
      })
      outgoing.element.attr?.({
        shape: connectRoutingLinkToBridge(outgoing.shape, 'source', point, SANKEY_LINK_CURVENESS),
      })
    }
  }
}

function routingSemanticLinkKey(link: ChartLink) {
  return link.semanticLinkId ?? link.linkId.replace(/@@route:(?:in|out)$/, '')
}

function raiseSankeyLabels() {
  const nodeData = sankeyInternalSeries()?.getData?.()
  if (!nodeData) return
  for (let index = 0; index < (nodeData.count?.() ?? 0); index++) {
    const node = nodeData.getRawDataItem?.(index) as ChartNode | undefined
    const element = nodeData.getItemGraphicEl?.(index)
    if (!node || !element) continue
    raiseSankeyNodeLabelLayer(element, node.routing)
  }
}

function scheduleRoutingBridgeGeometry() {
  if (routingGeometryFrame !== null) window.cancelAnimationFrame(routingGeometryFrame)
  routingGeometryFrame = window.requestAnimationFrame(() => {
    routingGeometryFrame = null
    applyRoutingBridgeGeometry()
    raiseSankeyLabels()
  })
}

function packActiveLinkEndpoints(activePathIds: Set<string>) {
  if (!activePathIds.size) return
  const series = sankeyInternalSeries()
  const nodeData = series?.getData?.()
  const edgeData = series?.getData?.('edge')
  if (!nodeData || !edgeData) return

  const nodeTop = new Map<string, number>()
  for (let index = 0; index < (nodeData.count?.() ?? 0); index++) {
    const node = nodeData.getRawDataItem?.(index) as ChartNode | undefined
    const shape = nodeData.getItemGraphicEl?.(index)?.shape
    if (node?.name && shape) nodeTop.set(node.name, numericShapeValue(shape, 'y'))
  }

  const edges = Array.from({ length: edgeData.count?.() ?? 0 }, (_, index) => {
    const link = edgeData.getRawDataItem?.(index) as ChartLink | undefined
    const element = edgeData.getItemGraphicEl?.(index)
    const shape = cloneShape(element?.shape)
    if (!link || !element || !shape) return null
    return {
      id: link.linkId,
      link,
      element,
      shape,
      active: link.pathIds.some((pathId) => activePathIds.has(pathId)),
      extent: Math.max(0, numericShapeValue(shape, 'extent')),
    }
  }).filter((edge): edge is NonNullable<typeof edge> => Boolean(edge))

  const nextShapes = new Map(edges.map((edge) => [edge.id, { ...edge.shape }]))
  const packSide = (
    nodeKey: 'source' | 'target',
    endpointKey: 'y1' | 'y2',
    controlKey: 'cpy1' | 'cpy2',
  ) => {
    const byNode = new Map<string, typeof edges>()
    for (const edge of edges) {
      const name = edge.link[nodeKey]
      const entries = byNode.get(name) ?? []
      entries.push(edge)
      byNode.set(name, entries)
    }
    for (const [name, entries] of byNode) {
      let cursor = nodeTop.get(name)
      if (cursor === undefined) continue
      entries.sort(
        (a, b) =>
          Number(b.active) - Number(a.active) ||
          numericShapeValue(a.shape, endpointKey) - numericShapeValue(b.shape, endpointKey) ||
          a.id.localeCompare(b.id),
      )
      for (const edge of entries) {
        const shape = nextShapes.get(edge.id)
        if (!shape) continue
        shape[endpointKey] = cursor
        shape[controlKey] = cursor
        cursor += edge.extent
      }
    }
  }

  packSide('source', 'y1', 'cpy1')
  packSide('target', 'y2', 'cpy2')
  for (const edge of edges) {
    const shape = nextShapes.get(edge.id)
    if (shape) edge.element.attr?.({ shape })
  }
}

function promotedNodeLocalY(baseGraph: Icd11SankeyGraph, focusName: string) {
  const series = sankeyInternalSeries()
  const data = series?.getData?.()
  const height = Number(series?.layoutInfo?.height || 0)
  if (!data || height <= 0) return new Map<string, number>()

  const metrics = new Map<string, { y: number; height: number; node?: ChartNode }>()
  const count = data.count?.() ?? 0
  for (let index = 0; index < count; index++) {
    const rawNode = data.getRawDataItem?.(index) as ChartNode | undefined
    const name = rawNode?.name
    const layout = data.getItemLayout?.(index)
    if (!name || typeof layout?.y !== 'number') continue
    metrics.set(name, { y: layout.y, height: Number(layout.dy || 0), node: rawNode })
  }

  const focusPaths = baseGraph.paths.filter((path) => path.nodeIds.includes(focusName))
  const focusPathIds = new Set(focusPaths.map((path) => path.pathId))
  const connected = new Set(focusPaths.flatMap((path) => path.nodeIds))
  const focusWeightByNode = new Map<string, number>()
  for (const path of focusPaths) {
    for (const nodeName of path.nodeIds) {
      focusWeightByNode.set(
        nodeName,
        (focusWeightByNode.get(nodeName) ?? 0) + Number(path.weight || 0),
      )
    }
  }
  const routingNodes = [...metrics.values()]
    .map((metric) => metric.node)
    .filter((node): node is ChartNode => Boolean(node?.routing))
  for (const node of routingNodes) {
    const routeWeight = (node.routePathIds ?? [])
      .filter((pathId) => focusPathIds.has(pathId))
      .reduce(
        (sum, pathId) =>
          sum + Number(baseGraph.paths.find((path) => path.pathId === pathId)?.weight || 0),
        0,
      )
    if (routeWeight <= 0) continue
    connected.add(node.name)
    focusWeightByNode.set(node.name, routeWeight)
  }
  const positions = new Map<string, number>()
  const minimumLabelStep = Math.max(24, sankeyLabelFontSize(baseGraph) + 10)
  for (const depth of [0, 1, 2, 3, 4]) {
    const column = [...baseGraph.nodes, ...routingNodes]
      .filter((node) => node.depth === depth && metrics.has(node.name))
      .sort((a, b) => {
        const aRank = a.name === focusName ? 0 : connected.has(a.name) ? 1 : 2
        const bRank = b.name === focusName ? 0 : connected.has(b.name) ? 1 : 2
        if (aRank !== bRank) return aRank - bRank
        if (aRank === 1) {
          const focusWeightDiff =
            (focusWeightByNode.get(b.name) ?? 0) - (focusWeightByNode.get(a.name) ?? 0)
          if (focusWeightDiff) return focusWeightDiff
        }
        return (metrics.get(a.name)?.y ?? 0) - (metrics.get(b.name)?.y ?? 0)
      })
    let cursor = 0
    for (const node of column) {
      positions.set(node.name, Math.max(0, Math.min(1, cursor / height)))
      cursor += (metrics.get(node.name)?.height ?? 0) + nodeGap(baseGraph)
    }

    let nextLabelCenter = minimumLabelStep / 2
    for (const node of column.filter(
      (item) => connected.has(item.name) && !(item as ChartNode).routing,
    )) {
      const metric = metrics.get(node.name)
      const localY = positions.get(node.name)
      if (!metric || localY === undefined) continue
      const nodeTop = localY * height
      const nodeCenter = nodeTop + metric.height / 2
      const preferredLabelCenter =
        metric.height > SANKEY_ACTIVE_LABEL_LANE_HEIGHT
          ? nodeTop + SANKEY_ACTIVE_LABEL_LANE_HEIGHT / 2
          : nodeCenter
      const labelCenter = Math.min(
        height - minimumLabelStep / 2,
        Math.max(preferredLabelCenter, nextLabelCenter),
      )
      activeNodeLabelOffsetY.set(node.name, labelCenter - nodeCenter)
      nextLabelCenter = labelCenter + minimumLabelStep
    }
  }
  return positions
}

function withActiveNodePositions(baseGraph: ChartGraph): ChartGraph {
  return {
    ...baseGraph,
    nodes: baseGraph.nodes.map((node) => ({
      ...node,
      localY: activeNodeLocalY.get(node.name) ?? null,
      label: node.label
        ? {
            ...node.label,
            offset: [0, activeNodeLabelOffsetY.get(node.name) ?? 0],
          }
        : node.label,
    })),
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
  const transformed = routeLevel2OnlyChartLinks({
    ...baseGraph,
    nodes: baseGraph.nodes.map((node) => chartNode(node, true, false)),
    links: expandChartLinks(baseGraph).map((link) => chartLink(link, true, false)),
  })
  chartGraphCache.set(baseGraph, transformed)
  return transformed
}

function styledForPathIds(
  baseGraph: Icd11SankeyGraph,
  pathIds: Iterable<string>,
  options: SankeyHighlightStyleOptions = {},
): ChartGraph {
  const activePathIds = new Set(pathIds)
  const priorityPathIds = new Set(options.priorityPathIds ?? activePathIds)
  const activeCacheKey = [...activePathIds].sort().join('\u001f')
  const priorityCacheKey = [...priorityPathIds].sort().join('\u001f')
  const cacheKey = `${options.preserveLinkOrder ? 'stable' : 'priority'}\u001e${activeCacheKey}\u001e${priorityCacheKey}`
  const cached = highlightGraphCache.get(baseGraph)?.get(cacheKey)
  if (cached) return cached
  const activeNodes = new Set<string>()
  for (const path of selectedPaths(baseGraph, activePathIds)) {
    for (const nodeName of path.nodeIds) activeNodes.add(nodeName)
  }
  const expandedLinks = expandChartLinks(baseGraph).map((link) => {
    const highlighted = link.pathIds.some((pathId) => activePathIds.has(pathId))
    return chartLink(link, highlighted, highlighted)
  })
  if (!options.preserveLinkOrder) {
    expandedLinks.sort((a, b) => {
      const aPriority = a.pathIds.some((pathId) => priorityPathIds.has(pathId))
      const bPriority = b.pathIds.some((pathId) => priorityPathIds.has(pathId))
      return Number(bPriority) - Number(aPriority) || a.linkId.localeCompare(b.linkId)
    })
  }
  const transformed = routeLevel2OnlyChartLinks(
    {
      ...baseGraph,
      nodes: baseGraph.nodes.map((node) => {
        const highlighted = activeNodes.has(node.name)
        return chartNode(node, highlighted, highlighted)
      }),
      links: expandedLinks,
    },
    { preserveNodeOrder: options.preserveLinkOrder },
  )
  setBoundedWeakCacheEntry(
    highlightGraphCache,
    baseGraph,
    cacheKey,
    transformed,
    MAX_HIGHLIGHT_CACHE_ENTRIES,
  )
  return transformed
}

function expandChartLinks(baseGraph: Icd11SankeyGraph): ChartLink[] {
  const weightByPathId = new Map(
    baseGraph.paths.map((path) => [path.pathId, Number(path.weight || 0)]),
  )
  return baseGraph.links.flatMap((link) => {
    const pathIds = [...new Set(link.pathIds)]
    if (!pathIds.length) return [link]
    return pathIds.map((pathId) => ({
      ...link,
      linkId: `${link.linkId}@@path:${pathId}`,
      value: weightByPathId.get(pathId) ?? Number(link.value || 0) / pathIds.length,
      pathIds: [pathId],
      semanticLinkId: `${link.linkId}@@path:${pathId}`,
      semanticSource: link.source,
      semanticTarget: link.target,
    }))
  })
}

function routeLevel2OnlyChartLinks(
  baseGraph: ChartGraph,
  options: { preserveNodeOrder?: boolean } = {},
): ChartGraph {
  const routed = splitLevel2OnlyLinks(baseGraph.links)
  if (!routed.groups.length) return baseGraph

  const routingNodes = routed.groups.map(({ source, links }) => chartRoutingNode(source, links))

  const sourceNodes = [...baseGraph.nodes, ...routingNodes]
  const nodes = orderSankeyRoutingNodes(sourceNodes, options.preserveNodeOrder)

  return {
    ...baseGraph,
    nodes,
    links: routed.links,
  }
}

function chartRoutingNode(source: string, links: ChartLink[]): ChartNode {
  const first = links[0]
  const pathIds = [...new Set(links.flatMap((link) => link.pathIds))]
  const focused = links.some((link) => link.focused)
  const node = chartNode(
    {
      name: sankeyRouteNodeName(source),
      displayName: '',
      kind: 'level3',
      depth: 2,
      value: links.reduce((sum, link) => sum + Number(link.value || 0), 0),
      searchText: '',
      level1: first?.level1 ?? '',
      color: first?.color ?? SANKEY_LEVEL2_FALLBACK_COLOR,
    },
    false,
    false,
  )
  return {
    ...node,
    cursor: 'default',
    focused,
    routing: true,
    routePathIds: pathIds,
    routeSource: source,
    tooltip: { show: false },
    itemStyle: {
      color: 'transparent',
      opacity: 0,
      borderColor: 'transparent',
      borderWidth: 0,
      borderType: 'solid',
    },
    emphasis: {
      itemStyle: {
        color: 'transparent',
        opacity: 0,
        borderColor: 'transparent',
        borderWidth: 0,
        borderType: 'solid',
      },
      label: {
        color: 'transparent',
        textBorderColor: 'transparent',
        textBorderWidth: 0,
      },
    },
    blur: {
      itemStyle: { opacity: 0.32 },
      label: {
        color: 'transparent',
        textBorderColor: 'transparent',
        textBorderWidth: 0,
      },
    },
    label: node.label
      ? {
          ...node.label,
          show: false,
          formatter: '',
        }
      : node.label,
  }
}

function withColorAlpha(color: string | undefined, alpha: number) {
  const value = color || SANKEY_LEVEL2_FALLBACK_COLOR
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(value)
  const full = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value)
  const channels = short
    ? short.slice(1).map((channel) => Number.parseInt(`${channel}${channel}`, 16))
    : full?.slice(1).map((channel) => Number.parseInt(channel, 16))
  return channels
    ? `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`
    : SANKEY_LEVEL2_FALLBACK_COLOR
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
    focused: highlighted,
    itemStyle: {
      color: highlighted ? SANKEY_NODE_LOCKED_COLOR : SANKEY_NODE_COLOR,
      opacity: active ? (isRelatedContext && !highlighted ? 0.7 : 1) : 0.2,
      borderColor: active ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.5)',
      borderWidth: 1,
    },
    emphasis: {
      itemStyle: {
        color: highlighted ? SANKEY_NODE_LOCKED_COLOR : SANKEY_NODE_HOVER_COLOR,
        opacity: active ? 1 : 0.26,
        borderColor: 'rgba(255,255,255,0.96)',
        borderWidth: 1,
      },
      label: {
        color: highlighted ? '#0F4968' : active ? '#173247' : 'rgba(34, 56, 75, 0.56)',
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
      offset: [0, 0],
      formatter: label.text,
      color: highlighted
        ? '#123F5B'
        : active
          ? isRelatedContext
            ? 'rgba(34, 56, 75, 0.72)'
            : '#22384B'
          : 'rgba(34, 56, 75, 0.56)',
      width: label.width,
      lineHeight: label.lineHeight,
      overflow: 'truncate',
      align: position === 'right' ? 'left' : 'right',
      fontWeight: highlighted ? 650 : active ? 600 : 500,
      textBorderColor: 'transparent',
      textBorderWidth: 0,
      verticalAlign: 'middle',
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderWidth: 0,
      borderRadius: 0,
      padding: [0, 0],
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
    focused: highlighted,
    lineStyle: {
      color,
      opacity: highlighted ? 0.78 : active ? activeOpacity : 0.08,
      curveness: 0.52,
    },
    emphasis: {
      lineStyle: {
        opacity: highlighted ? 0.82 : active ? 0.62 : 0.1,
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
  chart?.dispatchAction({ type: 'hideTip' })
  chart?.dispatchAction({ type: 'downplay', seriesIndex: 0 })
  clearHoverPreviewState()
  if (event.dataType === 'node') {
    const node = event.data as ChartNode
    if (node.routing) return
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
    animateNextLayout = true
    render(currentFocus.value)
    const paths = currentScopePaths.value.filter((path) => path.nodeIds.includes(activeNode.name))
    lockLabel.value = '节点'
    lockText.value = activeNode.displayName
    detail.value = {
      kind: 'node',
      title: activeNode.displayName,
      level: KIND_LABELS[activeNode.kind],
      nodeKind: activeNode.kind,
      nodeWeight: sumPathWeight(paths),
      paths,
      limit: 20,
    }
    openDetailPanel()
    if (promoteRelatedNodes.value) await locateSearchNode(activeNode)
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

function edgeRelationshipTitle(
  sourceKind: Icd11SankeyNode['kind'],
  targetKind: Icd11SankeyNode['kind'],
) {
  if (sourceKind === 'level1' && targetKind === 'level2') return '疾病分类关系'
  if (sourceKind === 'level2' && targetKind === 'level3') return '疾病分层关系'
  if (targetKind === 'drug') return '疾病与药物关系'
  if (sourceKind === 'drug' && targetKind === 'biomarker') return '药物与生物标记物关系'
  return '节点间关系'
}

function drugForEdge(
  baseGraph: Icd11SankeyGraph,
  source: Icd11SankeyNode | undefined,
  target: Icd11SankeyNode | undefined,
) {
  const drugNode = source?.kind === 'drug' ? source : target?.kind === 'drug' ? target : undefined
  if (!drugNode) return undefined
  return {
    id: drugNode.name,
    name: drugNode.displayName,
    prescriptionStatus: baseGraph.drugPrescriptions?.[drugNode.name] ?? 'unknown',
  }
}

function lockEdge(edge: Icd11SankeyLink) {
  const baseGraph = activeBaseGraph.value
  if (!baseGraph || !renderedGraph.value) return
  const chartEdge = edge as ChartLink
  const semanticLinkId = chartEdge.semanticLinkId ?? chartEdge.linkId
  const lockedSemanticLinkId = lockedEdge.value?.semanticLinkId ?? lockedEdge.value?.linkId
  if (lockedSemanticLinkId === semanticLinkId) {
    clearLockedState()
    render()
    return
  }
  lockedEdge.value = chartEdge
  lockedPathId.value = ''
  currentFocus.value = ''
  updateSeriesGraph(styledForPathIds(renderedGraph.value, edge.pathIds))
  lockLabel.value = '流带'
  lockText.value = `${edge.sourceLabel} → ${edge.targetLabel}`
  const paths = selectedPaths(baseGraph, edge.pathIds)
  const semanticSource = chartEdge.semanticSource ?? chartEdge.source
  const semanticTarget = chartEdge.semanticTarget ?? chartEdge.target
  const sourceTotal = baseGraph.links
    .filter((link) => link.source === semanticSource)
    .reduce((sum, link) => sum + Number(link.value || 0), 0)
  const targetTotal = baseGraph.links
    .filter((link) => link.target === semanticTarget)
    .reduce((sum, link) => sum + Number(link.value || 0), 0)
  const nodeIndex = icd11SankeyGraphIndex(baseGraph).nodeById
  const sourceNode = nodeIndex.get(semanticSource)
  const targetNode = nodeIndex.get(semanticTarget)
  const sourceKind = sourceNode?.kind ?? 'level1'
  const targetKind = targetNode?.kind ?? 'level2'
  const associatedNodeCount = new Set(paths.flatMap((path) => path.nodeIds)).size - 2
  detail.value = {
    kind: 'paths',
    title: edgeRelationshipTitle(sourceKind, targetKind),
    paths,
    limit: 30,
    edge: {
      source: semanticSource,
      target: semanticTarget,
      sourceLabel: edge.sourceLabel,
      targetLabel: edge.targetLabel,
      value: Number(edge.value || 0),
      sourceShare: sourceTotal > 0 ? Number(edge.value || 0) / sourceTotal : 0,
      targetShare: targetTotal > 0 ? Number(edge.value || 0) / targetTotal : 0,
      associatedNodeCount: Math.max(0, associatedNodeCount),
      sourceKind,
      targetKind,
      drug: drugForEdge(baseGraph, sourceNode, targetNode),
    },
  }
}

async function toggleRelatedNodePromotion() {
  promoteRelatedNodes.value = !promoteRelatedNodes.value
  if (!currentFocus.value) return
  animateNextLayout = true
  render(currentFocus.value)
  if (!promoteRelatedNodes.value || !activeBaseGraph.value) return
  const activeNode = activeBaseGraph.value.nodes.find((node) => node.name === currentFocus.value)
  if (activeNode) await locateSearchNode(activeNode)
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
  lockLabel.value = '路径'
  lockText.value = pathText(path)
  detail.value = {
    kind: 'paths',
    title: '聚合五层路径',
    paths: [path],
    limit: 1,
  }
}

function updateSeriesGraph(nextGraph: ChartGraph) {
  const positionedGraph = withActiveNodePositions(nextGraph)
  chart?.setOption({
    animation: false,
    series: [
      {
        data: positionedGraph.nodes,
        links: positionedGraph.links,
      },
    ],
  })
  if (currentFocus.value && promoteRelatedNodes.value && renderedGraph.value) {
    packActiveLinkEndpoints(new Set(pathIdsForNode(renderedGraph.value, currentFocus.value)))
  }
  applyRoutingBridgeGeometry()
  raiseSankeyLabels()
}

function schedulePreviewHighlight(key: string, pathIds: string[], contextTitle = '') {
  if (layoutAnimationFrame !== null) return
  if (!renderedGraph.value || !pathIds.length) return
  const hoverPathIds = [...new Set(pathIds)]
  const persistentPathIds = persistentContextPathIds.value
  const previewPathIds = mergeSankeyHighlightPathIds(persistentPathIds, hoverPathIds)
  if (!previewPathIds.length) return
  if (key === activePreviewKey && !hoverPreviewTimer) return
  clearTimer('restore')
  clearTimer('preview')
  hoverPreviewTimer = window.setTimeout(() => {
    hoverPreviewTimer = null
    if (!renderedGraph.value || key === activePreviewKey) return
    activePreviewKey = key
    hoverContextPathIds.value = hoverPathIds
    hoverContextTitle.value = contextTitle
    updateSeriesGraph(
      styledForPathIds(
        renderedGraph.value,
        previewPathIds,
        persistentPathIds.length
          ? { priorityPathIds: persistentPathIds }
          : { preserveLinkOrder: true },
      ),
    )
  }, HOVER_INTENT_DELAY)
}

function scheduleRestoreHighlight() {
  if (layoutAnimationFrame !== null) return
  clearTimer('preview')
  clearTimer('restore')
  hoverRestoreTimer = window.setTimeout(() => {
    hoverRestoreTimer = null
    clearHoverPreview()
  }, HOVER_RESTORE_DELAY)
}

function clearHoverPreview() {
  clearHoverPreviewState()
  restoreLockedHighlight()
}

function clearHoverPreviewState() {
  clearHoverTimers()
  activePreviewKey = ''
  hoverContextPathIds.value = []
  hoverContextTitle.value = ''
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
  const sourceItems = collapseRelationShares(section.items, TOP_RELATION_PIE_ITEMS)

  return {
    ...section,
    items: sourceItems.map((item, index) => decorateRelationPieItem(section.id, item, index)),
    totalWeight,
    sourceItemCount,
    hiddenItemCount,
    isCollapsed: hiddenItemCount > 0,
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
  return relationPieColor(index, item.isOther)
}

function isRelationPieChartable(
  section: RelationPieSection | null | undefined,
): section is RelationPieSection {
  return Boolean(section && section.items.length > 1)
}

function relationPieStartAngle(section: RelationPieSection) {
  const dominantShare = Math.max(0, ...section.items.map((item) => Number(item.share || 0)))
  if (dominantShare <= 0.5) return 90
  const remainingAngle = (1 - dominantShare) * 360
  return Math.round(90 - remainingAngle / 2)
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
          fontFamily: 'Microsoft YaHei, 微软雅黑, Arial, sans-serif',
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
          radius: large ? ['43%', '64%'] : ['39%', '59%'],
          center: ['50%', large ? '53%' : '54%'],
          startAngle: relationPieStartAngle(section),
          minAngle: 0,
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
            edgeDistance: large ? 18 : 7,
            bleedMargin: 6,
            distanceToLabelLine: 3,
            color: '#314b5f',
            fontSize: large ? 12 : 10,
            fontWeight: 650,
            lineHeight: large ? 17 : 15,
            formatter(params: { data?: RelationPieDatum }) {
              const data = params.data
              if (!data) return ''
              return `{weight|${formatNumber(data.value)}} {share|${formatPercent(data.share)}}`
            },
            rich: {
              weight: {
                color: '#173247',
                fontSize: large ? 12 : 10,
                fontWeight: 700,
              },
              share: {
                color: '#5f7381',
                fontSize: large ? 11 : 10,
                fontWeight: 600,
              },
            },
          },
          labelLine: {
            show: true,
            length: large ? 10 : 7,
            length2: large ? 8 : 6,
            smooth: 0.16,
            lineStyle: {
              color: '#a8b6c0',
              width: 1,
            },
          },
          labelLayout: {
            hideOverlap: false,
            moveOverlap: 'shiftY',
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
  piePreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  activePieId.value = sectionId
  pieModalOpen.value = true
}

function closePieModal() {
  pieModalOpen.value = false
  activePieId.value = ''
}

function handleKeydown(event: KeyboardEvent) {
  if (readingGuideOpen.value && event.key === 'Escape') {
    closeReadingGuide(event)
    return
  }
  if (!pieModalOpen.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closePieModal()
    return
  }
  if (event.key !== 'Tab') return
  const elements = [
    ...(pieDialogEl.value?.querySelectorAll<HTMLElement>('button, [tabindex="0"]') ?? []),
  ]
  const first = elements[0]
  const last = elements[elements.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
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
  clearSearchSelection()
  displayMode.value = 'smart'
  selectedLevel1.value = defaultLevel1()
  level1Scope.value = 'selected'
  minWeight.value = 0
  overviewScope.value = 'current'
  mobileDrawerOpen.value = false
  clearLockedState()
  render()
}

function clearLock() {
  clearLockedState()
  detail.value = { kind: 'category' }
  animateNextLayout = true
  render()
}

function resetInteractionState() {
  searchQuery.value = ''
  clearSearchSelection()
  displayMode.value = 'smart'
  selectedLevel1.value = defaultLevel1()
  level1Scope.value = 'selected'
  minWeight.value = 0
  overviewScope.value = 'current'
  mobileDrawerOpen.value = false
  activeMobileStage.value = 0
  chartScrollLeft.value = 0
  clearLockedState()
  detail.value = { kind: 'category' }
}

function clearSelectionFromBlank() {
  clearLockedState()
  detail.value = { kind: 'category' }
  animateNextLayout = true
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

function clearSearchSelection() {
  selectedSearchNodeId.value = ''
  forcedSearchPathId.value = ''
  if (searchDrawerTimer !== null) {
    window.clearTimeout(searchDrawerTimer)
    searchDrawerTimer = null
  }
}

async function selectSearchResult(result: SankeyNodeSearchResult) {
  const fullGraph = graph.value
  if (!fullGraph) return
  const targetLevel1 = resolveSearchLevel1(fullGraph, result.nodeId, selectedLevel1.value)
  const representative = representativeSearchPath(fullGraph, result.nodeId, targetLevel1)

  searchCommitInProgress = true
  searchLevel1ChangeInProgress = true
  selectedSearchNodeId.value = result.nodeId
  forcedSearchPathId.value = representative?.pathId ?? ''
  searchQuery.value = result.name
  if (targetLevel1 && targetLevel1 !== selectedLevel1.value) selectedLevel1.value = targetLevel1
  await nextTick()
  searchCommitInProgress = false
  searchLevel1ChangeInProgress = false

  clearLockedState()
  mobileDrawerOpen.value = false
  const node = icd11SankeyGraphIndex(fullGraph).nodeById.get(result.nodeId)
  if (!node) {
    render()
    return
  }
  const paths = pathsForSearchNode(fullGraph, result.nodeId, targetLevel1)
  currentFocus.value = node.name
  lockLabel.value = '当前搜索定位'
  lockText.value = node.displayName
  detail.value = {
    kind: 'node',
    title: node.displayName,
    level: KIND_LABELS[node.kind],
    nodeKind: node.kind,
    nodeWeight: sumPathWeight(paths),
    paths,
    limit: 20,
  }
  animateNextLayout = true
  render(node.name)
  await locateSearchNode(node)

  if (isMobileViewport.value) {
    searchDrawerTimer = window.setTimeout(
      () => {
        mobileDrawerOpen.value = true
        searchDrawerTimer = null
        applyChartLayout()
      },
      prefersReducedMotion() ? 0 : 200,
    )
  } else {
    openDetailPanel()
  }
}

async function locateSearchNode(node: Icd11SankeyNode) {
  if (isMobileViewport.value) scrollToMobileStage(node.depth)

  let nodeAnchor: number | null = null
  try {
    const series = sankeyInternalSeries()
    const data = series?.getData?.()
    const dataIndex = data?.indexOfName?.(node.name) ?? -1
    const layout = dataIndex >= 0 ? data?.getItemLayout?.(dataIndex) : undefined
    if (typeof layout?.y === 'number') {
      const promotedLocalY = activeNodeLocalY.get(node.name)
      const targetNodeY =
        promotedLocalY === undefined
          ? layout.y
          : promotedLocalY * Number(series?.layoutInfo?.height || 0)
      const nodeCenter = SERIES_TOP + targetNodeY + Number(layout.dy || 0) / 2
      nodeAnchor = nodeCenter + (activeNodeLabelOffsetY.get(node.name) ?? 0)
    }
  } catch {
    nodeAnchor = null
  }

  const targetElement = chartEl.value ?? chartShellEl.value
  if (!targetElement) return
  const elementTop = window.scrollY + targetElement.getBoundingClientRect().top
  const targetTop =
    nodeAnchor === null
      ? elementTop - 130
      : elementTop + nodeAnchor - Math.min(window.innerHeight * 0.28, 220)
  animateViewportFollow(Math.max(0, targetTop))
}

function animateViewportFollow(targetTop: number) {
  if (viewportFollowFrame !== null) {
    window.cancelAnimationFrame(viewportFollowFrame)
    viewportFollowFrame = null
  }
  if (prefersReducedMotion()) {
    window.scrollTo({ top: targetTop, behavior: 'auto' })
    return
  }
  const startTop = window.scrollY
  const distance = targetTop - startTop
  if (Math.abs(distance) < 2) return
  const startedAt = performance.now()
  const step = (timestamp: number) => {
    const progress = Math.min(1, (timestamp - startedAt) / SANKEY_LAYOUT_ANIMATION_MS)
    window.scrollTo({
      top: startTop + distance * sankeyLayoutMotionProgress(progress),
      behavior: 'auto',
    })
    if (progress < 1) {
      viewportFollowFrame = window.requestAnimationFrame(step)
    } else {
      viewportFollowFrame = null
    }
  }
  viewportFollowFrame = window.requestAnimationFrame(step)
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

function statusText() {
  if (selectedSearchNodeId.value && graph.value) {
    const node = icd11SankeyGraphIndex(graph.value).nodeById.get(selectedSearchNodeId.value)
    if (node) return `搜索结果：${node.displayName}`
  }
  if (searchQuery.value.trim()) return `搜索：${searchQuery.value.trim()}`
  return selectedLevel1.value || '当前范围'
}

function displayPaths(baseGraph: Icd11SankeyGraph) {
  return summarizeDisplayPaths(baseGraph).paths
}

function summarizeDisplayPaths(baseGraph: Icd11SankeyGraph): DisplayPathSummary {
  const cacheKey = displayTransformKey()
  const cached = displaySummaryCache.get(baseGraph)?.get(cacheKey)
  if (cached) return cached
  const filteredPaths = sankeyScopeCandidates(
    baseGraph.paths,
    selectedLevel1.value,
    level1Scope.value,
    minWeight.value,
  )
  const limit = displayModeLimit(displayMode.value, filteredPaths.length, smartPathLimit.value)
  const limitedPaths = selectSankeyDisplayPaths(
    filteredPaths,
    selectedLevel1.value,
    level1Scope.value,
    limit,
  )
  const forcedPath = forcedSearchPathId.value
    ? (icd11SankeyGraphIndex(baseGraph).pathById.get(forcedSearchPathId.value) ?? null)
    : null
  const injected = ensureSearchTargetVisible(
    limitedPaths,
    selectedSearchNodeId.value,
    forcedPath,
    limit,
  )
  const paths = injected.paths
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
    injectedSearchPath: injected.injected,
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
  return [
    selectedLevel1.value,
    level1Scope.value,
    displayMode.value,
    String(minWeight.value),
    String(smartPathLimit.value),
    selectedSearchNodeId.value,
    forcedSearchPathId.value,
  ].join('\u001f')
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
  if (mode === 'smart') {
    return limit ? `智能精简 · 最多 ${limit}` : `智能精简 · 少于 ${smartPathLimit.value}`
  }
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
    const haystack = node.displayName.toLocaleLowerCase('zh-Hans-CN')
    if (haystack.includes(query)) seeds.add(node.name)
  }
  return seeds
}

function setChartHeight(
  baseGraph: Icd11SankeyGraph,
  resizeMode: 'defer' | 'immediate' | 'none' = 'defer',
) {
  const availableViewportHeight = Math.max(720, window.innerHeight - HEADER_HEIGHT)
  const maxNodes = Math.max(1, baseGraph.stats.maxNodes)
  const pathCount = baseGraph.paths.length
  const dense = pathCount > 200 || maxNodes > 90
  const medium = pathCount > 80 || maxNodes > 28
  const perNode = dense ? 22 : medium ? 28 : 16
  const extraSpace = dense ? 320 : medium ? 260 : 160
  const maxHeight = dense ? MAX_CHART_HEIGHT : medium ? 3000 : 1200
  const contentHeight = maxNodes * perNode + extraSpace
  const nextHeight = Math.max(availableViewportHeight, Math.min(maxHeight, contentHeight))
  const changed = nextHeight !== chartHeight.value
  chartHeight.value = nextHeight
  if (chartShellEl.value) chartShellEl.value.style.height = `${nextHeight}px`
  if (!changed || resizeMode === 'none') return
  if (resizeMode === 'immediate') {
    chart?.resize()
    updateUpstreamContextVisibility()
    return
  }
  void nextTick(() => {
    chart?.resize()
    scheduleRoutingBridgeGeometry()
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
  const wasMobile = isMobileViewport.value
  viewportHeight.value = window.innerHeight
  isMobileViewport.value = window.innerWidth <= MOBILE_BREAKPOINT
  if (wasMobile !== isMobileViewport.value) {
    mobileDrawerOpen.value = false
    if (displayMode.value === 'smart') render()
    if (isMobileViewport.value) maybeShowMobileSwipeHint()
  }
  applyChartLayout()
  updateUpstreamContextVisibility()
  if (readingGuideOpen.value) updateReadingGuidePosition()
}

function handleChartScroll(event: Event) {
  const scroller = event.currentTarget as HTMLElement
  chartScrollLeft.value = scroller.scrollLeft
  const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth)
  activeMobileStage.value = maxScroll
    ? Math.max(0, Math.min(4, Math.round((scroller.scrollLeft / maxScroll) * 4)))
    : 0
  if (scroller.scrollLeft > 4) dismissMobileSwipeHint()
}

function openDetailPanel() {
  if (isMobileViewport.value) mobileDrawerOpen.value = true
}

function openMobileOverview() {
  clearLockedState()
  detail.value = { kind: 'category' }
  mobileDrawerOpen.value = true
}

function closeMobileDrawer() {
  const shouldClearSelection = detail.value.kind !== 'category'
  mobileDrawerOpen.value = false
  if (shouldClearSelection) {
    clearLockedState()
    detail.value = { kind: 'category' }
    render()
  }
}

function scrollToMobileStage(index: number) {
  const scroller = chartScrollEl.value
  if (!scroller) return
  const safeIndex = Math.max(0, Math.min(4, index))
  const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth)
  activeMobileStage.value = safeIndex
  dismissMobileSwipeHint()
  scroller.scrollTo({ left: (maxScroll * safeIndex) / 4, behavior: 'smooth' })
}

function maybeShowMobileSwipeHint() {
  if (!isMobileViewport.value || !hasRenderableGraph.value) return
  try {
    if (window.sessionStorage.getItem(MOBILE_SWIPE_HINT_KEY)) return
  } catch {
    // Storage may be disabled; the hint still remains safely dismissible.
  }
  showMobileSwipeHint.value = true
  if (swipeHintTimer !== null) window.clearTimeout(swipeHintTimer)
  swipeHintTimer = window.setTimeout(dismissMobileSwipeHint, 4200)
}

function dismissMobileSwipeHint() {
  showMobileSwipeHint.value = false
  if (swipeHintTimer !== null) {
    window.clearTimeout(swipeHintTimer)
    swipeHintTimer = null
  }
  try {
    window.sessionStorage.setItem(MOBILE_SWIPE_HINT_KEY, 'seen')
  } catch {
    // The hint remains non-blocking when storage is unavailable.
  }
}

function applyChartLayout() {
  if (graph.value) setChartHeight(activeBaseGraph.value ?? graph.value, 'none')
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
  scheduleRoutingBridgeGeometry()
}

function handleWindowScroll() {
  updateUpstreamContextVisibility()
  if (readingGuideOpen.value) updateReadingGuidePosition()
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
  const steps: Array<{ label: string; value: string; note?: string }> = [
    { label: 'Level1', value: path.level1 },
    { label: 'Level2', value: path.level2 },
  ]
  if (path.level3) steps.push({ label: 'Level3', value: path.level3 })
  const drugNodeId = path.nodeIds[path.mappingLevel === 'Level3' ? 3 : 2]
  const prescriptionStatus = drugNodeId ? graph.value?.drugPrescriptions?.[drugNodeId] : undefined
  steps.push({
    label: '药物',
    value: path.drug,
    note: prescriptionStatus ? PRESCRIPTION_STATUS_LABELS[prescriptionStatus] : '',
  })
  steps.push({ label: '生物标记物', value: path.biomarker })
  return steps
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
  <main
    class="sankey-shell"
    :style="{ '--sankey-stage-top': sankeyHeaderHidden ? '0px' : '70px' }"
    :inert="pieModalOpen || undefined"
    @pointerdown.capture="handleSankeyWorkspaceInteraction"
    @keydown.capture="handleSankeyWorkspaceInteraction"
  >
    <PlatformHeader
      active="sankey"
      auto-hide-on-scroll
      @visibility-change="sankeyHeaderHidden = $event"
    />

    <form id="main-content" class="sankey-controls" tabindex="-1" @submit.prevent>
      <div class="control-field search-field">
        <span>五层搜索</span>
        <SankeyNodeSearch
          :model-value="searchQuery"
          :results="searchResults"
          :selected-node-id="selectedSearchNodeId"
          :disabled="isLoading || !hasRenderableGraph"
          @update:model-value="searchQuery = $event"
          @select="selectSearchResult"
          @clear="clearSearchSelection"
        />
      </div>

      <div class="control-field level-field">
        <span>ICD11_Level1</span>
        <SankeySelect
          :model-value="selectedLevel1"
          :options="level1SelectOptions"
          select-label="选择 ICD11 Level1"
          mobile-title="选择 ICD11 Level1"
          :disabled="isLoading || !hasRenderableGraph"
          @update:model-value="selectedLevel1 = String($event)"
        />
      </div>

      <fieldset class="scope-field">
        <legend class="field-label-row">
          <span>关联范围</span>
          <span
            class="control-help"
            tabindex="0"
            role="img"
            aria-label="关联范围说明：仅当前只显示所选 Level1 的路径；含关联会加入与当前 Level1 共享下游节点的相关路径。"
            data-tooltip="仅当前：只显示所选 Level1 的路径。含关联：加入与当前 Level1 共享下游节点的相关路径。"
            >?</span
          >
        </legend>
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

      <div class="control-field display-field">
        <span class="field-label-row">
          <span>显示模式</span>
          <span
            class="control-help"
            tabindex="0"
            role="img"
            aria-label="显示模式说明：全量显示所有候选路径；智能精简和 Top 模式按权重选择路径，含关联时预留约五分之一给关联分支。"
            data-tooltip="控制路径数量：全量显示所有候选路径；智能精简和 Top 模式按照权重减少路径数量。"
            >?</span
          >
        </span>
        <SankeySelect
          :model-value="displayMode"
          :options="DISPLAY_MODE_OPTIONS"
          select-label="选择显示模式"
          mobile-title="选择显示模式"
          :disabled="isLoading || !hasRenderableGraph"
          @update:model-value="displayMode = $event as Icd11SankeyDisplayMode"
        />
      </div>

      <div class="weight-reset-group">
        <div class="control-field compact-field">
          <span class="field-label-row">
            <span>最小权重</span>
            <span
              class="control-help"
              tabindex="0"
              role="img"
              aria-label="最小权重说明：只保留权重大于或等于所选阈值的路径，全部表示不设置权重门槛。"
              data-tooltip="只保留权重大于或等于所选阈值的路径；“全部”表示不设置权重门槛。"
              >?</span
            >
          </span>
          <SankeySelect
            :model-value="minWeight"
            :options="MIN_WEIGHT_OPTIONS"
            select-label="选择最小权重"
            mobile-title="选择最小权重"
            :disabled="isLoading || !hasRenderableGraph"
            @update:model-value="minWeight = Number($event)"
          />
        </div>
        <button
          class="control-button reset-button"
          type="button"
          :disabled="isLoading || !hasRenderableGraph"
          @click="resetView"
        >
          重置
        </button>
      </div>

      <div class="toolbar-actions" role="group" aria-label="图表操作">
        <button
          class="control-button mobile-overview-button"
          type="button"
          :disabled="isLoading || !hasRenderableGraph"
          @click="openMobileOverview"
        >
          查看概览
        </button>
        <button
          ref="sankeyGuideButton"
          class="control-button operation-guide-button"
          type="button"
          :disabled="isLoading || !hasRenderableGraph"
          aria-label="操作指引"
          title="操作指引"
          @click.stop="openSankeyOperationGuide('manual')"
        >
          <span aria-hidden="true">?</span>
        </button>
        <button
          class="control-button clear-lock-button"
          type="button"
          :disabled="
            isLoading || !hasRenderableGraph || !(lockedEdge || lockedPathId || currentFocus)
          "
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
          <strong>{{ lockLabel || '范围' }}</strong>
          <span>{{ lockText }}</span>
          <span v-if="displaySummaryText" class="filter-summary">{{ displaySummaryText }}</span>
          <button
            type="button"
            class="layout-motion-toggle"
            :class="{ active: promoteRelatedNodes }"
            :aria-pressed="promoteRelatedNodes"
            title="控制点击节点后，其关联节点是否动画置顶"
            @click="toggleRelatedNodePromotion"
          >
            <i aria-hidden="true"></i>
            <span>关联节点置顶</span>
          </button>
        </div>
        <SankeyStageNavigator
          :stages="MOBILE_STAGE_TITLES"
          :active-index="activeMobileStage"
          @select="scrollToMobileStage"
        />
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
        <p v-if="hasVisibleLevel2Route" id="sankey-level2-route-note" class="visually-hidden">
          未设置 Level3 的路径通过窄通道直接连接 Level2 与药物，不补造 Level3 节点。
        </p>
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
            <div
              ref="chartEl"
              class="sankey-chart"
              role="img"
              :aria-label="sankeyChartAriaLabel"
              :aria-describedby="hasVisibleLevel2Route ? 'sankey-level2-route-note' : undefined"
            ></div>
          </div>
        </div>
        <button
          v-if="showMobileSwipeHint && hasRenderableGraph"
          class="mobile-swipe-hint"
          type="button"
          @click="scrollToMobileStage(1)"
        >
          <span>向左滑动查看下游</span>
          <b aria-hidden="true">←</b>
        </button>
      </section>

      <SankeyMobileDrawer
        :mobile="isMobileViewport"
        :open="mobileDrawerOpen"
        :suspended="pieModalOpen"
        :title="mobileDrawerTitle"
        @close="closeMobileDrawer"
      >
        <aside
          class="side-panel"
          :class="{
            'compact-detail': isCompactDetail,
            'has-selection': Boolean(lockedEdge || lockedPathId || currentFocus),
          }"
          aria-label="ICD11 桑基图统计区"
        >
          <div class="overview-toolbar">
            <div
              v-if="detail.kind === 'category'"
              class="overview-scope-switch"
              role="group"
              aria-label="概览范围"
            >
              <button
                type="button"
                :class="{ 'is-active': overviewScope === 'current' }"
                :aria-pressed="overviewScope === 'current'"
                @click="overviewScope = 'current'"
              >
                当前范围
              </button>
              <button
                type="button"
                :class="{ 'is-active': overviewScope === 'global' }"
                :aria-pressed="overviewScope === 'global'"
                @click="overviewScope = 'global'"
              >
                全局概览
              </button>
            </div>
            <span v-else class="overview-context-title">{{ detailContextLabel }}</span>
            <button
              id="reading-guide"
              ref="readingGuideButton"
              type="button"
              class="reading-guide-toggle"
              :aria-expanded="readingGuideOpen"
              aria-controls="reading-guide-content"
              @click.stop="toggleReadingGuide"
            >
              图表说明 <span aria-hidden="true">{{ readingGuideOpen ? '−' : '?' }}</span>
            </button>
          </div>
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
              <h2>{{ overviewTitle }}</h2>
              <p class="overview-scope-note">{{ overviewScopeLabel }} · 显示条数裁剪前统计</p>
              <div v-if="statsSummaryItems.length" class="stats-summary" aria-label="当前类别统计">
                <span v-for="item in statsSummaryItems" :key="item.label">
                  <b>{{ item.label }}</b>
                  <strong>{{ item.value }}</strong>
                </span>
              </div>
            </header>
          </template>

          <template v-else-if="detail.kind === 'paths'">
            <section v-if="detail.edge" class="edge-detail-block" aria-label="流带详情">
              <header class="edge-detail-heading">
                <h2>{{ detail.title }}</h2>
              </header>
              <div class="edge-route" aria-label="流带起点和终点">
                <div>
                  <small>{{ EDGE_KIND_LABELS[detail.edge.sourceKind] }}</small>
                  <strong>{{ detail.edge.sourceLabel }}</strong>
                  <em
                    v-if="detail.edge.drug?.id === detail.edge.source"
                    :class="`is-${detail.edge.drug.prescriptionStatus}`"
                    >{{ PRESCRIPTION_STATUS_LABELS[detail.edge.drug.prescriptionStatus] }}</em
                  >
                </div>
                <span aria-hidden="true">→</span>
                <div>
                  <small>{{ EDGE_KIND_LABELS[detail.edge.targetKind] }}</small>
                  <strong>{{ detail.edge.targetLabel }}</strong>
                  <em
                    v-if="detail.edge.drug?.id === detail.edge.target"
                    :class="`is-${detail.edge.drug.prescriptionStatus}`"
                    >{{ PRESCRIPTION_STATUS_LABELS[detail.edge.drug.prescriptionStatus] }}</em
                  >
                </div>
              </div>
              <dl class="edge-metrics">
                <div>
                  <dt>占{{ EDGE_KIND_LABELS[detail.edge.sourceKind] }}流出</dt>
                  <dd>{{ formatPercent(detail.edge.sourceShare) }}</dd>
                </div>
                <div>
                  <dt>占{{ EDGE_KIND_LABELS[detail.edge.targetKind] }}流入</dt>
                  <dd>{{ formatPercent(detail.edge.targetShare) }}</dd>
                </div>
                <div>
                  <dt>涉及文献</dt>
                  <dd>{{ formatNumber(detail.edge.value) }}</dd>
                </div>
                <div>
                  <dt>聚合路径</dt>
                  <dd>{{ formatNumber(detail.paths.length) }}</dd>
                </div>
              </dl>
              <p v-if="detail.paths.length === 1" class="edge-path-context">
                <span>路径上下文</span>
                <strong>{{ pathText(shownDetailPaths[0]!) }}</strong>
              </p>
              <p v-else-if="detail.edge.associatedNodeCount" class="edge-path-context">
                <span>关联范围</span>
                <strong>{{ detail.edge.associatedNodeCount }} 个上下游节点</strong>
              </p>
            </section>
            <template v-else>
              <section
                class="detail-block"
                :class="{ 'single-path-block': detail.paths.length === 1 }"
              >
                <h3>{{ detail.title }}</h3>
                <dl class="detail-kv">
                  <div>
                    <dt>聚合路径</dt>
                    <dd>{{ formatNumber(detail.paths.length) }}</dd>
                  </div>
                  <div>
                    <dt>涉及文献</dt>
                    <dd>{{ formatNumber(detailPathSum) }}</dd>
                  </div>
                </dl>
              </section>
              <section v-if="detail.paths.length === 1" class="detail-block">
                <h3>
                  {{ shownDetailPaths[0]?.mappingLevel === 'Level2' ? '跨层路径' : '完整路径' }}
                </h3>
                <article
                  v-for="path in shownDetailPaths"
                  :key="path.pathId"
                  class="single-path-card"
                >
                  <ol class="single-path-steps">
                    <li v-for="step in pathSteps(path)" :key="`${path.pathId}-${step.label}`">
                      <span>{{ step.label }}</span>
                      <span class="single-path-step-value">
                        <strong>{{ step.value }}</strong>
                        <em v-if="step.note">{{ step.note }}</em>
                      </span>
                    </li>
                  </ol>
                  <footer>
                    <span>{{ formatNumber(path.weight) }} 篇文献</span>
                    <strong>占全部路径 {{ formatPercent(path.share) }}</strong>
                  </footer>
                </article>
              </section>
            </template>
            <PrescriptionRatio
              v-if="prescriptionSummary.total > 1"
              :summary="prescriptionSummary"
            />
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
          </template>
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
            <p class="pie-scope-note">
              {{ formatNumber(section.totalWeight) }} 权重，
              {{ section.id.endsWith('-level3') ? '有效 Level3 路径' : '完整统计范围' }}
            </p>
            <div v-if="!section.items.length" class="relation-empty-card">
              <strong>暂无可聚合关系</strong>
              <span>当前节点没有可用于该维度统计的关联路径。</span>
            </div>
            <div v-else-if="section.items.length === 1" class="relation-single-shell">
              <div
                class="relation-single-summary"
                :aria-label="`${section.items[0]?.name}，权重 ${formatNumber(section.items[0]?.value ?? 0)}，占比 ${formatPercent(section.items[0]?.share ?? 0)}`"
                tabindex="0"
                @mouseenter="handleRelationItemMouseOver(section, section.items[0]!)"
                @mouseleave="scheduleRestoreHighlight"
                @focus="handleRelationItemMouseOver(section, section.items[0]!)"
                @blur="scheduleRestoreHighlight"
              >
                <i
                  :style="{ backgroundColor: section.items[0]?.itemStyle.color }"
                  aria-hidden="true"
                ></i>
                <span class="relation-legend-name">
                  {{ section.items[0]?.name }}
                  <small
                    v-if="section.id.endsWith('-drug') && singlePrescriptionLabel"
                    class="inline-prescription-label"
                    >{{ singlePrescriptionLabel }}</small
                  >
                </span>
                <strong>{{ formatNumber(section.items[0]?.value ?? 0) }} 权重</strong>
                <em>{{ formatPercent(section.items[0]?.share ?? 0) }}</em>
              </div>
              <PrescriptionRatio
                v-if="
                  section.id.endsWith('-drug') &&
                  detail.kind !== 'paths' &&
                  prescriptionSummary.total > 1
                "
                :summary="prescriptionSummary"
              />
            </div>
            <template v-else>
              <div class="drug-share-chart-shell">
                <div class="relation-pie-plot">
                  <div
                    :ref="(element) => setPieChartRef(section.id, element)"
                    class="drug-share-chart"
                    :aria-label="`${section.ariaLabel}。扇区标注权重和占比。`"
                  ></div>
                  <div class="drug-share-center" aria-hidden="true">
                    <strong>{{ section.sourceItemCount }}</strong>
                    <span>{{ section.centerLabel }}</span>
                    <em v-if="section.isCollapsed">Top {{ TOP_RELATION_PIE_ITEMS }} + 其他</em>
                    <em v-else>{{ formatNumber(section.totalWeight) }} 权重</em>
                  </div>
                </div>
                <PrescriptionRatio
                  v-if="section.id.endsWith('-drug') && detail.kind !== 'paths'"
                  :summary="prescriptionSummary"
                />
                <ul class="relation-pie-legend" aria-label="颜色图例，仅列名称">
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
                    <span class="relation-legend-name">{{ item.name }}</span>
                  </li>
                </ul>
              </div>
            </template>
          </section>
        </aside>
      </SankeyMobileDrawer>
    </section>
    <Teleport to="body">
      <div
        v-if="pieModalOpen && activePieSection"
        class="pie-modal-backdrop"
        role="presentation"
        @click.self="closePieModal"
      >
        <section
          ref="pieDialogEl"
          class="pie-modal"
          role="dialog"
          aria-modal="true"
          :aria-label="`${activePieSection.title}放大查看`"
        >
          <header>
            <div>
              <h2>{{ activePieSection.title }}</h2>
              <p>{{ detail.kind === 'node' ? detail.title : overviewScopeLabel }}</p>
            </div>
            <button type="button" aria-label="关闭放大查看" @click="closePieModal">关闭</button>
          </header>
          <div class="pie-modal-body">
            <div class="pie-modal-chart-shell">
              <div class="relation-pie-plot">
                <div
                  ref="modalPieChartEl"
                  class="pie-modal-chart"
                  :aria-label="`${activePieSection.ariaLabel}放大图。扇区标注权重和占比。`"
                ></div>
                <div class="pie-modal-center" aria-hidden="true">
                  <strong>{{ activePieSection.sourceItemCount }}</strong>
                  <span>{{ activePieSection.centerLabel }}</span>
                  <em v-if="activePieSection.isCollapsed"
                    >Top {{ TOP_RELATION_PIE_ITEMS }} + 其他</em
                  >
                  <em v-else>{{ formatNumber(activePieSection.totalWeight) }} 权重</em>
                </div>
              </div>
              <PrescriptionRatio
                v-if="activePieSection.id.endsWith('-drug')"
                :summary="prescriptionSummary"
              />
              <ul class="relation-pie-legend pie-modal-legend" aria-label="颜色图例，仅列名称">
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
                  <span class="relation-legend-name">{{ item.name }}</span>
                </li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </Teleport>
    <Teleport to="body">
      <div
        v-if="readingGuideOpen"
        class="reading-guide-layer"
        aria-hidden="false"
        @click="dismissReadingGuide"
      >
        <section
          id="reading-guide-content"
          ref="readingGuidePanel"
          class="reading-guide-popover"
          :style="readingGuidePopoverStyle"
          role="dialog"
          aria-modal="false"
          aria-label="图表说明"
        >
          <header><strong>图表说明</strong><span>点击任意位置关闭</span></header>
          <dl>
            <div>
              <dt>层级与颜色</dt>
              <dd>
                沿疾病分类 → 药物 → 生物标记物阅读。节点为蓝色，流带按 Level2
                着色；浅色轨道只辅助定位。
              </dd>
            </div>
            <div>
              <dt>权重与映射</dt>
              <dd>
                带宽表示涉及文献数权重，相同有效关系合并。缺少 Level3
                的路径通过窄通道直接连接药物，不补造 Level3。
              </dd>
            </div>
            <div>
              <dt>当前范围与全局</dt>
              <dd>
                当前范围跟随分类、关联范围与最小权重，使用显示条数裁剪前的路径；全局使用全部路径。搜索用于高亮和定位。
              </dd>
            </div>
            <div>
              <dt>Top 7 与其他</dt>
              <dd>按路径权重汇总，前七项单列，其余合并为“其他”。Level3 只统计真实 Level3 路径。</dd>
            </div>
            <div>
              <dt>处方属性比例</dt>
              <dd>
                按完整范围去重药物数计算，包含“其他”。同名药物同时有处方和非处方记录计为冲突，没有明确记录计为未知。
              </dd>
            </div>
            <div>
              <dt>关联与操作</dt>
              <dd>
                含关联沿共享下游节点展开其他分类，有限条数为关联预留约五分之一。悬停预览、单击锁定；环图可放大，手机可横向滑动桑基图。
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </Teleport>
    <div class="sankey-operation-guide-host" aria-live="polite">
      <OperationGuide
        :open="sankeyGuideOpen"
        :step="sankeyGuideStep"
        :steps="SANKEY_OPERATION_GUIDE_STEPS"
        :return-focus-to="sankeyGuideButton"
        @previous="previousSankeyGuideStep"
        @next="nextSankeyGuideStep"
        @skip="closeSankeyOperationGuide"
        @finish="closeSankeyOperationGuide"
      />
    </div>
  </main>
</template>

<style scoped>
.sankey-operation-guide-host {
  position: fixed;
  z-index: 70;
  top: var(--platform-header-height, 68px);
  right: 0;
  bottom: 0;
  left: 0;
  pointer-events: none;
}

.sankey-operation-guide-host :deep(.operation-guide) {
  pointer-events: auto;
}

.sankey-controls .toolbar-actions .operation-guide-button {
  min-width: 38px;
  width: 38px;
  padding: 0;
  border-color: var(--sankey-line-strong);
  color: #3e566b;
  background: #ffffff;
  font-size: 15px;
  font-weight: 800;
}

.sankey-controls .toolbar-actions .operation-guide-button:hover,
.sankey-controls .toolbar-actions .operation-guide-button:focus-visible {
  border-color: #5f84b3;
  color: #24558d;
  background: #eef4ff;
}

@media (max-width: 760px) {
  .sankey-operation-guide-host {
    top: 56px;
  }
}

.sankey-shell {
  min-height: 100vh;
  background: #fcfcfa;
  color: #20242a;
  font-family: var(--platform-font-family, 'Microsoft YaHei', '微软雅黑', Arial, sans-serif);
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

.sankey-controls :disabled {
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
  font-family: var(--platform-font-family, 'Microsoft YaHei', '微软雅黑', Arial, sans-serif);
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
  position: relative;
  z-index: 12;
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
  font-family: var(--platform-font-family, 'Microsoft YaHei', '微软雅黑', Arial, sans-serif);
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
  font-family: var(--platform-font-family, 'Microsoft YaHei', '微软雅黑', Arial, sans-serif);
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

.module-switch-link {
  border: 1px solid var(--sankey-border);
  border-radius: 6px;
  background: #ffffff;
  box-shadow: none;
}

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
    164px
    minmax(190px, 260px)
    minmax(190px, 220px)
    minmax(214px, 1fr);
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

.field-label-row {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.control-help {
  position: relative;
  z-index: 4;
  display: inline-grid;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  place-items: center;
  border: 1px solid #9eafbf;
  border-radius: 50%;
  color: #64788b;
  background: #ffffff;
  cursor: help;
  font-size: 10px;
  font-weight: 750;
  line-height: 1;
  box-sizing: border-box;
}

.control-help::after {
  position: absolute;
  top: calc(100% + 8px);
  right: -5px;
  width: 228px;
  padding: 8px 10px;
  border: 1px solid #cbd6e1;
  border-radius: 5px;
  content: attr(data-tooltip);
  color: #32485c;
  background: #ffffff;
  box-shadow: 0 8px 22px rgba(21, 52, 72, 0.14);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.55;
  opacity: 0;
  pointer-events: none;
  text-align: left;
  transform: translateY(3px);
  transition:
    opacity 0.14s ease,
    transform 0.14s ease;
  visibility: hidden;
  white-space: normal;
}

.control-help:hover,
.control-help:focus-visible {
  border-color: #5f84b3;
  color: #24558d;
  background: #eef4ff;
  outline: none;
}

.control-help:hover::after,
.control-help:focus-visible::after {
  opacity: 1;
  transform: translateY(0);
  visibility: visible;
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

.control-field select {
  appearance: none;
  padding-right: 32px;
  background-color: #ffffff;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='m2 2 4 4 4-4' fill='none' stroke='%23566879' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 11px center;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease,
    box-shadow 0.15s ease;
}

.control-field select:hover:not(:disabled) {
  border-color: #8398ac;
  background-color: #fbfdff;
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

.weight-reset-group {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(96px, 1fr) 70px;
  align-items: end;
  gap: 6px;
}

.weight-reset-group .compact-field {
  min-width: 0;
  max-width: none;
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
  padding-left: 10px;
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
  font-family: var(--platform-font-family, 'Microsoft YaHei', '微软雅黑', Arial, sans-serif);
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

.sankey-controls :disabled {
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
  .scope-field,
  .display-field,
  .weight-reset-group,
  .toolbar-actions {
    grid-column: 1 / -1;
  }

  .weight-reset-group {
    grid-template-columns: minmax(0, 1fr) 78px;
  }

  .compact-field {
    max-width: none;
  }

  .toolbar-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
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
      minmax(160px, 190px)
      minmax(180px, 0.8fr)
      minmax(190px, 220px);
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

<style scoped>
.control-field > .sankey-select {
  width: 100%;
}

.search-field > .sankey-node-search {
  width: 100%;
}

@media (min-width: 1321px) {
  .sankey-controls {
    grid-template-columns:
      minmax(230px, 270px)
      minmax(280px, 1.15fr)
      150px
      minmax(180px, 220px)
      minmax(180px, 210px)
      minmax(200px, auto);
  }
}

@media (min-width: 721px) and (max-width: 1320px) {
  .sankey-controls {
    grid-template-columns:
      minmax(230px, 1fr)
      minmax(280px, 1.2fr)
      150px
      minmax(180px, 220px);
  }

  .weight-reset-group {
    grid-column: 1 / 2;
  }

  .toolbar-actions {
    grid-column: 2 / -1;
    justify-self: end;
    padding-top: 7px;
    padding-left: 0;
    border-top: 1px solid var(--sankey-border);
    border-left: 0;
  }
}

.mobile-overview-button,
.mobile-swipe-hint {
  display: none;
}

.overview-scope-switch {
  width: fit-content;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px;
  margin-bottom: 14px;
  padding: 3px;
  border: 1px solid #d8e0e7;
  border-radius: 7px;
  background: #f2f5f7;
}

.overview-scope-switch button {
  min-height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #687987;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

.overview-scope-switch button:hover {
  color: #315f88;
}

.overview-scope-switch button.is-active {
  background: #fff;
  color: #245f8e;
  box-shadow: 0 1px 3px rgba(28, 55, 76, 0.1);
}

.overview-scope-switch button:focus-visible {
  outline: 2px solid #2566d4;
  outline-offset: 1px;
}

@media (max-width: 720px) {
  .mobile-overview-button {
    display: inline-flex;
  }

  .toolbar-actions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .search-field {
    grid-column: 1 / -1;
  }

  .toolbar-actions .control-button {
    min-width: 0;
    padding-right: 8px;
    padding-left: 8px;
    font-size: 12px;
  }

  .stage-axis {
    display: none !important;
  }

  .chart-panel {
    position: relative;
  }

  .mobile-swipe-hint {
    position: absolute;
    z-index: 8;
    top: 112px;
    right: 14px;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px 11px;
    border: 1px solid rgba(102, 136, 169, 0.34);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.94);
    color: #315f88;
    box-shadow: 0 5px 16px rgba(31, 61, 84, 0.14);
    font: inherit;
    font-size: 11px;
    font-weight: 650;
    cursor: pointer;
    backdrop-filter: blur(5px);
  }

  .mobile-swipe-hint b {
    font-size: 15px;
    line-height: 1;
  }

  .overview-scope-switch {
    position: sticky;
    top: 0;
    z-index: 2;
    width: 100%;
    margin: 0 0 14px;
  }

  .overview-scope-switch button {
    min-height: 34px;
  }
}

/* Keep the plot and the readable legend in separate flow rows at every viewport size. */
.drug-share-chart-shell,
.pie-modal-chart-shell {
  display: block;
  position: relative;
  height: auto;
  min-height: 0;
  padding: 0 12px 12px;
  overflow: visible;
}
.relation-pie-plot {
  position: relative;
  width: 100%;
  height: 240px;
}
.pie-modal-chart-shell .relation-pie-plot {
  height: 300px;
}
.drug-share-chart,
.pie-modal-chart {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
}
.drug-share-center,
.pie-modal-center {
  top: 50%;
  left: 50%;
  width: 44%;
  transform: translate(-50%, -50%);
}
.relation-pie-legend,
.pie-modal-legend {
  position: static;
  inset: auto;
  display: grid;
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 0;
  gap: 0;
  border: 0;
  background: transparent;
  box-sizing: border-box;
}
.relation-legend-heading {
  display: grid;
  width: 100%;
  box-sizing: border-box;
  grid-template-columns: minmax(0, 1fr) 5.5ch 6ch;
  gap: 10px;
  padding: 0 0 8px 17px;
  border-bottom: 1px solid #dce5eb;
  font-size: 11px;
  color: #657985;
}
.relation-legend-heading > span:not(:first-child) {
  text-align: right;
}
.relation-pie-legend li {
  display: grid;
  grid-template-columns: 7px minmax(0, 1fr) 5.5ch 6ch;
  align-items: start;
  gap: 10px;
  min-height: 0;
  padding: 9px 0;
  border-bottom: 1px solid #e6edf1;
  font-size: 12px;
  line-height: 1.5;
  white-space: normal;
}
.relation-pie-legend li:last-child {
  border-bottom: 0;
}
.relation-pie-legend i {
  width: 7px;
  height: 7px;
  margin-top: 5px;
}
.relation-pie-legend li > span.relation-legend-name {
  min-width: 0;
  overflow: visible;
  text-overflow: clip;
  white-space: normal;
  overflow-wrap: anywhere;
}
.relation-pie-legend li > span.relation-legend-value,
.relation-pie-legend li > span.relation-legend-percent {
  overflow: visible;
  white-space: nowrap;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: #173247;
}
.pie-modal .relation-pie-legend li {
  font-size: 13px;
  padding: 10px 0;
}
.pie-modal .relation-legend-heading {
  font-size: 12px;
}
@media (max-width: 720px) {
  .pie-modal-chart-shell .relation-pie-plot {
    height: 240px;
  }
  .relation-pie-legend li,
  .pie-modal .relation-pie-legend li {
    gap: 8px;
    font-size: 12px;
  }
  .relation-legend-heading {
    gap: 8px;
    padding-left: 15px;
  }
}

.pie-modal-backdrop {
  z-index: 3200;
  --sankey-ink: #17212b;
  --sankey-muted: #667382;
  --sankey-border: #d7dee6;
  --sankey-line-strong: #aeb9c6;
  --sankey-blue: #2566d4;
  font-family: var(--platform-font-family, 'Microsoft YaHei', '微软雅黑', Arial, sans-serif);
}

.overview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: nowrap;
  gap: 10px;
  padding-bottom: 14px;
}
.overview-toolbar .overview-scope-switch {
  width: auto;
  flex: 0 1 auto;
  margin: 0;
}
.overview-toolbar .overview-scope-switch button {
  min-width: 0;
  padding: 7px 9px;
  font-size: 12px;
}
.reading-guide-toggle {
  flex: 0 0 auto;
  display: inline-flex;
  gap: 5px;
  align-items: center;
  padding: 6px 0 6px 8px;
  border: 0;
  background: transparent;
  color: #456576;
  font-size: 12px;
  cursor: pointer;
  scroll-margin-top: 120px;
}
.reading-guide-toggle > span {
  display: inline-grid;
  place-items: center;
  width: 15px;
  height: 15px;
  border: 1px solid #8094a0;
  border-radius: 50%;
  font-size: 11px;
  line-height: 1;
}
.reading-guide-toggle:hover,
.reading-guide-toggle[aria-expanded='true'] {
  color: #245f8e;
}
.reading-guide-toggle:focus-visible {
  outline: 2px solid #245f8e;
  outline-offset: 3px;
  border-radius: 2px;
}
.overview-context-title {
  font-size: 13px;
  color: #456576;
}
.overview-scope-note,
.side-panel .pie-scope-note {
  color: #657985;
  font-size: 12px;
  line-height: 1.6;
  margin: 8px 0 12px;
}

.stage-axis {
  top: var(--sankey-stage-top, 70px);
  transition: top 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.reading-guide-layer {
  position: fixed;
  inset: 0;
  z-index: 3150;
  background: transparent;
  touch-action: pan-y;
}

.reading-guide-popover {
  position: fixed;
  box-sizing: border-box;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 14px 16px 16px;
  border: 1px solid rgba(118, 143, 157, 0.58);
  border-radius: 2px;
  color: #173247;
  background: rgba(247, 251, 252, 0.9);
  box-shadow: 0 16px 42px rgba(24, 54, 75, 0.16);
  backdrop-filter: blur(14px) saturate(1.08);
  -webkit-backdrop-filter: blur(14px) saturate(1.08);
  animation: reading-guide-in 160ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.reading-guide-popover header {
  position: sticky;
  top: -14px;
  z-index: 1;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin: -2px 0 10px;
  padding: 2px 0 9px;
  border-bottom: 1px solid rgba(117, 141, 154, 0.3);
  background: rgba(247, 251, 252, 0.92);
  backdrop-filter: blur(14px);
}

.reading-guide-popover header strong {
  font-size: 14px;
  font-weight: 700;
}

.reading-guide-popover header span {
  color: #718490;
  font-size: 10px;
  white-space: nowrap;
}

.reading-guide-popover dl {
  display: grid;
  gap: 10px;
  margin: 0;
}

.reading-guide-popover dl > div {
  padding-top: 10px;
  border-top: 1px solid rgba(132, 153, 166, 0.2);
}

.reading-guide-popover dl > div:first-child {
  padding-top: 0;
  border-top: 0;
}

.reading-guide-popover dt {
  font-size: 12px;
  font-weight: 700;
}

.reading-guide-popover dd {
  margin: 3px 0 0;
  color: #627784;
  font-size: 12px;
  line-height: 1.58;
}

@keyframes reading-guide-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .stage-axis,
  .reading-guide-popover {
    transition: none;
    animation: none;
  }
}

.relation-pie-legend.drug-ranking-list li {
  grid-template-columns: 18px 7px minmax(0, 1fr) 5.5ch 6ch;
}
.relation-pie-legend li > span.relation-rank {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 1px solid #d9e0e5;
  border-radius: 3px;
  box-sizing: border-box;
  background: #edf1f4;
  color: #61717e;
  font-size: 10px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.relation-legend-heading.drug-ranking-heading {
  padding-left: 28px;
}
.drug-ranking-heading > span:first-child {
  color: #334d60;
  font-weight: 600;
}
.layout-motion-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  margin-left: auto;
  padding: 2px 8px;
  border: 1px solid #cfdadd;
  border-radius: 999px;
  background: #ffffff;
  color: #61747c;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  transition:
    border-color 180ms ease,
    color 180ms ease,
    background 180ms ease,
    transform 180ms ease;
}
.layout-motion-toggle:hover,
.layout-motion-toggle:focus-visible {
  border-color: #2a7d79;
  color: #17645f;
  outline: none;
}
.layout-motion-toggle:active {
  transform: scale(0.98);
}
.layout-motion-toggle i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #a8b5ba;
  box-shadow: 0 0 0 3px rgba(168, 181, 186, 0.16);
  transition:
    background 180ms ease,
    box-shadow 180ms ease;
}
.layout-motion-toggle.active i {
  background: #167c72;
  box-shadow: 0 0 0 3px rgba(22, 124, 114, 0.16);
}
.flow-band-summary {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid #dbe7e7;
  border-radius: 4px;
  background: #f3f8f8;
}
.flow-band-route {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 26px minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  padding-bottom: 10px;
  border-bottom: 1px solid #dbe7e7;
  color: #516a75;
  font-size: 11px;
}
.flow-band-route i {
  height: 2px;
  background: linear-gradient(90deg, #5796a1, #245f8e);
}
.flow-band-route strong {
  color: #173247;
  text-align: right;
}
.flow-band-summary dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
  margin: 11px 0 0;
}
.flow-band-summary dl div {
  min-width: 0;
}
.flow-band-summary dt {
  color: #657985;
  font-size: 10px;
}
.flow-band-summary dd {
  margin: 3px 0 0;
  color: #173247;
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 720px) {
  .layout-motion-toggle span {
    display: none;
  }
  .layout-motion-toggle {
    width: 26px;
    justify-content: center;
    padding: 2px;
  }
  .relation-legend-heading.drug-ranking-heading {
    padding-left: 26px;
  }
}

.relation-single-shell {
  padding: 0 12px 12px;
}

.relation-single-summary {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto 5.5ch;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
  border-top: 1px solid #dce5eb;
  border-bottom: 1px solid #dce5eb;
  color: #173247;
  font-size: 12px;
  line-height: 1.5;
}

.relation-single-summary:focus-visible {
  outline: 2px solid #245f8e;
  outline-offset: 3px;
}

.relation-single-summary > i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.relation-single-summary > span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.relation-single-summary > strong,
.relation-single-summary > em {
  white-space: nowrap;
  text-align: right;
  font-style: normal;
  font-variant-numeric: tabular-nums;
}

.relation-single-summary > strong {
  font-size: 11px;
  font-weight: 650;
}

.relation-single-summary > em {
  color: #526b7a;
  font-size: 11px;
}

.relation-single-shell .prescription-ratio {
  margin-top: 14px;
}

.relation-pie-plot {
  height: 260px;
}

.pie-modal-chart-shell .relation-pie-plot {
  height: 330px;
}

.drug-share-center,
.pie-modal-center {
  width: 34%;
}

.relation-pie-legend,
.pie-modal-legend {
  gap: 5px;
  padding-top: 9px;
  border-top: 1px solid #dce5eb;
}

.relation-pie-legend li,
.pie-modal .relation-pie-legend li {
  grid-template-columns: 8px minmax(0, 1fr);
  gap: 9px;
  padding: 5px 0;
  border-bottom: 0;
  font-size: 12px;
  line-height: 1.45;
}

.relation-pie-legend i,
.pie-modal .relation-pie-legend i {
  width: 8px;
  height: 8px;
  margin-top: 4px;
  border-radius: 2px;
}

.pie-modal-legend {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 28px;
}

@media (max-width: 720px) {
  .relation-single-summary {
    grid-template-columns: 8px minmax(0, 1fr) auto 5.2ch;
    gap: 8px;
  }

  .pie-modal-chart-shell .relation-pie-plot {
    height: 280px;
  }

  .pie-modal-legend {
    grid-template-columns: 1fr;
  }
}

/* Final academic-density pass: compact controls and contextual flow-band details. */
.sankey-controls {
  grid-template-columns:
    minmax(280px, 1.45fr)
    minmax(220px, 1.15fr)
    176px
    190px
    minmax(172px, 0.72fr)
    auto;
  column-gap: 12px;
  row-gap: 9px;
  padding: 10px clamp(18px, 1.6vw, 30px) 11px;
  box-shadow: 0 3px 10px rgba(21, 52, 72, 0.035);
}

.sankey-controls :deep(.sankey-node-search input),
.sankey-controls :deep(.sankey-select-trigger),
.sankey-controls .scope-segmented,
.sankey-controls .control-button {
  min-height: 38px;
  border-radius: 4px;
  box-shadow: none;
}

.sankey-controls .scope-segmented span {
  border-radius: 2px;
}

.sankey-controls .control-button:active,
.sankey-controls :deep(.sankey-select-trigger:active) {
  transform: translateY(1px);
}

.toolbar-actions {
  gap: 7px;
  padding-left: 12px;
  border-left-color: #dce4e9;
}

.sankey-controls .toolbar-actions .operation-guide-button {
  border-radius: 4px;
}

.sankey-main {
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 10px;
  padding: 10px 14px 18px;
}

.chart-panel,
.side-panel {
  border-radius: 4px;
  box-shadow: 0 5px 18px rgba(21, 52, 72, 0.045);
}

.side-panel,
.side-panel.has-selection {
  padding: 13px 14px 15px;
  border-color: var(--sankey-border);
  box-shadow: 0 5px 18px rgba(21, 52, 72, 0.045);
}

.overview-toolbar {
  padding-bottom: 9px;
}

.overview-context-title {
  color: #314c5f;
  font-size: 12px;
  font-weight: 700;
}

.lock-bar,
.lock-bar.has-lock {
  min-height: 33px;
  gap: 4px 8px;
  padding: 5px 14px;
  border-left-width: 0;
  background: #ffffff;
  box-shadow: none;
}

.lock-bar.has-lock {
  border-bottom-color: #d7e5e3;
  background: #f5faf9;
}

.lock-bar strong,
.lock-bar.has-lock strong {
  color: #284759;
  font-size: 11px;
  font-weight: 700;
}

.lock-bar > span {
  font-size: 11px;
}

.filter-summary::before {
  margin-right: 8px;
  color: #9aa7ad;
  content: '/';
}

.layout-motion-toggle {
  min-height: 23px;
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 10px;
}

.edge-detail-block {
  padding: 10px 0 0;
  border-top: 1px solid #dce5e9;
}

.edge-detail-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 11px;
}

.edge-detail-heading h2 {
  margin: 0;
  color: #173247;
  font-size: 16px;
  line-height: 1.35;
}

.edge-route {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 22px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 10px 0 12px;
  border-top: 1px solid #e3eaee;
  border-bottom: 1px solid #e3eaee;
}

.edge-route > div {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px 6px;
}

.edge-route > div:last-child {
  justify-content: flex-end;
  text-align: right;
}

.edge-route small {
  width: 100%;
  color: #70838f;
  font-size: 9px;
  font-weight: 650;
}

.edge-route strong {
  min-width: 0;
  color: #173247;
  font-size: 12px;
  font-weight: 720;
  overflow-wrap: anywhere;
}

.edge-route > span {
  color: #78909d;
  font-size: 16px;
  text-align: center;
}

.edge-route em,
.inline-prescription-label,
.single-path-step-value em {
  padding: 1px 5px;
  border: 1px solid #bdd4df;
  border-radius: 3px;
  color: #356579;
  background: #f4f8fa;
  font-size: 9px;
  font-style: normal;
  font-weight: 650;
  line-height: 1.45;
  white-space: nowrap;
}

.edge-route em.is-prescription,
.inline-prescription-label {
  border-color: #a9c7df;
  color: #245f8e;
  background: #f2f7fb;
}

.edge-route em.is-nonprescription {
  border-color: #aed4cd;
  color: #226f68;
  background: #f1f8f6;
}

.edge-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 18px;
  margin: 0;
}

.edge-metrics > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 0;
  border-bottom: 1px solid #e6ecef;
}

.edge-metrics dt {
  color: #657985;
  font-size: 10px;
  line-height: 1.4;
}

.edge-metrics dd {
  margin: 0;
  color: #173247;
  font-size: 13px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}

.edge-path-context {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  gap: 9px;
  margin: 10px 0 0;
  color: #697d89;
  font-size: 10px;
  line-height: 1.55;
}

.edge-path-context strong {
  color: #3c5668;
  font-size: 10px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.single-path-step-value {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 4px 6px;
  text-align: right;
}

.relation-single-summary .relation-legend-name {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 6px;
}

.relation-pie-plot {
  height: 248px;
}

.drug-share-center {
  top: 54%;
}

.pie-modal-center {
  top: 53%;
}

:global(.sankey-tip--node) {
  width: min(360px, calc(100vw - 28px));
}

:global(.sankey-tip__node-main) {
  grid-template-columns: auto minmax(128px, 1fr) auto;
  align-items: start;
}

:global(.sankey-tip__node-main > strong) {
  overflow: visible;
  text-overflow: clip;
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.45;
}

@media (max-width: 1380px) and (min-width: 1181px) {
  .sankey-controls {
    grid-template-columns: repeat(12, minmax(0, 1fr));
  }

  .sankey-controls .search-field {
    grid-column: span 4;
  }

  .sankey-controls .level-field {
    grid-column: span 3;
  }

  .sankey-controls .scope-field {
    grid-column: span 2;
  }

  .sankey-controls .display-field {
    grid-column: span 3;
  }

  .weight-reset-group {
    grid-column: 7 / span 3;
  }

  .toolbar-actions {
    grid-column: 10 / span 3;
  }
}

@media (max-width: 1180px) and (min-width: 721px) {
  .sankey-controls {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .sankey-main {
    grid-template-columns: minmax(0, 1fr);
  }

  .side-panel {
    position: static;
    max-height: none;
  }
}

@media (max-width: 720px) {
  .sankey-controls {
    grid-template-columns: minmax(0, 1fr);
    gap: 9px;
    padding: 10px 12px 12px;
  }

  .sankey-main {
    grid-template-columns: minmax(0, 1fr);
    padding: 8px;
  }

  .edge-metrics {
    gap: 0 12px;
  }

  .edge-route strong {
    font-size: 11px;
  }
}
</style>
