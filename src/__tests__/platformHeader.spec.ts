import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import PlatformHeader from '../components/PlatformHeader.vue'

const routes = [
  { path: '/', component: { template: '<div>home</div>' } },
  { path: '/map-visualization', component: { template: '<div>map</div>' } },
  { path: '/icd11-sankey', component: { template: '<div>sankey</div>' } },
  { path: '/core-marker-priority', component: { template: '<div>priority</div>' } },
  { path: '/methodology-verification', component: { template: '<div>methodology</div>' } },
  { path: '/data-entry', component: { template: '<div>data</div>' } },
]

async function mountHeader(path = '/', props: Record<string, unknown> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  return mount(PlatformHeader, {
    props,
    global: { plugins: [router] },
  })
}

describe('PlatformHeader', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders one consistent brand, module navigation and account action', async () => {
    const wrapper = await mountHeader('/')

    expect(wrapper.get('.platform-brand').attributes('aria-label')).toBe('污水信息因子数据库首页')
    expect(wrapper.get('.platform-brand-copy').text()).toContain('WASTEWATER BIOMARKER EVIDENCE')
    expect(wrapper.findAll('.platform-navigation a').map((link) => link.text())).toEqual([
      '首页',
      '空间分布查询',
      '疾病关联分析',
      '标记物优先级评估',
      '采样与分析方法核验',
    ])
    expect(wrapper.get('.platform-navigation a[aria-current="page"]').text()).toBe('首页')
    expect(wrapper.get('.platform-login-button').text()).toContain('登录 / 注册')
    expect(wrapper.get('.platform-menu-button').attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.platform-search-slot').exists()).toBe(false)
    expect(wrapper.find('input[type="search"]').exists()).toBe(false)
  })

  it('derives the current module from the route and toggles mobile navigation accessibly', async () => {
    const wrapper = await mountHeader('/icd11-sankey')
    const menuButton = wrapper.get('.platform-menu-button')

    expect(wrapper.get('.platform-navigation a[aria-current="page"]').text()).toBe('疾病关联分析')
    await menuButton.trigger('click')
    expect(menuButton.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.platform-navigation').classes()).toContain('is-open')
  })

  it('renders page context only when requested', async () => {
    const wrapper = await mountHeader('/map-visualization', {
      showContext: true,
      pageTitle: '空间分布查询',
      pageSubtitle: '全球采样点与研究覆盖',
    })

    expect(wrapper.get('.platform-context-heading strong').text()).toBe('空间分布查询')
    expect(wrapper.get('.platform-context-heading small').text()).toBe('全球采样点与研究覆盖')
    expect(wrapper.get('.platform-skip-link').attributes('href')).toBe('#main-content')
  })
})
