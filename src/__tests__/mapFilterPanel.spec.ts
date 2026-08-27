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
