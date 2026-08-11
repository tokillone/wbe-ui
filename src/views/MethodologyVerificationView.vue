<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'

import BrandMark from '../components/BrandMark.vue'
import { fetchMethodologyData } from '../services/methodology'
import type {
  MethodologyData,
  MethodologyFilterState,
  MethodologyMode,
  SamplingMethodMeta,
} from '../types/methodology'
import {
  DEFAULT_METHODOLOGY_FILTERS,
  METHODOLOGY_COLORS,
  aggregate,
  buildAnalysisCoverage,
  buildCountryCoverage,
  buildSamplingAudit,
  buildSamplingGroups,
  countRows,
  filterMethodologyRows,
  modeUnitLabel,
  type AggregateItem,
  type AnalysisCoverageItem,
  type SamplingClassItem,
  type SamplingMethodItem,
} from '../utils/methodologyVerification'

type FilterKey = Exclude<keyof MethodologyFilterState, 'mode'>
type SamplingFocus =
  | { kind: 'method'; item: SamplingMethodItem }
  | { kind: 'class'; item: SamplingClassItem }

interface FilterDefinition {
  key: FilterKey
  label: string
  allLabel: string
  optionKey?: keyof MethodologyData['options']
  advanced?: boolean
  kind?: 'search' | 'select'
}

interface DonutSegment<T> {
  item: T
  color: string
  start: number
  end: number
  path: string
  fullCircle: boolean
}

const filterDefinitions: FilterDefinition[] = [
  { key: 'query', label: '关键词', allLabel: '', kind: 'search' },
  { key: 'targetClass', label: '目标类别', allLabel: '全部目标类别', optionKey: 'targetClass' },
  { key: 'country', label: '国家/地区', allLabel: '全部国家/地区', optionKey: 'country' },
  { key: 'samplingClass', label: '采样主类', allLabel: '全部采样主类', optionKey: 'samplingClass' },
  {
    key: 'samplingStandard',
    label: '标准采样方法',
    allLabel: '全部标准采样方法',
    optionKey: 'samplingStandard',
  },
  {
    key: 'category',
    label: '物质类别',
    allLabel: '全部物质类别',
    optionKey: 'category',
    advanced: true,
  },
  {
    key: 'prescription',
    label: '处方属性',
    allLabel: '全部处方属性',
    optionKey: 'prescription',
    advanced: true,
  },
  {
    key: 'sampleObject',
    label: '采样对象',
    allLabel: '全部采样对象',
    optionKey: 'sampleObject',
    advanced: true,
  },
  {
    key: 'proportion',
    label: '比例方式',
    allLabel: '全部比例方式',
    optionKey: 'proportion',
    advanced: true,
  },
  {
    key: 'duration',
    label: '采样/部署时长',
    allLabel: '全部时长',
    optionKey: 'duration',
    advanced: true,
  },
  {
    key: 'passiveSampler',
    label: '被动采样器',
    allLabel: '全部采样器类型',
    optionKey: 'passiveSampler',
    advanced: true,
  },
]

const primaryFilters = filterDefinitions.filter((item) => !item.advanced)
const advancedFilters = filterDefinitions.filter((item) => item.advanced)
const data = shallowRef<MethodologyData | null>(null)
const isLoading = ref(true)
const loadError = ref('')
const isCompactLayout = ref(false)
const advancedOpen = ref(false)
const filters = reactive<MethodologyFilterState>({ ...DEFAULT_METHODOLOGY_FILTERS })
const activeSamplingFocus = ref<SamplingFocus | null>(null)
const activePrescription = ref('')
const activeAnalysis = ref('')
const tooltip = reactive({
  visible: false,
  x: 0,
  y: 0,
  title: '',
  lines: [] as string[],
})

const formatNumber = (value: number) => Number(value || 0).toLocaleString('zh-CN')

function polar(cx: number, cy: number, radius: number, angle: number) {
  const radian = ((angle - 90) * Math.PI) / 180
  return { x: cx + radius * Math.cos(radian), y: cy + radius * Math.sin(radian) }
}

function arcPath(cx: number, cy: number, radius: number, start: number, end: number) {
  const startPoint = polar(cx, cy, radius, end)
  const endPoint = polar(cx, cy, radius, start)
  const largeArc = end - start <= 180 ? 0 : 1
  return `M ${startPoint.x} ${startPoint.y} A ${radius} ${radius} 0 ${largeArc} 0 ${endPoint.x} ${endPoint.y}`
}

function buildDonutSegments<T extends { value: number }>(
  items: T[],
  radius: number,
  colors: string[],
) {
  const total = items.reduce((sum, item) => sum + item.value, 0)
  let angle = 0
  return items.map((item, index) => {
    const span = total ? (item.value / total) * 360 : 0
    const end = angle + span
    const gap = Math.min(0.8, span * 0.12)
    const segment: DonutSegment<T> = {
      item,
      color: colors[index % colors.length]!,
      start: angle,
      end,
      path: arcPath(190, 190, radius, angle + gap / 2, end - gap / 2),
      fullCircle: span >= 359.99,
    }
    angle = end
    return segment
  })
}

function optionValues(definition: FilterDefinition) {
  if (!data.value || !definition.optionKey) return []
  return data.value.options[definition.optionKey]
}

const filteredRows = computed(() =>
  data.value ? filterMethodologyRows(data.value.records, filters) : [],
)

const activeFilters = computed(() =>
  filterDefinitions.filter((definition) => {
    const value = filters[definition.key]
    return definition.key === 'query' ? Boolean(value.trim()) : value !== 'all'
  }),
)

const advancedFilterCount = computed(
  () => activeFilters.value.filter((item) => item.advanced).length,
)

const sourceText = computed(() => {
  const meta = data.value?.meta
  if (!meta) return '正在读取方法学数据…'
  return `来源：${meta.sourceName || 'WBE汇总表.xlsx'}；${formatNumber(meta.rowCount)} 行，${formatNumber(meta.docCount)} 篇文献，${formatNumber(meta.samplingStandardCount)} 个有效标准采样方法`
})

const kpis = computed(() => [
  {
    label: '当前统计数',
    value: countRows(filteredRows.value, filters.mode),
    note: modeUnitLabel(filters.mode),
  },
  {
    label: '文献数',
    value: countRows(filteredRows.value, 'docs'),
    note: '文献编号去重',
  },
  {
    label: '文献—方法',
    value: countRows(filteredRows.value, 'docMethods'),
    note: '文献与标准方法组合',
  },
  {
    label: '标准采样方法',
    value: new Set(filteredRows.value.map((row) => row.samplingStandard).filter(Boolean)).size,
    note: '有效受控值',
  },
  {
    label: '采样主类',
    value: new Set(filteredRows.value.map((row) => row.samplingClass).filter(Boolean)).size,
    note: '有效方法归类',
  },
])

