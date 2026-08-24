import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mount, type VueWrapper } from '@vue/test-utils'
import MapFilterSelect from '../components/MapFilterSelect.vue'

const options = [
  { value: 'ALL', label: '全部' },
  { value: 'alpha', label: '阿尔法标记物' },
  { value: 'beta', label: 'Beta marker' },
]

function mountSelect(overrides: Record<string, unknown> = {}) {
  return mount(MapFilterSelect, {
    attachTo: document.body,
    props: {
      id: 'test-filter',
      label: '生物标记物',
      modelValue: 'ALL',
      options,
      searchPlaceholder: '搜索选项',
      emptyText: '没有匹配选项',
      ...overrides,
    },
  })
}

describe('MapFilterSelect', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.innerHTML = ''
  })

  it('searches options and selects one with a visible selected state', async () => {
    wrapper = mountSelect()
    await wrapper.get('.map-filter-select-trigger').trigger('click')

    const search = wrapper.get('input[type="search"]')
    await search.setValue('beta')
    expect(wrapper.findAll('.map-filter-select-option')).toHaveLength(1)
    expect(wrapper.text()).toContain('Beta marker')

    await wrapper.get('.map-filter-select-option').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['beta']])
    expect(wrapper.find('.map-filter-select-menu').exists()).toBe(false)
  })

  it('supports arrow-key opening, selection, escape, and focus return', async () => {
    wrapper = mountSelect()
    const trigger = wrapper.get<HTMLButtonElement>('.map-filter-select-trigger')
    await trigger.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.find('.map-filter-select-menu').exists()).toBe(true)

    const search = wrapper.get('input[type="search"]')
    await search.trigger('keydown', { key: 'ArrowDown' })
    await search.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['alpha'])
    expect(document.activeElement).toBe(trigger.element)

    await trigger.trigger('keydown', { key: 'ArrowDown' })
    await wrapper.get('input[type="search"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.map-filter-select-menu').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)
  })

  it('closes on outside interaction and opens upward when space below is limited', async () => {
    wrapper = mountSelect()
    const trigger = wrapper.get<HTMLButtonElement>('.map-filter-select-trigger')
    vi.spyOn(trigger.element, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 700,
      top: 700,
      right: 300,
      bottom: 742,
      left: 0,
      width: 300,
      height: 42,
      toJSON: () => ({}),
    })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })

    await trigger.trigger('click')
    expect(wrapper.classes()).toContain('opens-up')
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.map-filter-select-menu').exists()).toBe(false)
  })

  it('shows an empty result and respects the disabled state', async () => {
    wrapper = mountSelect()
    await wrapper.get('.map-filter-select-trigger').trigger('click')
    await wrapper.get('input[type="search"]').setValue('不存在')
    expect(wrapper.text()).toContain('没有匹配选项')

    wrapper.unmount()
    wrapper = mountSelect({ disabled: true })
    const trigger = wrapper.get<HTMLButtonElement>('.map-filter-select-trigger')
    expect(trigger.attributes('disabled')).toBeDefined()
    await trigger.trigger('click')
    expect(wrapper.find('.map-filter-select-menu').exists()).toBe(false)
  })
})
