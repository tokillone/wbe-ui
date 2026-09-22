import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import MapFilterPanel from '../components/map/MapFilterPanel.vue'

const selection = {
  targetClass: 'ALL',
  category: '全部目标物质类别',
  subcategory: '全部小类',
  biomarkerKey: 'ALL',
  year: '全部年份',
}

const ui = {
  filterTitle: '筛选条件',
  targetClass: '目标类别',
  category: '物质类别',
  subcategory: '物质子类',
  biomarker: '生物标记物',
  year: '年份',
  filterOptionSearch: '搜索选项',
  filterOptionEmpty: '没有匹配选项',
  biomarkerQuickSearch: '分层搜索筛选条件',
  biomarkerSearchPlaceholder: '输入类别、子类、标记物、CAS 或年份',
  biomarkerSearchEmpty: '没有匹配的筛选条件',
  biomarkerSearchApplying: '正在应用筛选条件…',
  resetFilters: '重置',
  applyFilters: '应用',
  applyingFilters: '应用中…',
  collapseFilters: '收起筛选条件',
  expandFilters: '展开筛选条件',
}

function mountPanel(overrides: Record<string, unknown> = {}) {
  return mount(MapFilterPanel, {
    props: {
      ui,
      open: true,
      selection,
      biomarkerPathKey: 'ALL',
      targetClassOptions: [
        { value: 'ALL', label: '全部' },
        { value: 'health', label: '健康' },
      ],
      categoryOptions: [{ value: '全部目标物质类别', label: '全部' }],
      subcategoryOptions: [{ value: '全部小类', label: '全部' }],
      biomarkerOptions: [{ value: 'ALL', label: '全部生物标记物' }],
      yearOptions: [{ value: '全部年份', label: '全部年份' }],
      loadingFilters: false,
      dirty: false,
      applying: false,
      filtersReady: true,
      searchClearSignal: 0,
      searchOptions: [
        {
          value: 'biomarker||health||exposure||tobacco||COTININE',
          label: '可替宁',
          meta: '486-56-6',
          levelLabel: '生物标记物',
          description: '人体暴露类 › 生物标记物 › 烟草暴露',
        },
      ],
      ...overrides,
    },
  })
}

describe('MapFilterPanel explicit apply mode', () => {
  it('stages field changes without emitting apply and submits only from the apply button', async () => {
    const wrapper = mountPanel()
    const applyButton = wrapper.get<HTMLButtonElement>('.filter-apply-button')
    expect(applyButton.text()).toBe('应用')
    expect(applyButton.attributes('disabled')).toBeDefined()

    await wrapper.get('#map-target-class-filter').trigger('click')
    await wrapper.findAll('.map-filter-select-option')[1]!.trigger('click')
    expect(wrapper.emitted('change')).toEqual([['targetClass', 'health']])
    expect(wrapper.emitted('apply')).toBeUndefined()

    await wrapper.setProps({ dirty: true })
    expect(wrapper.get('.filter-apply-button').attributes('disabled')).toBeUndefined()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('apply')).toHaveLength(1)
  })

  it('emits the reset action and locks the form while applying', async () => {
    const wrapper = mountPanel({ dirty: true })
    await wrapper.get('.filter-reset-button').trigger('click')
    expect(wrapper.emitted('reset')).toHaveLength(1)
    expect(wrapper.emitted('apply')).toBeUndefined()

    await wrapper.setProps({ applying: true })
    expect(wrapper.get('form').attributes('aria-busy')).toBe('true')
    expect(wrapper.get('.filter-apply-button').text()).toBe('应用中…')
    expect(wrapper.get('.filter-apply-button').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.filter-reset-button').attributes('disabled')).toBeDefined()
    expect(wrapper.get('#map-target-class-filter').attributes('disabled')).toBeDefined()

    await wrapper.setProps({ applying: false, filtersReady: false })
    expect(wrapper.get('.filter-apply-button').attributes('disabled')).toBeDefined()
  })

  it('exposes the quick biomarker search as an immediate-apply event', async () => {
    const wrapper = mountPanel({
      searchOptions: [
        {
          value: 'category||health||exposure',
          label: '生物标记物',
          levelLabel: '物质类别',
          description: '人体暴露类',
        },
      ],
    })

    const headerSearch = wrapper.get('.filter-head .map-biomarker-search')
    expect(headerSearch.classes()).toContain('compact')
    expect(headerSearch.get('label').text()).toBe('分层搜索筛选条件')
    expect(headerSearch.get('input').attributes('placeholder')).toBe('')

    await wrapper.get('#map-biomarker-quick-search').setValue('生物标记物')
    await wrapper.get('.map-biomarker-search-option').trigger('click')
    expect(wrapper.emitted('selectSearchResult')).toEqual([['category||health||exposure']])
    expect(wrapper.emitted('apply')).toBeUndefined()
  })

  it('keeps dropdown selection but removes search fields from every staged filter', async () => {
    const wrapper = mountPanel()
    for (const id of [
      '#map-target-class-filter',
      '#map-category-filter',
      '#map-subcategory-filter',
      '#map-biomarker-filter',
      '#map-year-filter',
    ]) {
      await wrapper.get(id).trigger('click')
      expect(wrapper.find('.map-filter-select-search').exists()).toBe(false)
      await wrapper.get(id).trigger('click')
    }
  })
})