const prescriptionItems = computed(() =>
  aggregate(
    filteredRows.value.filter((row) => Boolean(row.prescription)),
    'prescription',
    filters.mode,
  ).slice(0, 9),
)
const prescriptionTotal = computed(() =>
  prescriptionItems.value.reduce((sum, item) => sum + item.value, 0),
)
const prescriptionSegments = computed(() =>
  buildDonutSegments(prescriptionItems.value, 96, METHODOLOGY_COLORS),
)
const prescriptionCenterLabel = computed(() =>
  filters.mode === 'rows'
    ? '数据行'
    : filters.mode === 'docMethods'
      ? '文献—方法—属性'
      : '文献—属性',
)

const samplingGroups = computed(() =>
  data.value
    ? buildSamplingGroups(
        filteredRows.value,
        data.value.options.samplingClass,
        data.value.samplingMethods,
      )
    : [],
)
const samplingTotal = computed(() =>
  samplingGroups.value.reduce((sum, group) => sum + group.value, 0),
)
const samplingMethodCount = computed(() =>
  samplingGroups.value.reduce((sum, group) => sum + group.methods.length, 0),
)
const samplingSegments = computed(() => {
  const total = samplingTotal.value
  let groupAngle = 0
  const inner: DonutSegment<SamplingClassItem>[] = []
  const outer: DonutSegment<SamplingMethodItem>[] = []
  for (const group of samplingGroups.value) {
    const groupSpan = total ? (group.value / total) * 360 : 0
    const groupEnd = groupAngle + groupSpan
    const groupGap = Math.min(0.8, groupSpan * 0.12)
    inner.push({
      item: group,
      color: group.color,
      start: groupAngle,
      end: groupEnd,
      path: arcPath(190, 190, 84, groupAngle + groupGap / 2, groupEnd - groupGap / 2),
      fullCircle: groupSpan >= 359.99,
    })
    const methodTotal = group.methods.reduce((sum, method) => sum + method.value, 0) || 1
    let methodAngle = groupAngle
    for (const method of group.methods) {
      const methodSpan = (groupSpan * method.value) / methodTotal
      const methodEnd = methodAngle + methodSpan
      const methodGap = Math.min(0.8, methodSpan * 0.12)
      outer.push({
        item: method,
        color: method.color,
        start: methodAngle,
        end: methodEnd,
        path: arcPath(
          190,
          190,
          139,
          methodAngle + methodGap / 2,
          methodEnd - methodGap / 2,
        ),
        fullCircle: methodSpan >= 359.99,
      })
      methodAngle = methodEnd
    }
    groupAngle = groupEnd
  }
  return { inner, outer }
})

const analysisCoverage = computed(() => buildAnalysisCoverage(filteredRows.value))
const countryCoverage = computed(() => buildCountryCoverage(filteredRows.value))
const samplingAudit = computed(() =>
  data.value ? buildSamplingAudit(filteredRows.value, data.value.samplingMethods) : [],
)

const samplingFocusTitle = computed(() => activeSamplingFocus.value?.item.name ?? '暂无数据')
const samplingFocusEyebrow = computed(() => {
  if (!activeSamplingFocus.value) return '采样方法节点'
  return activeSamplingFocus.value.kind === 'class'
    ? '内环 · 采样主类'
    : `外环 · 标准值 / ${activeSamplingFocus.value.item.groupName}`
})
const samplingFocusValue = computed(() => activeSamplingFocus.value?.item.value ?? 0)
const samplingFocusMeta = computed(() => {
  const focus = activeSamplingFocus.value
  if (!focus) return []
  if (focus.kind === 'class') {
    return [
      ['标准方法', focus.item.methods.map((method) => method.name).join(' / ')],
      ['方法数量', `${focus.item.methods.length} 种`],
      ['数据记录', `${formatNumber(focus.item.rows)} 条`],
    ]
  }
  return samplingDimensions(focus.item.meta)
})
const samplingFocusNote = computed(() => {
  const focus = activeSamplingFocus.value
  if (!focus) return ''
  return focus.kind === 'class'
    ? `${formatNumber(focus.item.docs)} 篇去重文献`
    : `${formatNumber(focus.item.groupMethodCount)} 种方法归入该主类`
})

function samplingDimensions(meta?: SamplingMethodMeta) {
  const value = (key: keyof SamplingMethodMeta) => {
    const current = meta?.[key]
    return Array.isArray(current) ? current.filter(Boolean).join(' / ') || '未标注' : '未标注'
  }
  return [
    ['采样对象', value('sampleObject')],
    ['比例方式', value('proportion')],
    ['采样时长', value('duration')],
    ['被动采样器', value('passiveSampler')],
    ['站点对应', value('stationStatus')],
  ]
}

function setMode(mode: MethodologyMode) {
  filters.mode = mode
}

function clearFilter(key: FilterKey) {
  filters[key] = key === 'query' ? '' : 'all'
}

function resetFilters() {
  Object.assign(filters, DEFAULT_METHODOLOGY_FILTERS)
  advancedOpen.value = false
}

function positionTooltip(event: PointerEvent | MouseEvent) {
  const width = 340
  const height = Math.min(260, 76 + tooltip.lines.length * 24)
  tooltip.x = Math.min(event.clientX + 18, window.innerWidth - width - 14)
  tooltip.y = Math.min(event.clientY + 18, window.innerHeight - height - 14)
}

function showTooltip(
  event: PointerEvent | MouseEvent,
  title: string,
  lines: string[],
) {
  tooltip.title = title
  tooltip.lines = lines
  tooltip.visible = true
  positionTooltip(event)
}

function hideTooltip() {
  tooltip.visible = false
}

function activatePrescription(event: PointerEvent | MouseEvent, item: AggregateItem) {
  activePrescription.value = item.name
  const percent = prescriptionTotal.value ? (item.value / prescriptionTotal.value) * 100 : 0
  showTooltip(event, item.name, [
    `${prescriptionCenterLabel.value}：${formatNumber(item.value)}`,
    `当前占比：${percent.toFixed(1)}%`,
  ])
}

function activateSamplingClass(event: PointerEvent | MouseEvent, item: SamplingClassItem) {
  activeSamplingFocus.value = { kind: 'class', item }
  showTooltip(event, item.name, [
    `节点层级：内环采样主类`,
    `文献—方法：${formatNumber(item.value)}`,
    `去重文献：${formatNumber(item.docs)}`,
    `标准方法：${formatNumber(item.methods.length)} 种`,
    `数据记录：${formatNumber(item.rows)} 条`,
  ])
}

