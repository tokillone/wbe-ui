import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mount, type VueWrapper } from '@vue/test-utils'
import MapOperationGuide, {
  type MapOperationGuideStep,
} from '../components/map/MapOperationGuide.vue'

const steps: MapOperationGuideStep[] = [
  {
    title: '先筛选证据范围',
    description: '先选择筛选条件。',
    targetSelectors: ['.guide-filter-target'],
    placement: 'right',
  },
  {
    title: '查看并进入地区',
    description: '查看地图。',
    targetSelectors: ['.guide-map-target'],
    placement: 'bottom',
  },
  {
    title: '调整地图显示',
    description: '调整地图工具。',
    targetSelectors: ['.guide-tool-target'],
    placement: 'left',
  },
]

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  }
}

describe('MapOperationGuide', () => {
  let wrapper: VueWrapper | undefined
  let rectSpy: ReturnType<typeof vi.spyOn> | undefined

  beforeEach(() => {
    document.body.innerHTML = `
      <div class="guide-filter-target"></div>
      <div class="guide-map-target"></div>
      <div class="guide-tool-target"></div>
    `
    rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getRect(this: HTMLElement) {
        if (this.classList.contains('map-operation-guide')) return rect(0, 0, 1200, 760)
        if (this.classList.contains('map-operation-guide__card')) return rect(0, 0, 344, 210)
        if (this.classList.contains('guide-filter-target')) return rect(20, 20, 316, 520)
        if (this.classList.contains('guide-map-target')) return rect(0, 0, 1200, 760)
        if (this.classList.contains('guide-tool-target')) return rect(1140, 120, 40, 120)
        return rect(0, 0, 0, 0)
      })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    rectSpy?.mockRestore()
    document.body.innerHTML = ''
  })

  it('renders a measured target and advances through the three guide steps', async () => {
    wrapper = mount(MapOperationGuide, {
      attachTo: document.body,
      props: { open: true, step: 0, steps },
    })
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[role="dialog"]').attributes('aria-modal')).toBe('true')
    expect(wrapper.text()).toContain('第 1 / 3 步')
    expect(wrapper.text()).toContain('先筛选证据范围')
    expect(wrapper.get('.map-operation-guide__target').attributes('style')).toContain('width: 332px')
    expect(wrapper.find('.map-operation-guide__previous').exists()).toBe(false)

    await wrapper.get('.map-operation-guide__next').trigger('click')
    expect(wrapper.emitted('next')).toHaveLength(1)

    await wrapper.setProps({ step: 1 })
    expect(wrapper.text()).toContain('第 2 / 3 步')
    await wrapper.get('.map-operation-guide__previous').trigger('click')
    expect(wrapper.emitted('previous')).toHaveLength(1)

    await wrapper.setProps({ step: 2 })
    expect(wrapper.get('.map-operation-guide__next').text()).toBe('开始探索')
    await wrapper.get('.map-operation-guide__next').trigger('click')
    expect(wrapper.emitted('finish')).toHaveLength(1)
  })

  it('supports skip, Escape, and initial keyboard focus', async () => {
    wrapper = mount(MapOperationGuide, {
      attachTo: document.body,
      props: { open: true, step: 0, steps },
    })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(document.activeElement).toBe(wrapper.get('.map-operation-guide__next').element)

    await wrapper.get('.map-operation-guide__skip').trigger('click')
    expect(wrapper.emitted('skip')).toHaveLength(1)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(wrapper.emitted('skip')).toHaveLength(2)
  })

  it('does not render the overlay when closed', () => {
    wrapper = mount(MapOperationGuide, {
      props: { open: false, step: 0, steps },
    })
    expect(wrapper.find('[data-map-guide]').exists()).toBe(false)
  })
})
