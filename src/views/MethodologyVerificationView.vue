<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'

import HeroSection from '../components/methodology/HeroSection.vue'
import MethodDetailPanel from '../components/methodology/MethodDetailPanel.vue'
import MethodologyFilterSelect, { type MethodologyFilterOption } from '../components/methodology/MethodologyFilterSelect.vue'
import MetricCard from '../components/methodology/MetricCard.vue'
import PageHeader from '../components/methodology/PageHeader.vue'
import ResponsiveMethodTable from '../components/methodology/ResponsiveMethodTable.vue'
import SectionHeader from '../components/methodology/SectionHeader.vue'
import { getUserErrorMessage } from '../services/errors'
import { fetchMethodologyData } from '../services/methodology'
import type { MethodologyData, MethodologyFilterState, MethodologyMode } from '../types/methodology'
import {
  DEFAULT_METHODOLOGY_FILTERS,
  PRESCRIPTION_COLORS,
  aggregate,
  buildAnalysisCoverage,
  buildCountryCoverage,
  buildSamplingAudit,
  buildSamplingGroups,
  countRows,
  countryNameZh,
  filterMethodologyRows,
  formatAnalysisMethodName,
  type SamplingMethodItem,
} from '../utils/methodologyVerification'
import '../styles/methodology-evidence.css'

type FilterKey = Exclude<keyof MethodologyFilterState, 'mode'>

interface FilterDefinition {
  key: FilterKey
  label: string
  allLabel: string
  optionKey?: keyof MethodologyData['options']
  advanced?: boolean
  kind?: 'search' | 'select'
}

const filterDefinitions: FilterDefinition[] = [
  { key: 'query', label: '关键词', allLabel: '', kind: 'search' },
  { key: 'targetClass', label: '目标类别', allLabel: '全部目标类别', optionKey: 'targetClass' },
  { key: 'country', label: '国家/地区', allLabel: '全部国家/地区', optionKey: 'country' },
  { key: 'samplingClass', label: '采样主类', allLabel: '全部采样主类', optionKey: 'samplingClass' },
  { key: 'samplingStandard', label: '标准采样方法', allLabel: '全部标准采样方法', optionKey: 'samplingStandard' },
  { key: 'category', label: '物质类别', allLabel: '全部物质类别', optionKey: 'category', advanced: true },
  { key: 'prescription', label: '处方属性', allLabel: '全部处方属性', optionKey: 'prescription', advanced: true },
  { key: 'sampleObject', label: '采样对象', allLabel: '全部采样对象', optionKey: 'sampleObject', advanced: true },
  { key: 'proportion', label: '比例方式', allLabel: '全部比例方式', optionKey: 'proportion', advanced: true },
  { key: 'duration', label: '采样/部署时长', allLabel: '全部时长', optionKey: 'duration', advanced: true },
  { key: 'passiveSampler', label: '被动采样器', allLabel: '全部采样器类型', optionKey: 'passiveSampler', advanced: true },
]

const primaryFilters = filterDefinitions.filter((item) => !item.advanced)
const advancedFilters = filterDefinitions.filter((item) => item.advanced)
const searchableFilterKeys = new Set<FilterKey>(['targetClass', 'country', 'samplingStandard', 'category', 'duration'])
const data = shallowRef<MethodologyData | null>(null)
const isLoading = ref(true)
const loadError = ref('')
const advancedOpen = ref(false)
const dataNoteOpen = ref(false)
const filters = reactive<MethodologyFilterState>({ ...DEFAULT_METHODOLOGY_FILTERS })
const selectedMethodName = ref('')
const compactLayout = ref(false)

const formatNumber = (value: number) => Number(value || 0).toLocaleString('zh-CN')

function optionValues(definition: FilterDefinition) {
  if (!data.value || !definition.optionKey) return []
  return data.value.options[definition.optionKey]
}

function searchableOptions(definition: FilterDefinition): MethodologyFilterOption[] {
  return [
    { value: 'all', label: definition.allLabel },
    ...optionValues(definition).map((value) => ({
      value,
      label: definition.key === 'country' ? countryNameZh(value) : value,
      searchText: definition.key === 'country' ? value : undefined,
    })),
  ]
}

function updateFilter(key: FilterKey, value: string) {
  filters[key] = value
}

