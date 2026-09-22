import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AcademicFactorCloud from '../components/academic/AcademicFactorCloud.vue'

const items = Array.from({ length: 64 }, (_, i) => ({
  name: `研究因子${i + 1}`,
  value: 64 - i,
  category: 'drug',
  targetLabel: '抗菌药',
}))

let animationFrames: FrameRequestCallback[] = []
let frameId = 0

async function settleOrbit() {
  await nextTick()
  await nextTick()
}

describe('factor cloud interaction', () => {
  beforeEach(() => {
    animationFrames = []
    frameId = 0
    vi.stubGlobal('innerWidth', 1200)
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        animationFrames.push(callback)
        return ++frameId
      }),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders one transparent orbit word per desktop item and keeps detail interaction', async () => {
    const wrapper = mount(AcademicFactorCloud, {
      props: { items },
      attachTo: document.body,
    })
    await settleOrbit()

    expect(wrapper.findAll('.factor-cloud-word')).toHaveLength(64)
    expect(wrapper.find('.factor-marquee-row').exists()).toBe(false)
    expect(wrapper.find('.factor-cloud-word-copy').exists()).toBe(false)
    const firstWord = wrapper.get<HTMLButtonElement>('.factor-cloud-word')
    expect(firstWord.attributes('aria-label')).toContain('64 篇文献')
    expect(firstWord.attributes('style')).toContain('--factor-ink')
    expect(firstWord.attributes('style')).toContain('--orbit-scale')
    expect(firstWord.element.tagName).toBe('BUTTON')

    await wrapper.get('.factor-cloud-canvas').trigger('pointerenter')
    expect(wrapper.get('.factor-cloud-canvas').attributes('data-paused')).toBe('true')
    await wrapper.get('.factor-cloud-canvas').trigger('pointerleave')
    expect(wrapper.get('.factor-cloud-canvas').attributes('data-paused')).toBe('false')

    const rotationBeforeOpen = wrapper.get('.factor-cloud-canvas').attributes('data-orbit-rotation')
    await firstWord.trigger('focusin')
    await firstWord.trigger('click')
    expect(wrapper.get('.factor-detail').text()).toContain('研究因子1')
    expect(wrapper.get('.factor-detail').text()).toContain('暂无')
    expect(firstWord.classes()).toContain('is-selected')
    expect(wrapper.get('.factor-cloud-canvas').attributes('data-paused')).toBe('true')

    const pausedFrame = animationFrames.shift()
    pausedFrame?.(performance.now() + 16)
    await nextTick()
    expect(wrapper.get('.factor-cloud-canvas').attributes('data-orbit-rotation')).toBe(
      rotationBeforeOpen,
    )

    await wrapper.get('.factor-detail header button').trigger('click')
    await nextTick()
    expect(wrapper.find('.factor-detail').exists()).toBe(false)
    expect(document.activeElement).toBe(firstWord.element)
    expect(wrapper.get('.factor-cloud-canvas').attributes('data-paused')).toBe('false')
    expect(wrapper.get('.factor-cloud-canvas').attributes('data-orbit-rotation')).toBe(
      rotationBeforeOpen,
    )
    wrapper.unmount()
  })

  it('uses the requested tablet and mobile density with smaller mobile type', async () => {
    vi.stubGlobal('innerWidth', 1512)
    const wideDesktop = mount(AcademicFactorCloud, { props: { items } })
    await settleOrbit()
    expect(wideDesktop.findAll('.factor-cloud-word')).toHaveLength(64)
    wideDesktop.unmount()

    vi.stubGlobal('innerWidth', 900)
    const tablet = mount(AcademicFactorCloud, { props: { items } })
    await settleOrbit()
    expect(tablet.findAll('.factor-cloud-word')).toHaveLength(48)
    tablet.unmount()

    vi.stubGlobal('innerWidth', 390)
    const mobile = mount(AcademicFactorCloud, { props: { items } })
    await settleOrbit()
    expect(mobile.findAll('.factor-cloud-word')).toHaveLength(28)
    expect(mobile.get('.factor-cloud-word').attributes('style')).toContain('font-size: 32.68px')
    mobile.unmount()
  })

  it('keeps the scientific grid and summary without a filter toolbar or explanatory subtitle', async () => {
    const categorizedItems = items.map((item, index) => ({
      ...item,
      category: index < 40 ? 'drug' : 'consumer',
      targetLabel: index < 40 ? 'N 神经系统药物' : '消费与生活方式类',
    }))
    const wrapper = mount(AcademicFactorCloud, { props: { items: categorizedItems } })
    await settleOrbit()

    expect(wrapper.find('.factor-cloud-card').exists()).toBe(true)
    expect(wrapper.get('.factor-title-copy').text()).not.toContain('字号反映 DOI 去重文献量')
    expect(wrapper.get('.factor-summary').text()).toContain('64')
    expect(wrapper.get('.factor-summary').text()).toContain('2类')
    expect(wrapper.find('.factor-science-layer').attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('.factor-category-filter').exists()).toBe(false)
    expect(wrapper.find('.factor-cloud-toolbar').exists()).toBe(false)
    expect(wrapper.findAll('.factor-cloud-word')).toHaveLength(64)
    wrapper.unmount()
  })

  it('keeps sparse data static and centers keyboard interaction on real buttons', async () => {
    const wrapper = mount(AcademicFactorCloud, { props: { items: items.slice(0, 2) } })
    await settleOrbit()

    expect(wrapper.findAll('.factor-cloud-word')).toHaveLength(2)
    expect(wrapper.get('.factor-orbit').classes()).toContain('is-sparse')
    expect(wrapper.get('.factor-cloud-canvas').attributes('data-paused')).toBe('true')
    const firstWord = wrapper.get('.factor-cloud-word')
    await firstWord.trigger('focusin')
    expect(wrapper.get('.factor-cloud-canvas').attributes('data-paused')).toBe('true')
    expect(firstWord.attributes('style')).toContain('--orbit-x')
    wrapper.unmount()
  })

  it('starts focus positioning through the animation frame and respects reduced motion', async () => {
    const wrapper = mount(AcademicFactorCloud, { props: { items } })
    await settleOrbit()
    const firstWord = wrapper.get('.factor-cloud-word')
    await firstWord.trigger('focusin')
    expect(wrapper.get('.factor-cloud-canvas').attributes('data-paused')).toBe('true')
    expect(animationFrames.length).toBeGreaterThan(0)
    wrapper.unmount()

    animationFrames = []
    vi.mocked(requestAnimationFrame).mockClear()
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    const reduced = mount(AcademicFactorCloud, { props: { items } })
    await settleOrbit()
    expect(reduced.findAll('.factor-cloud-word')).toHaveLength(64)
    expect(reduced.get('.factor-cloud-canvas').attributes('data-paused')).toBe('true')
    expect(requestAnimationFrame).not.toHaveBeenCalled()

    await reduced.setProps({ items: [] })
    await settleOrbit()
    expect(reduced.text()).toContain('数据库当前没有研究因子记录')
    expect(reduced.find('.factor-cloud-word').exists()).toBe(false)
    reduced.unmount()
  })
})
