import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import MethodologyFilterSelect from '../components/methodology/MethodologyFilterSelect.vue'

const options = [
  { value: 'all', label: '全部国家/地区' },
  { value: 'China', label: '中国', searchText: 'China' },
  { value: 'Australia', label: '澳大利亚', searchText: 'Australia' },
]

function mountSelect(modelValue = 'all') {
  return mount(MethodologyFilterSelect, {
    props: { id: 'country-filter', label: '国家/地区', modelValue, options },
    attachTo: document.body,
  })
}

describe('MethodologyFilterSelect', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('opens, filters by translated and source labels, selects, and marks the selected option', async () => {
    const wrapper = mountSelect()
    await wrapper.get('.methodology-filter-select__trigger').trigger('click')
    expect(wrapper.findAll('.methodology-filter-select__option')).toHaveLength(3)

    await wrapper.get('.methodology-filter-select__search input').setValue('China')
    expect(wrapper.findAll('.methodology-filter-select__option')).toHaveLength(1)
    expect(wrapper.get('.methodology-filter-select__option').text()).toContain('中国')

    await wrapper.get('.methodology-filter-select__option').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['China'])
    expect(wrapper.find('.methodology-filter-select__menu').exists()).toBe(false)
    wrapper.unmount()

    const selected = mountSelect('China')
    await selected.get('.methodology-filter-select__trigger').trigger('click')
    expect(selected.get('[aria-selected="true"]').classes()).toContain('selected')
    selected.unmount()
  })

  it('shows an empty state and closes on Escape or outside pointer', async () => {
    const wrapper = mountSelect()
    await wrapper.get('.methodology-filter-select__trigger').trigger('click')
    await wrapper.get('.methodology-filter-select__search input').setValue('不存在')
    expect(wrapper.get('.methodology-filter-select__empty').text()).toContain('没有匹配')

    await wrapper.get('.methodology-filter-select__search input').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.methodology-filter-select__menu').exists()).toBe(false)

    await wrapper.get('.methodology-filter-select__trigger').trigger('click')
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.methodology-filter-select__menu').exists()).toBe(false)
    wrapper.unmount()
  })

  it('supports arrow, Home, End and Enter keyboard selection', async () => {
    const wrapper = mountSelect()
    const trigger = wrapper.get('.methodology-filter-select__trigger')
    await trigger.trigger('keydown', { key: 'ArrowDown' })
    const search = wrapper.get('.methodology-filter-select__search input')
    await search.trigger('keydown', { key: 'End' })
    await search.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['Australia'])
    wrapper.unmount()
  })
})