function activateSamplingMethod(event: PointerEvent | MouseEvent, item: SamplingMethodItem) {
  activeSamplingFocus.value = { kind: 'method', item }
  showTooltip(event, item.name, [
    `节点层级：外环标准采样方法`,
    `采样主类：${item.groupName}`,
    `去重文献：${formatNumber(item.value)}`,
    ...samplingDimensions(item.meta).map(([label, value]) => `${label}：${value}`),
  ])
}

function activateAnalysis(event: PointerEvent | MouseEvent, item: AnalysisCoverageItem) {
  activeAnalysis.value = item.name
  showTooltip(event, item.name, [
    `去重文献：${formatNumber(item.docs)} / ${formatNumber(analysisCoverage.value.totalDocs)}（${item.docRate.toFixed(1)}%）`,
    `去重标记物：${formatNumber(item.markers)} / ${formatNumber(analysisCoverage.value.totalMarkers)}（${item.markerRate.toFixed(1)}%）`,
    `数据记录：${formatNumber(item.rows)}`,
  ])
}

watch(
  samplingGroups,
  (groups) => {
    const firstMethod = groups[0]?.methods[0]
    activeSamplingFocus.value = firstMethod ? { kind: 'method', item: firstMethod } : null
  },
  { immediate: true },
)

watch(
  prescriptionItems,
  (items) => {
    activePrescription.value = items[0]?.name ?? ''
  },
  { immediate: true },
)

watch(
  () => analysisCoverage.value.items,
  (items) => {
    activeAnalysis.value = items[0]?.name ?? ''
  },
  { immediate: true },
)

let compactMediaQuery: MediaQueryList | undefined

function updateCompactLayout(event: MediaQueryListEvent | MediaQueryList) {
  isCompactLayout.value = event.matches
}

onMounted(async () => {
  compactMediaQuery = window.matchMedia?.('(max-width: 760px)')
  if (compactMediaQuery) {
    updateCompactLayout(compactMediaQuery)
    compactMediaQuery.addEventListener('change', updateCompactLayout)
  }
  try {
    data.value = await fetchMethodologyData()
  } catch (error) {
    loadError.value = `方法学数据加载失败：${error instanceof Error ? error.message : '未知错误'}`
  } finally {
    isLoading.value = false
  }
})

onBeforeUnmount(() => {
  compactMediaQuery?.removeEventListener('change', updateCompactLayout)
})
</script>

