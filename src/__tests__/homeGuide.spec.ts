import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AcademicHomeGuide from '../components/academic/AcademicHomeGuide.vue'
const guideStub = {
  props: ['open', 'step', 'steps', 'variant'],
  emits: ['skip', 'finish', 'previous', 'next'],
  template: '<div />',
}
describe('home introduction guide', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })
  it('waits for content, remembers skip, and can be reopened', async () => {
    const wrapper = mount(AcademicHomeGuide, {
      props: { ready: false },
      global: { stubs: { OperationGuide: guideStub } },
    })
    await nextTick()
    await vi.advanceTimersByTimeAsync(1000)
    const guide = wrapper.findComponent(guideStub)
    expect(guide.props('open')).toBe(false)
    await wrapper.setProps({ ready: true })
    await vi.advanceTimersByTimeAsync(950)
    expect(guide.props('open')).toBe(true)
    guide.vm.$emit('skip')
    await nextTick()
    expect(localStorage.getItem('wbe-home-guide-v2')).toBe('seen')
    expect(guide.props('open')).toBe(false)
    wrapper.vm.start()
    await nextTick()
    expect(guide.props('open')).toBe(true)
    expect(guide.props('step')).toBe(0)
    expect(guide.props('variant')).toBe('home')
    expect(guide.props('steps')).toHaveLength(6)
    expect(guide.props('steps').map((item: { title: string }) => item.title)).toEqual([
      '空间分布查询',
      '疾病关联分析',
      '标记物优先级评估',
      '高频研究因子',
      '类别与标记物证据分布',
      '再次打开导览',
    ])
    expect(guide.props('steps')[0].targetSelectors).toEqual(['#visual-map'])
    expect(guide.props('steps')[1].targetSelectors).toEqual(['#visual-disease'])
    expect(guide.props('steps')[2].targetSelectors).toEqual(['#visual-priority'])
    expect(guide.props('steps')[5].targetSelectors).toEqual(['.platform-home-guide-button'])
    expect(wrapper.find('.home-section-navigation').exists()).toBe(false)
    wrapper.unmount()
  })
  it('does not automatically reopen for returning visitors', async () => {
    localStorage.setItem('wbe-home-guide-v2', 'seen')
    const wrapper = mount(AcademicHomeGuide, {
      props: { ready: true },
      global: { stubs: { OperationGuide: guideStub } },
    })
    await vi.advanceTimersByTimeAsync(1100)
    expect(wrapper.findComponent(guideStub).props('open')).toBe(false)
    wrapper.unmount()
  })
})