describe('map filter transaction source invariants', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/views/MapVisualizationView.vue'), 'utf8')
  const styleSource = readFileSync(
    resolve(process.cwd(), 'src/styles/map-visualization.css'),
    'utf8',
  )
  const applyStart = source.indexOf('async function applyFilters')
  const applyEnd = source.indexOf('function waitForMapDataRender', applyStart)
  const applySource = source.slice(applyStart, applyEnd)
  const detailApplySource = source.slice(
    source.indexOf('async function applyDetailBiomarker'),
    source.indexOf('function handleMapKeydown'),
  )
  const resetSource = source.slice(
    source.indexOf('async function resetFilters'),
    source.indexOf('function updateFilterSelection'),
  )
  const categoryChangeSource = source.slice(
    source.indexOf('async function updateFilterSelection'),
    source.indexOf('async function selectBiomarkerPath'),
  )
  const heatScaleSource = source.slice(
    source.indexOf('function heatScaleForLevel'),
    source.indexOf('function compactHeatRegionIdSet'),
  )

  it('commits one selection-plus-stats snapshot only after the latest request resolves', () => {
    expect(source).toContain('const appliedSnapshot = ref<MapVisualizationSnapshot>')
    expect(source).toContain('() => !stats.value || !filterSelectionsEqual')
    expect(applySource).toContain('const nextStats = await fetchMapStats')
    expect(applySource).toContain(
      'if (requestId !== statsRequestId || controller.signal.aborted) return',
    )
    expect(applySource).toContain('appliedSnapshot.value = {')
    expect(applySource.indexOf('const nextStats = await fetchMapStats')).toBeLessThan(
      applySource.indexOf('appliedSnapshot.value = {'),
    )
    expect(applySource).toContain('if (requestId === statsRequestId)')
    expect(source).not.toContain('scheduleStatsFetch')
  })

  it('keeps detail APIs on the applied snapshot and masks the rendered data during commit', () => {
    expect(source).toContain('{ ...appliedSelection.value }')
    expect(source).toContain('v-if="isLoadingStats" class="map-data-transition"')
    expect(source).toContain(':dirty="filtersDirty"')
    expect(source).toContain('@apply="applyFilters()"')
  })

  it('applies reset and compact-detail biomarker actions immediately through the same transaction', () => {
    expect(resetSource).toContain('await applyFilters({ force: true })')
    expect(detailApplySource).toContain('await applyFilters({ force: true })')
    expect(detailApplySource).not.toContain('closeDetail()')
    expect(source).toContain("applyFilters: '应用'")
  })

  it('applies layered search selections once and clears the query only after a successful map update', () => {
    const searchApplySource = source.slice(
      source.indexOf('async function applyFilterSearchResult'),
      source.indexOf('function readInitialLocale'),
    )
    expect(searchApplySource).toContain('Object.assign(selection, nextSelection)')
    expect(searchApplySource).toContain('await applyFilters({ force: true })')
    expect(searchApplySource.match(/applyFilters\(/g)).toHaveLength(1)
    expect(searchApplySource).toContain('if (applied) filterSearchClearSignal.value += 1')
    expect(source).toContain('@select-search-result="applyFilterSearchResult"')
  })

  it('normalizes a category draft without requesting stats and caches heat scales by snapshot level', () => {
    expect(categoryChangeSource).toContain('selectionForCategory(')
    expect(categoryChangeSource).toContain('Object.assign(selection, nextSelection)')
    expect(categoryChangeSource).not.toContain('applyFilters(')
    expect(categoryChangeSource).not.toContain('fetchMapStats(')
    expect(heatScaleSource).toContain('adaptiveHeatScaleStats !== stats.value')
    expect(heatScaleSource).toContain('adaptiveHeatScaleCache.get(level)')
    expect(heatScaleSource).toContain('adaptiveHeatScaleCache.set(level, scale)')
    expect(heatScaleSource).not.toContain('fetchMapStats(')
    expect(source).not.toContain('stats.value?.legend.min')
    expect(source).not.toContain('stats.value?.legend.max')
    expect(source).not.toContain('stats.value?.legend.colors')
    expect(source).toContain('stats.value?.legend.unit')
  })

  it('uses a fixed mercator map with no globe mode or globe control', () => {
    expect(source).toContain("projection: { type: 'mercator' }")
    expect(source).not.toMatch(/\bglobe\b/i)
    expect(styleSource).not.toMatch(/\bglobe\b/i)
    expect(source).not.toContain('type MapMode')
    expect(source).not.toContain('setMapMode')
  })
})