const filteredRows = computed(() => data.value ? filterMethodologyRows(data.value.records, filters) : [])
const filteredDocCount = computed(() => countRows(filteredRows.value, 'docs'))
const activeFilters = computed(() => filterDefinitions.filter((definition) => {
  const value = filters[definition.key]
  return definition.key === 'query' ? Boolean(value.trim()) : value !== 'all'
}))
const advancedFilterCount = computed(() => activeFilters.value.filter((item) => item.advanced).length)

const sourceText = computed(() => {
  const meta = data.value?.meta
  if (!meta) return '正在读取方法学数据…'
  return `当前数据包含 ${formatNumber(meta.rowCount)} 条记录、${formatNumber(meta.docCount)} 篇文献和 ${formatNumber(meta.samplingStandardCount)} 种标准采样方法。`
})

const metrics = computed(() => {
  const totalDocs = data.value?.meta.docCount || 0
  const docs = filteredDocCount.value
  return [
    { label: '筛选结果', value: `${formatNumber(docs)} / ${formatNumber(totalDocs)}`, unit: '篇文献', note: `占全部文献 ${totalDocs ? ((docs / totalDocs) * 100).toFixed(1) : '0.0'}%` },
    { label: '文献—方法组合', value: formatNumber(countRows(filteredRows.value, 'docMethods')), note: '去重后的文献与标准方法组合' },
    { label: '标准采样方法', value: formatNumber(new Set(filteredRows.value.map((row) => row.samplingStandard).filter(Boolean)).size), note: '有效标准化方法', accent: 'teal' as const },
    { label: '采样主类', value: formatNumber(new Set(filteredRows.value.map((row) => row.samplingClass).filter(Boolean)).size), note: '标准方法所属类别', accent: 'teal' as const },
  ]
})

const prescriptionItems = computed(() => aggregate(filteredRows.value.filter((row) => Boolean(row.prescription)), 'prescription', filters.mode))
const prescriptionTotal = computed(() => prescriptionItems.value.reduce((sum, item) => sum + item.value, 0))

const samplingGroups = computed(() => data.value ? buildSamplingGroups(filteredRows.value, data.value.options.samplingClass, data.value.samplingMethods) : [])
const samplingClassMax = computed(() => Math.max(1, ...samplingGroups.value.map((item) => item.value)))
const samplingMethods = computed(() => samplingGroups.value.flatMap((group) => group.methods).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'zh-Hans-CN')))
const samplingMethodMax = computed(() => Math.max(1, ...samplingMethods.value.map((item) => item.value)))
const samplingAudit = computed(() => data.value ? buildSamplingAudit(filteredRows.value, data.value.samplingMethods) : [])
const auditByMethod = computed(() => new Map(samplingAudit.value.map((item) => [item.standard, item])))
const selectedMethod = computed<SamplingMethodItem | null>(() => samplingMethods.value.find((item) => item.name === selectedMethodName.value) ?? samplingMethods.value[0] ?? null)
const selectedMethodStatus = computed(() => selectedMethod.value ? auditByMethod.value.get(selectedMethod.value.name)?.proportionStatus ?? '未报告' : '未报告')

const countryCoverage = computed(() => buildCountryCoverage(filteredRows.value))
const analysisCoverage = computed(() => buildAnalysisCoverage(filteredRows.value))

watch(samplingMethods, (items) => {
  if (!items.some((item) => item.name === selectedMethodName.value)) selectedMethodName.value = items[0]?.name ?? ''
}, { immediate: true })

function clearFilter(key: FilterKey) {
  filters[key] = key === 'query' ? '' : 'all'
}

function resetFilters() {
  Object.assign(filters, DEFAULT_METHODOLOGY_FILTERS)
  advancedOpen.value = false
}

function setMode(mode: MethodologyMode) {
  filters.mode = mode
}

function selectMethod(item: SamplingMethodItem) {
  selectedMethodName.value = item.name
}

let compactMediaQuery: MediaQueryList | undefined
function updateCompactLayout(event: MediaQueryListEvent | MediaQueryList) {
  compactLayout.value = event.matches
}

onMounted(async () => {
  compactMediaQuery = window.matchMedia?.('(max-width: 767px)')
  if (compactMediaQuery) {
    updateCompactLayout(compactMediaQuery)
    compactMediaQuery.addEventListener('change', updateCompactLayout)
  }
  try {
    data.value = await fetchMethodologyData()
  } catch (error) {
    loadError.value = getUserErrorMessage(error, '方法学数据加载失败，请稍后重试')
  } finally {
    isLoading.value = false
  }
})

