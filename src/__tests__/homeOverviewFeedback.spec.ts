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
    })
    const wrapper = await mountHome()

    await flushPromises()

    expect(wrapper.text()).toContain('首页接口暂时没有可展示的统计数据')
    expect(wrapper.text()).toContain('文献样本')
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
