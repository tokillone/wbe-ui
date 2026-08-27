import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SankeyMobileDrawer from '../components/sankey/SankeyMobileDrawer.vue'
import SankeyNodeSearch from '../components/sankey/SankeyNodeSearch.vue'
import SankeySelect from '../components/sankey/SankeySelect.vue'
import SankeyStageNavigator from '../components/sankey/SankeyStageNavigator.vue'

describe('SankeySelect', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('keeps full-data modes behind an advanced disclosure', async () => {
    const wrapper = mount(SankeySelect, {
      attachTo: document.body,
      props: {
        modelValue: 'smart',
        selectLabel: '显示模式',
        options: [
          { value: 'smart', label: '智能精简' },
          { value: 'top50', label: 'Top 50' },
          { value: 'all', label: '全量', advanced: true, description: '路径较多时可能影响可读性' },
        ],
      },
    })

    await wrapper.get('.sankey-select-trigger').trigger('click')
    expect(document.body.textContent).not.toContain('路径较多时可能影响可读性')

    const advancedButton = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('高级选项'),
    )
    await advancedButton?.click()
    await wrapper.vm.$nextTick()
    expect(document.body.textContent).toContain('路径较多时可能影响可读性')

    const allButton = [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.trim().startsWith('全量'),
    )
    await allButton?.click()
    const updates = wrapper.emitted('update:modelValue') ?? []
    expect(updates[updates.length - 1]).toEqual(['all'])
    wrapper.unmount()
  })

  it('supports keyboard opening and selection', async () => {
    const wrapper = mount(SankeySelect, {
      attachTo: document.body,
      props: {
        modelValue: 0,
        selectLabel: '最小权重',
        options: [
          { value: 0, label: '全部' },
          { value: 2, label: '≥2' },
        ],
      },
    })

    await wrapper.get('.sankey-select-trigger').trigger('keydown', { key: 'ArrowDown' })
    const menu = document.body.querySelector<HTMLElement>('.sankey-select-menu')
    menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await wrapper.vm.$nextTick()

    const updates = wrapper.emitted('update:modelValue') ?? []
    expect(updates[updates.length - 1]).toEqual([2])
    wrapper.unmount()
  })
})

describe('mobile Sankey navigation', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('emits the selected horizontal stage', async () => {
    const wrapper = mount(SankeyStageNavigator, {
      props: { stages: ['L1', 'L2', 'L3', '药物', '标记物'], activeIndex: 0 },
    })
    await wrapper.findAll('button')[3]?.trigger('click')
    expect(wrapper.emitted('select')).toEqual([[3]])
  })

  it('renders details in a modal drawer on mobile and closes from the backdrop', async () => {
    const wrapper = mount(SankeyMobileDrawer, {
      attachTo: document.body,
      props: { mobile: true, open: true, title: '节点详情' },
      slots: { default: '<div class="drawer-test-content">详情内容</div>' },
    })
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('详情内容')
    const backdrop = document.body.querySelector<HTMLElement>('.sankey-mobile-drawer-backdrop')
    await backdrop?.click()
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
})

describe('SankeyNodeSearch', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('updates on every input and selects an active result from the keyboard', async () => {
    const result = {
      nodeId: 'drug::布洛芬',
      name: '布洛芬',
      kind: 'drug' as const,
      depth: 3,
      weight: 20,
      pathCount: 4,
      prefixMatch: true,
    }
    const wrapper = mount(SankeyNodeSearch, {
      attachTo: document.body,
      props: { modelValue: '', results: [result] },
    })
    const input = wrapper.get('input[type="search"]')
    await input.setValue('布')
    expect(wrapper.emitted('update:modelValue')).toEqual([['布']])

    await wrapper.setProps({ modelValue: '布' })
    await input.trigger('focus')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('select')).toEqual([[result]])
    wrapper.unmount()
  })

  it('shows an explicit empty state for unmatched names', async () => {
    const wrapper = mount(SankeyNodeSearch, {
      attachTo: document.body,
      props: { modelValue: '不存在', results: [] },
    })
    await wrapper.get('input[type="search"]').trigger('focus')
    expect(document.body.textContent).toContain('未找到匹配条目')
    wrapper.unmount()
  })
})