<template>
  <main
    class="methodology-shell"
    :class="{ 'is-compact': isCompactLayout }"
    :data-layout="isCompactLayout ? 'compact' : 'wide'"
  >
    <header class="methodology-header">
      <RouterLink class="brand" to="/" aria-label="返回污水信息因子数据库首页">
        <BrandMark :size="40" />
        <span>
          <strong>污水信息因子数据库</strong>
          <small>Wastewater Biomarker Evidence</small>
        </span>
      </RouterLink>
      <nav aria-label="可视化模块导航">
        <RouterLink to="/map-visualization">空间分布</RouterLink>
        <RouterLink to="/icd11-sankey">疾病关联</RouterLink>
        <span class="active">方法学核验</span>
      </nav>
      <RouterLink class="home-link" to="/">返回首页</RouterLink>
    </header>

    <section class="methodology-hero" aria-labelledby="methodologyTitle">
      <div>
        <p class="eyebrow">METHODOLOGY VERIFICATION</p>
        <h1 id="methodologyTitle">方法学核验</h1>
        <p>从处方属性、采样路径到分析方法，验证每条证据如何被采集、分类与测量。</p>
      </div>
      <div class="hero-status" aria-label="数据来源与口径">
        <span>数据链路</span>
        <strong>原始记录 → 受控值 → 覆盖率</strong>
        <p>{{ sourceText }}</p>
      </div>
    </section>

    <section v-if="isLoading" class="state-panel" data-state="loading" aria-live="polite">
      <span class="loading-orbit" aria-hidden="true"></span>
      <strong>正在装载方法学记录</strong>
      <p>正在从后端数据库查询完整方法学数据，加载后筛选将在页面内即时联动。</p>
    </section>
    <section v-else-if="loadError" class="state-panel error" data-state="error" role="alert">
      <strong>{{ loadError }}</strong>
      <p>请确认后端服务已启动，且方法学数据集已完成初始化。</p>
    </section>
    <section v-else-if="!data?.records.length" class="state-panel empty-state" data-state="empty">
      <strong>暂无方法学数据</strong>
      <p>接口已正常响应，但当前数据集没有可供核验的记录。</p>
    </section>

    <template v-else-if="data">
      <section class="filter-console" aria-label="方法学筛选控制台">
        <div class="filter-heading">
          <div>
            <span>CONTROL SURFACE</span>
            <h2>筛选与统计口径</h2>
          </div>
          <button type="button" :disabled="!activeFilters.length" @click="resetFilters">重置筛选</button>
        </div>

        <div class="filter-grid primary">
          <label v-for="definition in primaryFilters" :key="definition.key">
            <span>{{ definition.label }}</span>
            <input
              v-if="definition.kind === 'search'"
              v-model="filters[definition.key]"
              :data-filter="definition.key"
              type="search"
              placeholder="药物、标记物、采样或分析方法"
            />
            <select v-else v-model="filters[definition.key]" :data-filter="definition.key">
              <option value="all">{{ definition.allLabel }}</option>
              <option v-for="option in optionValues(definition)" :key="option" :value="option">
                {{ option }}
              </option>
            </select>
          </label>
        </div>

        <button class="advanced-toggle" type="button" @click="advancedOpen = !advancedOpen">
          <span>{{ advancedOpen ? '收起更多筛选' : '更多筛选' }}</span>
          <b v-if="advancedFilterCount">{{ advancedFilterCount }}</b>
          <i :class="{ open: advancedOpen }" aria-hidden="true">⌄</i>
        </button>

        <div v-if="advancedOpen" class="filter-grid advanced">
          <label v-for="definition in advancedFilters" :key="definition.key">
            <span>{{ definition.label }}</span>
            <select v-model="filters[definition.key]" :data-filter="definition.key">
              <option value="all">{{ definition.allLabel }}</option>
              <option v-for="option in optionValues(definition)" :key="option" :value="option">
                {{ option }}
              </option>
            </select>
          </label>
        </div>

        <div v-if="activeFilters.length" class="active-filters" aria-label="当前筛选条件">
          <span>已选</span>
          <button
            v-for="definition in activeFilters"
            :key="definition.key"
            type="button"
            @click="clearFilter(definition.key)"
          >
            {{ definition.label }}：{{ filters[definition.key] }} <b aria-hidden="true">×</b>
          </button>
        </div>

        <div class="mode-control" aria-label="统计单位">
          <span>统计单位</span>
          <button
            v-for="item in [
              { value: 'docs', label: '文献去重' },
              { value: 'docMethods', label: '文献—采样方法' },
              { value: 'rows', label: '数据行' },
            ]"
            :key="item.value"
            type="button"
            :class="{ active: filters.mode === item.value }"
            @click="setMode(item.value as MethodologyMode)"
          >
            {{ item.label }}
          </button>
        </div>
      </section>

      <section class="kpi-grid" aria-label="当前统计摘要">
        <article v-for="(item, index) in kpis" :key="item.label" :style="{ '--delay': `${index * 35}ms` }">
          <span>{{ item.label }}</span>
          <strong>{{ formatNumber(item.value) }}</strong>
          <small>{{ item.note }}</small>
        </article>
      </section>

      <section class="method-layer prescription-layer" data-method-layer="prescription">
        <div class="layer-heading">
          <div><span>01 / PRESCRIPTION</span><h2>处方属性覆盖</h2></div>
          <p>环面积按当前统计单位与处方属性的组合去重；同一文献覆盖多个属性时分别计入对应扇区。</p>
        </div>
        <div class="prescription-layout">
          <svg class="prescription-donut" viewBox="0 0 380 380" role="img" aria-label="处方属性覆盖环形图">
            <g
              v-for="segment in prescriptionSegments"
              :key="segment.item.name"
              class="donut-node"
              :class="{ active: activePrescription === segment.item.name }"
              tabindex="0"
              role="button"
              @pointerenter="activatePrescription($event, segment.item)"
              @pointermove="activatePrescription($event, segment.item)"
              @mousemove="activatePrescription($event, segment.item)"
              @pointerleave="hideTooltip"
              @focus="activePrescription = segment.item.name"
            >
              <circle
                v-if="segment.fullCircle"
                cx="190" cy="190" r="96" fill="none" :stroke="segment.color" stroke-width="42"
              />
              <path v-else :d="segment.path" fill="none" :stroke="segment.color" stroke-width="42" />
            </g>
            <circle cx="190" cy="190" r="70" fill="#fff" />
            <text x="190" y="180" text-anchor="middle" class="donut-center-label">{{ prescriptionCenterLabel }}</text>
            <text x="190" y="216" text-anchor="middle" class="donut-center-value">{{ formatNumber(prescriptionTotal) }}</text>
          </svg>
          <div class="legend-panel">
            <button
              v-for="(item, index) in prescriptionItems"
              :key="item.name"
              type="button"
              :class="{ active: activePrescription === item.name }"
              @pointerenter="activePrescription = item.name"
              @focus="activePrescription = item.name"
            >
              <i :style="{ background: METHODOLOGY_COLORS[index % METHODOLOGY_COLORS.length] }"></i>
              <span>{{ item.name }}</span>
              <strong>{{ formatNumber(item.value) }}<small>{{ prescriptionTotal ? ((item.value / prescriptionTotal) * 100).toFixed(1) : '0.0' }}%</small></strong>
            </button>
          </div>
        </div>
      </section>

      <section class="method-layer sampling-layer" data-method-layer="sampling">
        <div class="layer-heading">
          <div><span>02 / SAMPLING</span><h2>采样方法覆盖与核查</h2></div>
          <p>内环为采样主类，外环为有效受控标准方法；按“文献编号＋标准值”去重。</p>
        </div>

        <div class="subsection sampling-coverage">
          <div class="subsection-title">
            <h3>采样主类覆盖</h3>
            <p>移动鼠标到任一内环或外环节点，查看对应方法的小窗口和完整维度。</p>
          </div>
          <div class="sampling-layout">
            <div class="sampling-stage">
              <svg class="sampling-donut" viewBox="0 0 380 380" role="img" aria-label="采样方法双层环形图">
                <g
                  v-for="segment in samplingSegments.outer"
                  :key="`${segment.item.groupName}-${segment.item.name}`"
                  class="sampling-method-node"
                  :class="{ active: activeSamplingFocus?.kind === 'method' && activeSamplingFocus.item.name === segment.item.name && activeSamplingFocus.item.groupName === segment.item.groupName }"
                  tabindex="0"
                  role="button"
                  @pointerenter="activateSamplingMethod($event, segment.item)"
                  @pointermove="activateSamplingMethod($event, segment.item)"
                  @mousemove="activateSamplingMethod($event, segment.item)"
                  @pointerleave="hideTooltip"
                  @focus="activeSamplingFocus = { kind: 'method', item: segment.item }"
                >
                  <circle v-if="segment.fullCircle" cx="190" cy="190" r="139" fill="none" :stroke="segment.color" stroke-width="32" />
                  <path v-else :d="segment.path" fill="none" :stroke="segment.color" stroke-width="32" />
                </g>
                <g
                  v-for="segment in samplingSegments.inner"
                  :key="segment.item.name"
                  class="sampling-class-node"
                  :class="{ active: activeSamplingFocus?.kind === 'class' && activeSamplingFocus.item.name === segment.item.name }"
                  tabindex="0"
                  role="button"
                  @pointerenter="activateSamplingClass($event, segment.item)"
                  @pointermove="activateSamplingClass($event, segment.item)"
                  @mousemove="activateSamplingClass($event, segment.item)"
                  @pointerleave="hideTooltip"
                  @focus="activeSamplingFocus = { kind: 'class', item: segment.item }"
                >
                  <circle v-if="segment.fullCircle" cx="190" cy="190" r="84" fill="none" :stroke="segment.color" stroke-width="44" />
                  <path v-else :d="segment.path" fill="none" :stroke="segment.color" stroke-width="44" />
                </g>
                <circle cx="190" cy="190" r="55" fill="#fff" />
                <text x="190" y="180" text-anchor="middle" class="sampling-total">{{ formatNumber(samplingTotal) }}</text>
                <text x="190" y="204" text-anchor="middle" class="sampling-unit">文献—方法</text>
                <text x="190" y="224" text-anchor="middle" class="sampling-method-count">{{ samplingMethodCount }} 种标准值</text>
              </svg>
              <div class="ring-key"><span><i class="inner"></i>内环：采样主类</span><span><i class="outer"></i>外环：标准采样方法</span></div>
            </div>

            <aside class="sampling-focus" aria-live="polite">
              <span>{{ samplingFocusEyebrow }}</span>
              <h3>{{ samplingFocusTitle }}</h3>
              <div class="focus-metric">
                <strong>{{ formatNumber(samplingFocusValue) }}</strong>
                <span>{{ activeSamplingFocus?.kind === 'class' ? '文献—方法' : '去重文献' }}</span>
                <small>{{ samplingFocusNote }}</small>
              </div>
              <dl>
                <div v-for="item in samplingFocusMeta" :key="item[0]">
                  <dt>{{ item[0] }}</dt><dd>{{ item[1] }}</dd>
                </div>
              </dl>
              <div class="class-legend">
                <button
                  v-for="group in samplingGroups"
                  :key="group.name"
                  type="button"
                  :class="{ active: activeSamplingFocus?.kind === 'class' && activeSamplingFocus.item.name === group.name }"
                  @pointerenter="activeSamplingFocus = { kind: 'class', item: group }"
                  @focus="activeSamplingFocus = { kind: 'class', item: group }"
                >
                  <i :style="{ background: group.color }"></i><span>{{ group.name }}</span><strong>{{ group.methods.length }} 种</strong>
                </button>
              </div>
            </aside>
          </div>
        </div>

        <div class="subsection country-section">
          <div class="subsection-title"><h3>不同国家采样主类统计</h3><p>按“文献编号＋标准采样方法”去重；不把目标物质数量解释为研究数量。</p></div>
          <div v-if="countryCoverage.items.length" class="country-chart">
            <div v-for="country in countryCoverage.items" :key="country.name" class="country-row">
              <strong>{{ country.name }}</strong>
              <div class="country-track">
                <span
                  v-for="part in country.parts"
                  :key="part.name"
                  :style="{ width: `${part.ratio}%`, background: part.color }"
                  @pointerenter="showTooltip($event, `${country.name} / ${part.name}`, [`文献—方法组合：${formatNumber(part.value)}`])"
                  @pointermove="showTooltip($event, `${country.name} / ${part.name}`, [`文献—方法组合：${formatNumber(part.value)}`])"
                  @mousemove="showTooltip($event, `${country.name} / ${part.name}`, [`文献—方法组合：${formatNumber(part.value)}`])"
                  @pointerleave="hideTooltip"
                ></span>
              </div>
              <b>{{ formatNumber(country.value) }}</b>
            </div>
            <div class="country-legend">
              <span v-for="(name, index) in countryCoverage.classNames" :key="name"><i :style="{ background: METHODOLOGY_COLORS[index % METHODOLOGY_COLORS.length] }"></i>{{ name }}</span>
            </div>
          </div>
          <p v-else class="empty">当前筛选下无国家采样数据</p>
        </div>

        <div class="subsection audit-section">
          <div class="subsection-title"><h3>标准采样方法核查表</h3><p>数据行仅表示受影响记录范围；默认排序依据为去重文献数。</p></div>
          <div class="table-scroll">
            <table>
              <thead><tr><th>标准采样方法</th><th>采样主类</th><th>采样对象</th><th>比例方式</th><th>采样/部署时长</th><th>被动采样器</th><th>站点对应状态</th><th>比例报告</th><th>文献</th><th>数据行</th><th>审计摘录组</th></tr></thead>
              <tbody>
                <tr v-for="item in samplingAudit" :key="item.standard">
                  <td class="method-name">{{ item.standard }}</td><td>{{ item.samplingClass }}</td><td>{{ item.sampleObject }}</td><td>{{ item.proportion }}</td><td>{{ item.duration }}</td><td>{{ item.passiveSampler }}</td><td>{{ item.stationStatus }}</td>
                  <td><span class="status-pill" :class="{ warning: item.proportionStatus === '未报告' || item.proportionStatus === '未标注' }">{{ item.proportionStatus }}</span></td>
                  <td>{{ formatNumber(item.docs) }}</td><td>{{ formatNumber(item.rows) }}</td><td>{{ formatNumber(item.auditSourceGroups) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="method-layer analysis-layer" data-method-layer="analysis">
        <div class="layer-heading"><div><span>03 / ANALYSIS</span><h2>分析方法覆盖</h2></div><p>每种方法并列展示去重文献覆盖率和去重标记物覆盖率；百分比不作构成比。</p></div>
        <div class="analysis-legend"><span><i></i>去重文献覆盖率</span><span><i></i>去重标记物覆盖率</span></div>
        <div v-if="analysisCoverage.items.length" class="analysis-chart">
          <div class="analysis-axis"><span>0</span><span>25</span><span>50</span><span>75</span><span>100%</span></div>
          <article
            v-for="item in analysisCoverage.items"
            :key="item.name"
            :class="{ active: activeAnalysis === item.name }"
            tabindex="0"
            @pointerenter="activateAnalysis($event, item)"
            @pointermove="activateAnalysis($event, item)"
            @mousemove="activateAnalysis($event, item)"
            @pointerleave="hideTooltip"
            @focus="activeAnalysis = item.name"
          >
            <div class="analysis-label"><strong>{{ item.name }}</strong><span>{{ formatNumber(item.docs) }} 篇 · {{ formatNumber(item.markers) }} 个标记物</span></div>
            <div class="analysis-bars">
              <div><i :style="{ width: `${Math.max(item.docRate, 0.5)}%` }"></i><b :style="{ left: `${Math.min(item.docRate + 1, 96)}%` }">{{ item.docRate.toFixed(1) }}%</b></div>
              <div><i :style="{ width: `${Math.max(item.markerRate, 0.5)}%` }"></i><b :style="{ left: `${Math.min(item.markerRate + 1, 96)}%` }">{{ item.markerRate.toFixed(1) }}%</b></div>
            </div>
          </article>
          <p>当前筛选基数：{{ formatNumber(analysisCoverage.totalDocs) }} 篇文献，{{ formatNumber(analysisCoverage.totalMarkers) }} 个标记物</p>
        </div>
        <p v-else class="empty">当前筛选下无分析方法数据</p>
      </section>
    </template>

    <Transition name="tooltip-fade">
      <aside v-if="tooltip.visible" class="node-tooltip" :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }" role="status">
        <span>NODE INSPECTOR</span><strong>{{ tooltip.title }}</strong><p v-for="line in tooltip.lines" :key="line">{{ line }}</p>
      </aside>
    </Transition>
  </main>
</template>

<style scoped>
:global(*) { box-sizing: border-box; }
:global(body) { margin: 0; min-width: 320px; color: #173247; background: #eef4f7; font-family: Inter, 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif; }
button, input, select { font: inherit; }
.methodology-shell { min-height: 100vh; padding-bottom: 54px; background: radial-gradient(circle at 5% 4%, rgba(17, 116, 158, .13), transparent 28%), radial-gradient(circle at 92% 18%, rgba(14, 143, 119, .11), transparent 24%), linear-gradient(180deg, #f4f9fb 0%, #eaf2f5 100%); }
.methodology-header { position: sticky; top: 0; z-index: 30; min-height: 72px; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 24px; padding: 12px clamp(18px, 4vw, 64px); border-bottom: 1px solid rgba(77, 111, 132, .2); background: rgba(255, 255, 255, .94); box-shadow: 0 12px 34px rgba(21, 52, 72, .08); backdrop-filter: blur(18px); }
.brand { display: inline-flex; align-items: center; gap: 11px; color: #153348; text-decoration: none; }
.brand > span:last-child { display: grid; }
.brand strong { font-size: 16px; }
.brand small { margin-top: 2px; color: #6e8491; font-size: 9px; text-transform: uppercase; }
.brand-mark { position: relative; width: 42px; height: 42px; display: block; overflow: hidden; border-radius: 10px; background: linear-gradient(135deg, #0f6591, #0e8f77); box-shadow: 0 10px 24px rgba(15, 101, 145, .25); }
.brand-mark i { position: absolute; left: 8px; top: 7px; width: 18px; height: 18px; border: 2px solid #fff; border-radius: 70% 70% 70% 18%; transform: rotate(-45deg); }
.brand-mark b, .brand-mark em { position: absolute; bottom: 9px; width: 4px; border-radius: 3px; background: #fff; }
.brand-mark b { right: 13px; height: 15px; }.brand-mark em { right: 7px; height: 10px; }
.methodology-header nav { display: flex; justify-content: center; gap: clamp(14px, 2.5vw, 34px); }
.methodology-header nav a, .methodology-header nav span { padding: 8px 0; color: #567080; text-decoration: none; font-size: 13px; font-weight: 800; }
.methodology-header nav .active { color: #0b7868; border-bottom: 2px solid #0e8f77; }
.home-link { padding: 10px 16px; border: 1px solid rgba(15, 101, 145, .23); border-radius: 8px; color: #0f6591; background: #f3f9fc; text-decoration: none; font-size: 13px; font-weight: 900; }
.methodology-hero { position: relative; max-width: 1520px; min-height: 220px; margin: 0 auto; display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(380px, .9fr); align-items: center; gap: 48px; padding: 44px clamp(22px, 5vw, 78px); overflow: hidden; color: #fff; background: linear-gradient(125deg, #102f48 0%, #0f5c74 50%, #0b756b 100%); }
.methodology-hero::after { content: ''; position: absolute; width: 430px; height: 430px; right: -110px; top: -205px; border: 1px solid rgba(255,255,255,.18); border-radius: 50%; box-shadow: 0 0 0 48px rgba(255,255,255,.025), 0 0 0 96px rgba(255,255,255,.018); }
.eyebrow { margin: 0 0 9px; color: #8de0d3; font-size: 11px; font-weight: 900; letter-spacing: .2em; }
.methodology-hero h1 { margin: 0; font-size: clamp(40px, 5vw, 68px); line-height: 1; letter-spacing: -.04em; }
.methodology-hero > div:first-child > p:last-child { max-width: 680px; margin: 18px 0 0; color: rgba(235, 248, 250, .82); font-size: 16px; line-height: 1.7; }
.hero-status { position: relative; z-index: 1; padding: 22px; border: 1px solid rgba(255,255,255,.18); border-radius: 12px; background: rgba(7, 34, 50, .3); backdrop-filter: blur(10px); }
.hero-status span { color: #8de0d3; font-size: 11px; font-weight: 900; letter-spacing: .12em; }
.hero-status strong { display: block; margin-top: 8px; font-size: 20px; }
.hero-status p { margin: 12px 0 0; color: rgba(235, 248, 250, .76); font-size: 12px; line-height: 1.6; }
.state-panel, .filter-console, .kpi-grid, .method-layer { width: min(1420px, calc(100% - 36px)); margin-left: auto; margin-right: auto; }
.state-panel { min-height: 300px; margin-top: 24px; display: grid; place-items: center; align-content: center; gap: 12px; border: 1px solid rgba(94, 128, 148, .2); border-radius: 14px; background: #fff; text-align: center; }
.state-panel p { margin: 0; color: #718793; }.state-panel.error { color: #9a3e3e; }.state-panel.empty-state { color: #496777; }
.loading-orbit { width: 42px; height: 42px; border: 3px solid rgba(15,101,145,.15); border-top-color: #0e8f77; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.filter-console { margin-top: 22px; padding: 22px; border: 1px solid rgba(77, 111, 132, .18); border-radius: 14px; background: rgba(255,255,255,.96); box-shadow: 0 16px 38px rgba(24, 70, 91, .08); }
.filter-heading { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding-bottom: 16px; border-bottom: 1px solid #e4edf1; }
.filter-heading span { color: #0e8f77; font-size: 10px; font-weight: 900; letter-spacing: .14em; }.filter-heading h2 { margin: 4px 0 0; font-size: 21px; }.filter-heading > button { min-height: 38px; padding: 0 14px; border: 1px solid #d5e2e8; border-radius: 8px; color: #4b6878; background: #f7fafb; cursor: pointer; font-weight: 800; }.filter-heading > button:disabled { opacity: .45; cursor: not-allowed; }
.filter-grid { display: grid; gap: 12px; }.filter-grid.primary { grid-template-columns: 1.3fr repeat(4, minmax(150px, 1fr)); margin-top: 18px; }.filter-grid.advanced { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 13px; padding: 16px; border-radius: 10px; background: #f4f8fa; }
.filter-grid label { min-width: 0; display: grid; gap: 7px; }.filter-grid label > span { color: #5d7584; font-size: 11px; font-weight: 900; }.filter-grid input, .filter-grid select { width: 100%; min-width: 0; height: 42px; padding: 0 12px; border: 1px solid #ccdbe2; border-radius: 8px; color: #213f51; background: #fff; outline: none; }.filter-grid input:focus, .filter-grid select:focus { border-color: #0e8f77; box-shadow: 0 0 0 3px rgba(14,143,119,.11); }
.advanced-toggle { margin-top: 13px; display: inline-flex; align-items: center; gap: 8px; padding: 7px 0; border: 0; color: #0f6591; background: transparent; cursor: pointer; font-size: 12px; font-weight: 900; }.advanced-toggle b { min-width: 20px; height: 20px; display: grid; place-items: center; border-radius: 99px; color: #fff; background: #0e8f77; font-size: 10px; }.advanced-toggle i { font-style: normal; transition: transform .2s ease; }.advanced-toggle i.open { transform: rotate(180deg); }
.active-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 14px; }.active-filters > span { color: #6d8290; font-size: 11px; font-weight: 900; }.active-filters button { padding: 6px 9px; border: 1px solid rgba(14,143,119,.2); border-radius: 999px; color: #0b6f5f; background: #edf8f5; cursor: pointer; font-size: 11px; font-weight: 800; }.active-filters button b { margin-left: 4px; }
.mode-control { display: flex; align-items: center; gap: 8px; margin-top: 18px; padding-top: 15px; border-top: 1px solid #e4edf1; }.mode-control > span { margin-right: 3px; color: #5d7584; font-size: 11px; font-weight: 900; }.mode-control button { min-height: 34px; padding: 0 12px; border: 1px solid #ccdbe2; border-radius: 7px; color: #526d7c; background: #fff; cursor: pointer; font-size: 11px; font-weight: 900; }.mode-control button.active { border-color: #0f6591; color: #fff; background: #0f6591; box-shadow: 0 7px 16px rgba(15,101,145,.18); }
.kpi-grid { margin-top: 14px; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }.kpi-grid article { position: relative; min-height: 118px; padding: 18px; overflow: hidden; border: 1px solid rgba(77,111,132,.16); border-radius: 12px; background: #fff; box-shadow: 0 10px 24px rgba(25,67,86,.06); animation: rise .45s ease both; animation-delay: var(--delay); }.kpi-grid article::after { content: ''; position: absolute; right: -20px; bottom: -35px; width: 90px; height: 90px; border: 12px solid rgba(15,101,145,.045); border-radius: 50%; }.kpi-grid span { color: #627985; font-size: 11px; font-weight: 900; }.kpi-grid strong { display: block; margin: 8px 0 3px; color: #123a56; font-size: 30px; }.kpi-grid small { color: #81939d; font-size: 10px; }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } }
.method-layer { margin-top: 18px; padding: 26px; border: 1px solid rgba(77,111,132,.18); border-radius: 14px; background: rgba(255,255,255,.98); box-shadow: 0 16px 38px rgba(24,70,91,.07); }
.layer-heading { display: grid; grid-template-columns: minmax(240px, .72fr) minmax(0, 1.28fr); align-items: end; gap: 28px; padding-bottom: 18px; border-bottom: 1px solid #dfe9ee; }.layer-heading span { color: #0f6591; font-size: 10px; font-weight: 900; letter-spacing: .12em; }.layer-heading h2 { margin: 5px 0 0; color: #17384e; font-size: 25px; }.layer-heading p { margin: 0; color: #607988; font-size: 12px; line-height: 1.7; }
.prescription-layout { min-height: 380px; display: grid; grid-template-columns: minmax(330px, .75fr) minmax(300px, .55fr); justify-content: center; align-items: center; gap: 40px; max-width: 900px; margin: 16px auto 0; }.prescription-donut { width: min(100%, 390px); justify-self: center; }.donut-node, .sampling-method-node, .sampling-class-node { cursor: pointer; outline: none; }.donut-node path, .donut-node circle, .sampling-method-node path, .sampling-method-node circle, .sampling-class-node path, .sampling-class-node circle { transition: opacity .16s ease, stroke-width .16s ease, filter .16s ease; }.donut-node:not(.active) path, .donut-node:not(.active) circle { opacity: .76; }.donut-node.active path, .donut-node.active circle { stroke-width: 49; filter: drop-shadow(0 6px 7px rgba(16,62,87,.16)); }.donut-center-label { fill: #68808d; font-size: 12px; }.donut-center-value { fill: #15384f; font-size: 31px; font-weight: 900; }
.legend-panel { display: grid; gap: 8px; }.legend-panel button { display: grid; grid-template-columns: 11px minmax(0,1fr) auto; align-items: center; gap: 10px; padding: 10px; border: 1px solid transparent; border-radius: 8px; color: #29495c; background: transparent; text-align: left; cursor: pointer; }.legend-panel button.active { border-color: #d5e5eb; background: #f2f8fa; }.legend-panel i { width: 10px; height: 10px; border-radius: 3px; }.legend-panel span { font-size: 13px; font-weight: 800; }.legend-panel strong { display: grid; color: #17384e; font-size: 18px; text-align: right; }.legend-panel small { color: #80929c; font-size: 10px; font-weight: 700; }
.subsection { padding-top: 24px; }.subsection + .subsection { margin-top: 26px; border-top: 1px solid #e2ebef; }.subsection-title h3 { margin: 0; color: #1b3d52; font-size: 18px; }.subsection-title p { margin: 6px 0 0; color: #6c818d; font-size: 11px; line-height: 1.6; }
.sampling-layout { display: grid; grid-template-columns: minmax(390px, 1fr) minmax(340px, .88fr); align-items: center; gap: 34px; max-width: 1100px; margin: 14px auto 0; }.sampling-stage { min-width: 0; display: grid; justify-items: center; }.sampling-donut { width: min(100%, 500px); }.sampling-method-node:not(.active), .sampling-class-node:not(.active) { opacity: .78; }.sampling-method-node.active path, .sampling-method-node.active circle { stroke-width: 39; filter: drop-shadow(0 4px 7px rgba(16,62,87,.18)); }.sampling-class-node.active path, .sampling-class-node.active circle { stroke-width: 52; filter: drop-shadow(0 4px 7px rgba(16,62,87,.18)); }.sampling-total { fill: #15384f; font-size: 31px; font-weight: 900; }.sampling-unit { fill: #607988; font-size: 12px; }.sampling-method-count { fill: #81939d; font-size: 10px; }.ring-key { display: flex; flex-wrap: wrap; justify-content: center; gap: 14px; margin-top: -8px; color: #617987; font-size: 11px; }.ring-key span { display: inline-flex; align-items: center; gap: 6px; }.ring-key i { display: block; border: 4px solid #2868c7; border-radius: 50%; }.ring-key i.inner { width: 13px; height: 13px; }.ring-key i.outer { width: 19px; height: 19px; opacity: .58; }
.sampling-focus { min-height: 350px; padding: 22px; border-left: 3px solid #0f6591; border-radius: 0 12px 12px 0; background: linear-gradient(135deg, #f5fafc, #eef7f5); }.sampling-focus > span { color: #0f6591; font-size: 10px; font-weight: 900; letter-spacing: .07em; }.sampling-focus h3 { margin: 7px 0 0; color: #17384e; font-size: 21px; line-height: 1.35; }.focus-metric { display: flex; flex-wrap: wrap; align-items: baseline; gap: 7px 14px; margin-top: 12px; padding: 12px 0; border-top: 1px solid #d9e7eb; border-bottom: 1px solid #d9e7eb; }.focus-metric strong { color: #0f6591; font-size: 30px; }.focus-metric span, .focus-metric small { color: #68808e; font-size: 11px; }.sampling-focus dl { display: grid; gap: 8px; margin: 14px 0; }.sampling-focus dl div { display: grid; grid-template-columns: 72px minmax(0,1fr); gap: 10px; font-size: 11px; line-height: 1.55; }.sampling-focus dt { color: #718692; font-weight: 900; }.sampling-focus dd { margin: 0; color: #29495c; overflow-wrap: anywhere; }.class-legend { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 7px; }.class-legend button { min-width: 0; display: grid; grid-template-columns: 10px minmax(0,1fr) auto; align-items: center; gap: 7px; padding: 6px; border: 1px solid transparent; border-radius: 6px; color: #365565; background: transparent; text-align: left; cursor: pointer; font-size: 10px; }.class-legend button.active { border-color: #c9e0e5; background: #fff; }.class-legend i { width: 9px; height: 9px; border-radius: 2px; }.class-legend span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.class-legend strong { color: #718692; white-space: nowrap; }
.country-chart { max-width: 1080px; margin: 24px auto 0; display: grid; gap: 10px; }.country-row { display: grid; grid-template-columns: 125px minmax(0,1fr) 44px; align-items: center; gap: 12px; }.country-row > strong { color: #4b6574; font-size: 11px; text-align: right; }.country-track { height: 21px; display: flex; overflow: hidden; border-radius: 4px; background: #edf2f4; }.country-track span { min-width: 0; height: 100%; transition: filter .15s ease, transform .15s ease; }.country-track span:hover { filter: brightness(1.12); transform: scaleY(1.18); }.country-row > b { color: #617988; font-size: 11px; }.country-legend { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px 22px; margin-top: 16px; }.country-legend span { display: inline-flex; align-items: center; gap: 6px; color: #637b88; font-size: 10px; }.country-legend i { width: 10px; height: 10px; border-radius: 2px; }
.table-scroll { margin-top: 16px; overflow-x: auto; border: 1px solid #dce7eb; border-radius: 10px; }.table-scroll table { width: 100%; min-width: 1280px; border-collapse: collapse; font-size: 10px; }.table-scroll th { position: sticky; top: 0; z-index: 1; padding: 11px 9px; color: #486271; background: #edf4f6; text-align: left; white-space: nowrap; }.table-scroll td { padding: 10px 9px; border-top: 1px solid #e5edf0; color: #405c6c; line-height: 1.45; vertical-align: top; }.table-scroll tbody tr:hover { background: #f5fafb; }.table-scroll .method-name { min-width: 230px; color: #1c4056; font-weight: 900; }.status-pill { display: inline-block; padding: 4px 7px; border-radius: 999px; color: #0b765e; background: #e7f7f1; font-weight: 900; white-space: nowrap; }.status-pill.warning { color: #a76a12; background: #fff2da; }
.analysis-legend { display: flex; justify-content: center; gap: 28px; margin: 23px 0 10px; }.analysis-legend span { display: inline-flex; align-items: center; gap: 7px; color: #4f6877; font-size: 11px; font-weight: 800; }.analysis-legend i { width: 11px; height: 11px; border-radius: 2px; background: #2868c7; }.analysis-legend span:last-child i { background: #0f8f8a; }.analysis-chart { position: relative; max-width: 1060px; margin: 0 auto; padding: 36px 0 4px; background: repeating-linear-gradient(90deg, transparent 0, transparent calc(25% - 1px), #e4ecef calc(25% - 1px), #e4ecef 25%); }.analysis-axis { position: absolute; top: 0; left: 230px; right: 0; display: flex; justify-content: space-between; color: #83949d; font-size: 9px; }.analysis-chart article { display: grid; grid-template-columns: 210px minmax(0,1fr); gap: 20px; align-items: center; min-height: 76px; padding: 7px 0; outline: none; }.analysis-chart article.active .analysis-label strong { color: #0f6591; }.analysis-label { display: grid; gap: 4px; }.analysis-label strong { color: #29495c; font-size: 12px; }.analysis-label span { color: #7a8e99; font-size: 9px; }.analysis-bars { display: grid; gap: 7px; }.analysis-bars > div { position: relative; height: 15px; background: rgba(235,241,244,.62); }.analysis-bars i { display: block; height: 100%; min-width: 3px; border-radius: 2px; background: #2868c7; transition: width .32s ease, filter .16s ease; }.analysis-bars > div:last-child i { background: #0f8f8a; }.analysis-chart article.active .analysis-bars i { filter: brightness(1.08); box-shadow: 0 0 0 1px #173f67; }.analysis-bars b { position: absolute; top: 1px; color: #345366; font-size: 9px; white-space: nowrap; }.analysis-chart > p { margin: 16px 0 0 230px; color: #6f8490; font-size: 10px; }.empty { padding: 40px; color: #7b8e99; text-align: center; }
.node-tooltip { position: fixed; z-index: 100; width: min(340px, calc(100vw - 28px)); max-height: min(420px, calc(100vh - 28px)); overflow: auto; padding: 14px 16px; border: 1px solid rgba(120, 198, 188, .42); border-radius: 10px; color: #eefbfa; background: rgba(10, 42, 59, .96); box-shadow: 0 18px 44px rgba(6, 28, 42, .3); pointer-events: none; backdrop-filter: blur(12px); }.node-tooltip > span { color: #73d8ca; font-size: 9px; font-weight: 900; letter-spacing: .14em; }.node-tooltip > strong { display: block; margin: 5px 0 9px; color: #fff; font-size: 14px; line-height: 1.35; }.node-tooltip p { margin: 4px 0; color: #cfe2e5; font-size: 10px; line-height: 1.45; }.tooltip-fade-enter-active, .tooltip-fade-leave-active { transition: opacity .12s ease, transform .12s ease; }.tooltip-fade-enter-from, .tooltip-fade-leave-to { opacity: 0; transform: translateY(4px); }
@media (max-width: 1100px) { .filter-grid.primary { grid-template-columns: repeat(2,minmax(0,1fr)); }.filter-grid.primary label:first-child { grid-column: 1 / -1; }.kpi-grid { grid-template-columns: repeat(3,minmax(0,1fr)); }.sampling-layout { grid-template-columns: 1fr; }.sampling-focus { border-left-width: 1px; border-top: 3px solid #0f6591; border-radius: 12px; }.analysis-chart { overflow-x: auto; }.analysis-chart article, .analysis-axis { min-width: 850px; } }
@media (max-width: 760px) { .methodology-header { grid-template-columns: 1fr auto; }.methodology-header nav { display: none; }.brand small { display: none; }.methodology-hero { grid-template-columns: 1fr; gap: 24px; padding-top: 34px; padding-bottom: 34px; }.hero-status { display: none; }.filter-grid.primary, .filter-grid.advanced { grid-template-columns: 1fr; }.filter-grid.primary label:first-child { grid-column: auto; }.mode-control { flex-wrap: wrap; }.kpi-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }.method-layer { padding: 19px; }.layer-heading { grid-template-columns: 1fr; gap: 10px; }.prescription-layout { grid-template-columns: 1fr; gap: 0; }.sampling-layout { grid-template-columns: 1fr; }.country-row { grid-template-columns: 85px minmax(0,1fr) 34px; }.class-legend { grid-template-columns: 1fr; } }
.methodology-shell.is-compact .methodology-header nav { display: none; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; transition-duration: .01ms !important; } }
</style>
