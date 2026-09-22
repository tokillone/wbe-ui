import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mount, type VueWrapper } from '@vue/test-utils'
import OperationGuide, { type OperationGuideStep } from '../components/OperationGuide.vue'

const steps: OperationGuideStep[] = [
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

describe('OperationGuide', () => {
  let wrapper: VueWrapper | undefined
  let rectSpy: ReturnType<typeof vi.spyOn> | undefined

  beforeEach(() => {
    document.body.innerHTML = `
      <div class="guide-filter-target"></div>
      <div class="guide-map-target"></div>
      <div class="guide-tool-target"></div>
      <div class="guide-clipped-target"></div>
    `
    rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getRect(this: HTMLElement) {
        if (this.classList.contains('operation-guide')) return rect(0, 0, 1200, 760)
        if (this.classList.contains('operation-guide__card')) return rect(0, 0, 344, 210)
        if (this.tagName === 'IFRAME') return rect(100, 80, 600, 500)
        if (this.classList.contains('guide-filter-target')) return rect(20, 20, 316, 520)
        if (this.classList.contains('guide-map-target')) return rect(0, 0, 1200, 760)
        if (this.classList.contains('guide-tool-target')) return rect(1140, 120, 40, 120)
        if (this.classList.contains('guide-clipped-target')) return rect(-50, -30, 200, 100)
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
    wrapper = mount(OperationGuide, {
      attachTo: document.body,
      props: { open: true, step: 0, steps },
    })
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[role="dialog"]').attributes('aria-modal')).toBe('true')
    expect(wrapper.text()).toContain('第 1 / 3 步')
    expect(wrapper.text()).toContain('先筛选证据范围')
    expect(wrapper.get('.operation-guide__target').attributes('style')).toContain('width: 332px')
    expect(wrapper.find('.operation-guide__previous').exists()).toBe(false)

    await wrapper.get('.operation-guide__next').trigger('click')
    expect(wrapper.emitted('next')).toHaveLength(1)

    await wrapper.setProps({ step: 1 })
    expect(wrapper.text()).toContain('第 2 / 3 步')
    await wrapper.get('.operation-guide__previous').trigger('click')
    expect(wrapper.emitted('previous')).toHaveLength(1)

    await wrapper.setProps({ step: 2 })
    expect(wrapper.get('.operation-guide__next').text()).toBe('开始探索')
    await wrapper.get('.operation-guide__next').trigger('click')
    expect(wrapper.emitted('finish')).toHaveLength(1)
  })

  it('supports skip, Escape, and initial keyboard focus', async () => {
    wrapper = mount(OperationGuide, {
      attachTo: document.body,
      props: { open: true, step: 0, steps },
    })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(document.activeElement).toBe(wrapper.get('.operation-guide__next').element)

    await wrapper.get('.operation-guide__skip').trigger('click')
    expect(wrapper.emitted('skip')).toHaveLength(1)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(wrapper.emitted('skip')).toHaveLength(2)
  })

  it('traps keyboard focus inside the card and restores the trigger focus on close', async () => {
    const previous = document.createElement('button')
    previous.textContent = 'previous focus'
    document.body.appendChild(previous)
    const trigger = document.createElement('button')
    trigger.textContent = 'open guide'
    document.body.appendChild(trigger)
    previous.focus()

    wrapper = mount(OperationGuide, {
      attachTo: document.body,
      props: { open: false, step: 0, steps, returnFocusTo: trigger },
    })
    await wrapper.setProps({ open: true })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const skip = wrapper.get<HTMLButtonElement>('.operation-guide__skip').element
    const next = wrapper.get<HTMLButtonElement>('.operation-guide__next').element
    expect(document.activeElement).toBe(next)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(skip)
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
    )
    expect(document.activeElement).toBe(next)

    await wrapper.setProps({ open: false })
    await wrapper.vm.$nextTick()
    expect(document.activeElement).toBe(trigger)
  })

  it('clips targets to the visible viewport and falls back to a centered card when missing', async () => {
    wrapper = mount(OperationGuide, {
      attachTo: document.body,
      props: {
        open: true,
        step: 0,
        steps: [
          {
            title: 'clipped target',
            description: 'clipped target description',
            targetSelectors: ['.guide-clipped-target'],
            placement: 'bottom',
          },
        ],
      },
    })
    await wrapper.vm.$nextTick()

    const clippedStyle = wrapper.get('.operation-guide__target').attributes('style')
    expect(clippedStyle).toContain('left: 0px')
    expect(clippedStyle).toContain('top: 0px')
    expect(clippedStyle).toContain('width: 166px')

    wrapper.unmount()
    wrapper = mount(OperationGuide, {
      attachTo: document.body,
      props: {
        open: true,
        step: 0,
        steps: [
          {
            title: 'missing target',
            description: 'missing target description',
            targetSelectors: ['.guide-target-that-does-not-exist'],
            placement: 'bottom',
          },
        ],
      },
    })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.operation-guide__target').exists()).toBe(false)
    expect(wrapper.find('.operation-guide__backdrop').exists()).toBe(true)
    expect(wrapper.get('.operation-guide__card').attributes('style')).toContain('left: 428px')
  })

  it('does not render the overlay when closed', () => {
    wrapper = mount(OperationGuide, {
      props: { open: false, step: 0, steps },
    })
    expect(wrapper.find('[data-operation-guide]').exists()).toBe(false)
  })

  it('renders the compact six-segment homepage presentation', async () => {
    const homeSteps = Array.from({ length: 6 }, (_, index) => ({
      title: `首页步骤 ${index + 1}`,
      description: `首页步骤说明 ${index + 1}`,
      targetSelectors: ['.guide-map-target'],
      placement: 'bottom' as const,
    }))
    wrapper = mount(OperationGuide, {
      attachTo: document.body,
      props: { open: true, step: 5, steps: homeSteps, variant: 'home' },
    })
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-operation-guide]').classes()).toContain('is-home')
    expect(wrapper.findAll('.operation-guide__rail i')).toHaveLength(6)
    expect(wrapper.findAll('.operation-guide__rail i.active')).toHaveLength(6)
    expect(wrapper.get('.operation-guide__progress').text()).toBe('6 / 6')
    expect(wrapper.get('.operation-guide__skip').text()).toBe('跳过')
    expect(wrapper.get('.operation-guide__next').text()).toBe('完成')
  })

  it('measures and scrolls a same-origin iframe target in host viewport coordinates', async () => {
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const frameDocument = frame.contentDocument!
    frameDocument.body.innerHTML = '<div class="frame-target"></div>'
    const frameTarget = frameDocument.querySelector<HTMLElement>('.frame-target')!
    vi.spyOn(frameTarget, 'getBoundingClientRect').mockReturnValue(rect(20, 30, 200, 120))
    const scrollIntoView = vi.fn()
    frameTarget.scrollIntoView = scrollIntoView

    wrapper = mount(OperationGuide, {
      attachTo: document.body,
      props: {
        open: true,
        step: 0,
        steps: [
          {
            title: 'iframe target',
            description: 'iframe target description',
            targetSelectors: ['.frame-target'],
            placement: 'right',
            scrollIntoView: true,
          },
        ],
        targetDocument: frameDocument,
        targetFrame: frame,
      },
    })
    await wrapper.vm.$nextTick()

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    })
    const style = wrapper.get('.operation-guide__target').attributes('style')
    expect(style).toContain('left: 112px')
    expect(style).toContain('top: 102px')
    expect(style).toContain('width: 216px')
  })
})