onBeforeUnmount(() => compactMediaQuery?.removeEventListener('change', updateCompactLayout))
</script>

<template>
  <main class="methodology-evidence" :class="{ 'is-compact': compactLayout }" :data-layout="compactLayout ? 'compact' : 'wide'">
    <PageHeader />
    <HeroSection :source-text="sourceText" />

    <div class="evidence-container evidence-content">
      <section v-if="isLoading" class="state-panel" data-state="loading" aria-live="polite">
        <span class="loading-spinner" aria-hidden="true"></span><strong>正在装载方法学记录</strong><p>数据加载后，筛选条件将在页面内即时联动。</p>
      </section>
      <section v-else-if="loadError" class="state-panel error" data-state="error" role="alert"><strong>{{ loadError }}</strong><p>请确认后端服务已启动，且方法学数据集已完成初始化。</p></section>
      <section v-else-if="!data?.records.length" class="state-panel" data-state="empty"><strong>暂无方法学数据</strong><p>接口已正常响应，但当前数据集没有可供核验的记录。</p></section>

      <template v-else-if="data">
        <section class="filter-panel" aria-labelledby="filterTitle">
          <header class="filter-panel__heading">
            <div><span>FILTERS</span><h2 id="filterTitle">筛选研究证据</h2><p>按研究对象、地区、采样方案和分析方法筛选当前证据范围。</p></div>
            <button v-if="activeFilters.length" class="clear-all" type="button" @click="resetFilters">清除全部</button>
          </header>

          <div class="filter-grid filter-grid--primary">
            <template v-for="definition in primaryFilters" :key="definition.key">
              <label v-if="definition.kind === 'search'" :data-filter-wrap="definition.key">
                <span>{{ definition.label }}</span>
                <input v-model="filters[definition.key]" :data-filter="definition.key" type="search" placeholder="搜索药物、标记物、采样方法或分析技术" />
              </label>
              <MethodologyFilterSelect
                v-else-if="searchableFilterKeys.has(definition.key)"
                :id="`methodology-${definition.key}`"
                :data-filter-wrap="definition.key"
                :data-filter="definition.key"
                :label="definition.label"
                :model-value="filters[definition.key]"
                :options="searchableOptions(definition)"
                :search-placeholder="`搜索${definition.label}`"
                @update:model-value="updateFilter(definition.key, $event)"
              />
              <label v-else :data-filter-wrap="definition.key">
                <span>{{ definition.label }}</span>
                <span class="native-select-wrap">
                  <select v-model="filters[definition.key]" :data-filter="definition.key">
                    <option value="all">{{ definition.allLabel }}</option>
                    <option v-for="option in optionValues(definition)" :key="option" :value="option">{{ option }}</option>
                  </select>
                  <i aria-hidden="true"></i>
                </span>
              </label>
            </template>
            <button class="advanced-toggle" type="button" :aria-expanded="advancedOpen" @click="advancedOpen = !advancedOpen">
              <span>{{ advancedOpen ? '收起更多筛选' : '更多筛选' }}</span><b v-if="advancedFilterCount">{{ advancedFilterCount }}</b><i aria-hidden="true">{{ advancedOpen ? '−' : '＋' }}</i>
            </button>
          </div>

          <div v-if="advancedOpen" class="filter-grid filter-grid--advanced">
            <template v-for="definition in advancedFilters" :key="definition.key">
              <MethodologyFilterSelect
                v-if="searchableFilterKeys.has(definition.key)"
                :id="`methodology-${definition.key}`"
                :data-filter="definition.key"
                :label="definition.label"
                :model-value="filters[definition.key]"
                :options="searchableOptions(definition)"
                :search-placeholder="`搜索${definition.label}`"
                @update:model-value="updateFilter(definition.key, $event)"
              />
              <label v-else>
                <span>{{ definition.label }}</span>
                <span class="native-select-wrap">
                  <select v-model="filters[definition.key]" :data-filter="definition.key"><option value="all">{{ definition.allLabel }}</option><option v-for="option in optionValues(definition)" :key="option" :value="option">{{ option }}</option></select>
                  <i aria-hidden="true"></i>
                </span>
              </label>
            </template>
          </div>

          <div v-if="activeFilters.length" class="active-filter-list" aria-label="当前已选筛选条件">
            <span>已选条件</span><button v-for="definition in activeFilters" :key="definition.key" type="button" @click="clearFilter(definition.key)">{{ definition.key === 'country' ? countryNameZh(filters[definition.key]) : filters[definition.key] }} <b aria-hidden="true">×</b></button>
          </div>

          <div class="filter-panel__footer">
            <div class="mode-switch-wrap">
              <span>统计口径 <small>仅影响处方属性汇总</small></span>
              <div class="mode-switch" role="group" aria-label="处方属性统计口径">
                <button v-for="item in [
                  { value: 'docs', label: '按文献统计', tip: '同一篇文献只计算一次。' },
                  { value: 'docMethods', label: '按文献—方法统计', tip: '同一篇文献采用多个标准采样方法时分别计算。' },
                  { value: 'rows', label: '按数据记录统计', tip: '按筛选后原始数据记录数量计算。' },
                ]" :key="item.value" type="button" :class="{ active: filters.mode === item.value }" :title="item.tip" @click="setMode(item.value as MethodologyMode)">{{ item.label }}</button>
              </div>
            </div>
            <p class="result-count" aria-live="polite">当前找到 <strong>{{ formatNumber(filteredDocCount) }}</strong> 篇文献</p>
          </div>

          <button class="mobile-data-note-toggle" type="button" :aria-expanded="dataNoteOpen" @click="dataNoteOpen = !dataNoteOpen">数据说明 <span aria-hidden="true">{{ dataNoteOpen ? '−' : '＋' }}</span></button>
          <div v-if="dataNoteOpen" class="mobile-data-note"><strong>原始记录 → 术语标准化 → 去重统计 → 覆盖率</strong><p>{{ sourceText }}</p><small>数据来源：WBE 文献汇总数据库</small></div>
        </section>

        <section class="metric-grid" aria-label="当前统计摘要">
          <MetricCard v-for="metric in metrics" :key="metric.label" v-bind="metric" />
        </section>

        <section class="evidence-section">
          <SectionHeader index="01" english="PRESCRIPTION STATUS" title="处方属性覆盖" description="统计具有明确处方属性的文献—属性组合。同一篇文献涉及多种属性时，将分别计入对应类别。" />
          <div v-if="prescriptionItems.length" class="prescription-chart">
            <div class="prescription-track" role="img" :aria-label="`处方属性组合共 ${prescriptionTotal} 个`">
              <span v-for="item in prescriptionItems" :key="item.name" :style="{ width: `${prescriptionTotal ? item.value / prescriptionTotal * 100 : 0}%`, background: PRESCRIPTION_COLORS[item.name] || '#91ADD9' }"><b>{{ prescriptionTotal && item.value / prescriptionTotal >= .16 ? `${item.value} · ${(item.value / prescriptionTotal * 100).toFixed(1)}%` : '' }}</b></span>
            </div>
            <div class="prescription-legend"><div v-for="item in prescriptionItems" :key="item.name"><i :style="{ background: PRESCRIPTION_COLORS[item.name] || '#91ADD9' }"></i><span>{{ item.name }}</span><strong>{{ formatNumber(item.value) }}</strong><small>{{ prescriptionTotal ? (item.value / prescriptionTotal * 100).toFixed(1) : '0.0' }}%</small></div></div>
            <p>共形成 <strong>{{ formatNumber(prescriptionTotal) }}</strong> 个{{ filters.mode === 'docs' ? '文献—处方属性组合' : filters.mode === 'docMethods' ? '文献—方法—处方属性组合' : '数据记录—处方属性组合' }}。</p>
          </div>
          <p v-else class="empty-copy">当前筛选下无明确处方属性数据。</p>
        </section>

        <section class="evidence-section">
          <SectionHeader index="02" english="SAMPLING METHODS" title="采样方法覆盖与核验" description="按“文献编号＋标准采样方法”去重，比较采样主类和标准采样方法的文献覆盖情况。" />
          <div class="sampling-overview">
            <div class="chart-panel">
              <header><h3>采样主类覆盖</h3><p>文献—标准方法组合数</p></header>
              <div class="horizontal-bars">
                <div v-for="group in samplingGroups" :key="group.name" class="horizontal-bar"><div class="horizontal-bar__label"><strong>{{ group.name }}</strong><span>{{ formatNumber(group.value) }}</span></div><div class="horizontal-bar__track"><i :style="{ width: `${group.value / samplingClassMax * 100}%`, background: group.color }"></i></div><small>{{ group.methods.length }} 种标准方法 · {{ formatNumber(group.docs) }} 篇文献</small></div>
              </div>
            </div>
            <div class="chart-panel method-ranking">
              <header><h3>标准采样方法覆盖</h3><p>按去重文献数降序</p></header>
              <div class="ranking-list">
                <button v-for="(item, index) in samplingMethods" :key="item.name" type="button" :class="{ active: selectedMethod?.name === item.name }" @click="selectMethod(item)" @pointerenter="selectMethod(item)" @focus="selectMethod(item)"><span>{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ item.name }}</strong><div><i :style="{ width: `${item.value / samplingMethodMax * 100}%`, background: item.color }"></i></div><b>{{ formatNumber(item.value) }}</b></button>
              </div>
            </div>
            <MethodDetailPanel :item="selectedMethod" :status="selectedMethodStatus" :format-number="formatNumber" />
          </div>

          <div class="subsection">
            <header class="subsection-heading"><h3>不同国家/地区的采样方法分布</h3><p>按“文献编号＋标准采样方法”去重；结果表示研究与采样方法组合数量，不代表目标物质数量。</p></header>
            <div class="country-legend"><span v-for="part in countryCoverage.items[0]?.parts || []" :key="part.name"><i :style="{ background: part.color }"></i>{{ part.name }}</span></div>
            <div v-if="countryCoverage.items.length" class="country-chart">
              <div v-for="country in countryCoverage.items" :key="country.name" class="country-row">
                <strong :title="country.name">{{ countryNameZh(country.name) }}</strong>
                <div class="country-track" :title="`${countryNameZh(country.name)}（${country.name}）：${country.parts.map((part) => `${part.name} ${part.value}`).join('，')}；总计 ${country.value}`"><span v-for="part in country.parts" :key="part.name" :style="{ width: `${part.ratio}%`, background: part.color }"><b v-if="part.value">{{ part.value }}</b></span></div>
                <b>{{ formatNumber(country.value) }}</b>
              </div>
            </div>
            <p v-else class="empty-copy">当前筛选下无国家/地区采样数据。</p>
          </div>

          <div class="subsection">
            <header class="subsection-heading"><h3>标准采样方法明细</h3><p>展示各标准采样方法的属性、文献覆盖范围及报告完整性。默认按去重文献数降序排列。</p></header>
            <ResponsiveMethodTable :items="samplingAudit" :format-number="formatNumber" />
          </div>
        </section>

        <section class="evidence-section">
          <SectionHeader index="03" english="ANALYTICAL METHODS" title="分析技术覆盖率" description="分别比较各分析技术的文献覆盖率和标记物覆盖率。两组百分比使用不同统计基数，不表示组成比例。" />
          <div class="analysis-meta"><div><span><i></i>文献覆盖率</span><span><i></i>标记物覆盖率</span></div><p>统计基数：<strong>{{ formatNumber(analysisCoverage.totalDocs) }}</strong> 篇文献，<strong>{{ formatNumber(analysisCoverage.totalMarkers) }}</strong> 个标记物。</p></div>
          <div v-if="analysisCoverage.items.length" class="analysis-chart">
            <div class="analysis-axis"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
            <article v-for="item in analysisCoverage.items" :key="item.name" class="analysis-row">
              <header><strong>{{ formatAnalysisMethodName(item.name) }}</strong><span>{{ formatNumber(item.docs) }} 篇文献 · {{ formatNumber(item.markers) }} 个标记物</span></header>
              <div class="analysis-pair"><div><span>文献覆盖率</span><i><b :style="{ width: `${item.docRate}%` }"></b></i><strong>{{ item.docRate.toFixed(1) }}%</strong></div><div><span>标记物覆盖率</span><i><b :style="{ width: `${item.markerRate}%` }"></b></i><strong>{{ item.markerRate.toFixed(1) }}%</strong></div></div>
            </article>
          </div>
          <p v-else class="empty-copy">当前筛选下无分析技术数据。</p>
        </section>
      </template>
    </div>
  </main>
</template>
