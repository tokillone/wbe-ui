import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mount, type VueWrapper } from '@vue/test-utils'
import MapBiomarkerSearch from '../components/map/MapBiomarkerSearch.vue'

const options = [
  { value: 'ALL', label: '全部生物标记物' },
  {
    value: 'health||exposure||tobacco||COTININE',
    label: '可替宁',
    meta: '486-56-6',
    description: '人体暴露类 › 生物标记物 › 烟草暴露',
    searchText: '可替宁 COTININE 486-56-6 人体暴露类 生物标记物 烟草暴露',
  },
  {
    value: 'lifestyle||tobacco||nicotine||COTININE',
    label: '可替宁',
    meta: '486-56-6',
    description: '消费/生活方式类 › 烟草使用标志物 › 尼古丁及代谢物',
    searchText: '可替宁 COTININE 486-56-6 消费生活方式类 烟草使用标志物 尼古丁及代谢物',
  },
  {
    value: 'medicine||antibiotic||macrolide||CLARITHROMYCIN',
    label: '克拉霉素',
    meta: '81103-11-9',
    description: '药物类 › 抗生素 › 大环内酯类',
    searchText: '克拉霉素 CLARITHROMYCIN 81103-11-9 药物类 抗生素 大环内酯类',
  },
]

function mountSearch(overrides: Record<string, unknown> = {}) {
  return mount(MapBiomarkerSearch, {
    attachTo: document.body,
    props: {
      id: 'quick-biomarker-search',
      label: '快速搜索生物标记物',
      options,
      placeholder: '输入名称、CAS 或分类',
      emptyText: '没有匹配的生物标记物',
      applyingText: '正在应用生物标记物…',
      ...overrides,
    },
  })
}

describe('MapBiomarkerSearch', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn<() => void>()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.innerHTML = ''
  })

  it('searches names, CAS, keys, and category paths while keeping duplicate paths distinct', async () => {
    wrapper = mountSearch()
    const input = wrapper.get('input[type="search"]')

    await input.setValue('可替宁')
    const nameResults = wrapper.findAll('.map-biomarker-search-option')
    expect(nameResults).toHaveLength(2)
    expect(nameResults[0]!.text()).toContain('可替宁')
    expect(wrapper.text()).toContain('CAS 486-56-6')
    expect(wrapper.text()).toContain('人体暴露类')
    expect(wrapper.text()).toContain('消费/生活方式类')

    await input.setValue('81103-11-9')
    expect(wrapper.findAll('.map-biomarker-search-option')).toHaveLength(1)
    expect(wrapper.text()).toContain('克拉霉素')

    await input.setValue('CLARITHROMYCIN')
    expect(wrapper.findAll('.map-biomarker-search-option')).toHaveLength(1)

    await input.setValue('烟草暴露')
    expect(wrapper.findAll('.map-biomarker-search-option')).toHaveLength(1)
    expect(wrapper.text()).toContain('人体暴露类')
  })

  it('ranks exact names before longer substring matches', async () => {
    wrapper = mountSearch({
      options: [{ value: 'hydroxy', label: '3-羟基可替宁' }, ...options],
    })
    await wrapper.get('input[type="search"]').setValue('可替宁')
    const results = wrapper.findAll('.map-biomarker-search-option')
    expect(results[0]!.text()).toContain('CAS 486-56-6')
    expect(results[0]!.text()).not.toContain('3-羟基')
  })

  it('supports keyboard selection and waits for a success signal before clearing the query', async () => {
    wrapper = mountSearch()
    const input = wrapper.get<HTMLInputElement>('input[type="search"]')

    await input.setValue('可替宁')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('select')?.[0]).toEqual([options[2]!.value])
    expect(input.element.value).toBe('可替宁')
    expect(wrapper.find('.map-biomarker-search-menu').exists()).toBe(false)

    await wrapper.setProps({ clearSignal: 1 })
    expect(input.element.value).toBe('')
  })

  it('limits results, handles empty and escape states, and disables during an apply', async () => {
    wrapper = mountSearch({
      options: Array.from({ length: 14 }, (_, index) => ({
        value: `marker-${index}`,
        label: `Marker ${index}`,
        description: `Category ${index}`,
      })),
    })
    const input = wrapper.get<HTMLInputElement>('input[type="search"]')

    await input.setValue('marker')
    expect(wrapper.findAll('.map-biomarker-search-option')).toHaveLength(10)
    await input.trigger('keydown', { key: 'Escape' })
    expect(input.element.value).toBe('')
    expect(wrapper.find('.map-biomarker-search-menu').exists()).toBe(false)

    await input.setValue('不存在')
    expect(wrapper.text()).toContain('没有匹配的生物标记物')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('select')).toBeUndefined()

    await wrapper.setProps({ disabled: true })
    expect(input.attributes('disabled')).toBeDefined()
    expect(input.attributes('placeholder')).toBe('正在应用生物标记物…')
  })

  it('supports the compact title-row presentation without visible prompt copy', () => {
    wrapper = mountSearch({ compact: true })

    expect(wrapper.classes()).toContain('compact')
    expect(wrapper.get('label').text()).toBe('快速搜索生物标记物')
    expect(wrapper.get('input').attributes('placeholder')).toBe('')
  })
})
