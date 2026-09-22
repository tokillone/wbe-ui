import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const { fetchOverviewMock } = vi.hoisted(() => ({
  fetchOverviewMock: vi.fn(),
}))

vi.mock('../config/api', () => ({
  HOME_OVERVIEW_API_ENABLED: true,
}))

vi.mock('../services/home', () => {
  class HomeOverviewRequestError extends Error {
    kind: string

    constructor(kind: string, message: string) {
      super(message)
      this.kind = kind
    }
  }

  return {
    fetchHomeOverview: fetchOverviewMock,
    HomeOverviewRequestError,
  }
})

import HomeView from '../views/HomeView.vue'
import { HomeOverviewRequestError } from '../services/home'

async function mountHome() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div>home</div>' } }],
  })
  await router.push('/')
  await router.isReady()
  return mount(HomeView, {
    global: {
      plugins: [router],
    },
  })
}

describe('home overview feedback', () => {
  afterEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('shows an explicit empty-data message while retaining baseline values', async () => {
    fetchOverviewMock.mockResolvedValue({
      biomarkerFrequencies: [],
      targetCategoryOptions: [],
      keywords: [],
    })
    const wrapper = await mountHome()

    await flushPromises()

    expect(wrapper.text()).toContain('首页接口暂时没有可展示的统计数据')
    expect(wrapper.text()).toContain('高频研究因子')
    expect(wrapper.text()).toContain('类别与标记物证据分布')
    wrapper.unmount()
  })

  it('distinguishes an incompatible API from a real empty keyword result', async () => {
    fetchOverviewMock.mockResolvedValue({
      biomarkerFrequencies: [{ name: '抗生素', frequency: 1 }],
      targetCategoryOptions: [],
    })
    const wrapper = await mountHome()
    await flushPromises()

    expect(wrapper.text()).toContain('当前首页接口版本缺少研究因子数据')
    expect(wrapper.get('.factor-cloud-canvas').attributes('data-state')).toBe('incompatible')
    expect(wrapper.get('.factor-cloud-empty button').text()).toBe('重新加载')
    wrapper.unmount()
  })

  it('keeps request failures compact and supports retry', async () => {
    fetchOverviewMock
      .mockRejectedValueOnce(new HomeOverviewRequestError('failed', '首页数据服务暂时不可用'))
      .mockResolvedValueOnce({
        biomarkerFrequencies: [{ name: '抗生素', frequency: 1 }],
        keywords: [{ name: '可替宁', value: 2, category: 'consumer' }],
      })
    const wrapper = await mountHome()
    await flushPromises()

    expect(wrapper.get('.factor-cloud-canvas').attributes('data-state')).toBe('error')
    expect(wrapper.text()).toContain('研究因子加载失败')
    await wrapper.get('.factor-cloud-empty button').trigger('click')
    await flushPromises()
    expect(wrapper.get('.factor-cloud-canvas').attributes('data-state')).toBe('ready')
    expect(wrapper.find('.factor-motion-control').exists()).toBe(false)
    expect(wrapper.find('.factor-orbit').exists()).toBe(true)
    wrapper.unmount()
  })

  it('offers login when the public overview unexpectedly returns unauthorized', async () => {
    fetchOverviewMock.mockRejectedValue(
      new HomeOverviewRequestError('unauthorized', '登录状态已失效'),
    )
    const wrapper = await mountHome()

    await flushPromises()

    expect(wrapper.text()).toContain('登录状态已失效')
    expect(wrapper.text()).toContain('登录后重试')
    wrapper.unmount()
  })
})
