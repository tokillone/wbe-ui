import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import PlatformHeader from '../components/PlatformHeader.vue'
import { saveSession } from '../services/session'

const routes = [
  { path: '/', component: { template: '<div>home</div>' } },
  { path: '/map-visualization', component: { template: '<div>map</div>' } },
  { path: '/icd11-sankey', component: { template: '<div>sankey</div>' } },
  { path: '/core-marker-priority', component: { template: '<div>priority</div>' } },
  { path: '/methodology-verification', component: { template: '<div>methodology</div>' } },
  { path: '/guide', component: { template: '<div>guide</div>' } },
  { path: '/about', component: { template: '<div>about</div>' } },
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
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
  })

  afterEach(() => vi.restoreAllMocks())

  it('renders one consistent brand, module navigation and account action', async () => {
    const wrapper = await mountHeader('/', { variant: 'legacy' })

    expect(wrapper.get('.platform-brand').attributes('aria-label')).toBe('污水信息因子数据库首页')
    expect(wrapper.get('.platform-brand-copy').text()).toContain('WASTEWATER BIOMARKER EVIDENCE')
    expect(wrapper.findAll('.platform-navigation a').map((link) => link.text())).toEqual([
      '首页',
      '空间分布查询',
      '疾病关联分析',
      '标记物优先级评估',
    ])
    expect(wrapper.get('.platform-navigation a[aria-current="page"]').text()).toBe('首页')
    expect(wrapper.get('.platform-login-button').text()).toBe('登录')
    expect(wrapper.get('.platform-login-button').attributes('aria-label')).toBe('登录 WBE 数据平台')
    expect(wrapper.get('.platform-menu-button').attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.platform-search-slot').exists()).toBe(false)
    expect(wrapper.find('input[type="search"]').exists()).toBe(false)
  })

  it('derives the current module from the route and toggles mobile navigation accessibly', async () => {
    const wrapper = await mountHeader('/icd11-sankey')
    const menuButton = wrapper.get('.platform-menu-button')

    expect(wrapper.get('.platform-navigation a[aria-current="page"]').text()).toContain(
      '可视化分析',
    )
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

  it('renders the academic navigation with an accessible three-option analysis menu', async () => {
    const wrapper = await mountHeader('/')

    expect(wrapper.get('.platform-header-shell').classes()).toContain('is-academic')
    expect(wrapper.get('.platform-header-shell').classes()).toContain('is-home')
    expect(wrapper.get('.platform-brand').attributes('aria-label')).toBe('污水信息因子数据库首页')
    expect(wrapper.get('.platform-login-button').text()).toBe('登录')
    expect(wrapper.findAll('.academic-navigation > a').map((link) => link.text())).toEqual([
      '首页',
      '使用说明',
      '关于',
    ])
    expect(wrapper.findAll('.academic-analysis-submenu a').map((link) => link.text())).toEqual([
      '空间分布查询',
      '疾病关联分析',
      '标记物优先级评估',
    ])

    const toggle = wrapper.get('.academic-analysis-toggle')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.academic-analysis-menu').classes()).toContain('is-open')
  })

  it('uses a compact account control after login', async () => {
    saveSession({
      token: 'test-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
      user: {
        userId: 1,
        username: 'admin',
        email: 'admin@example.com',
        role: 'admin',
        canUpload: true,
        canReviewUploads: true,
        canSyncData: true,
        canDownload: true,
        isActive: true,
      },
    })
    const wrapper = await mountHeader('/')
    const summary = wrapper.get('.platform-account-menu summary')

    expect(wrapper.find('.platform-login-button').exists()).toBe(false)
    expect(summary.attributes('aria-label')).toBe('账号菜单，当前用户 admin')
    expect(summary.get('.platform-avatar').text()).toBe('A')
    expect(summary.get('.platform-account-copy').text()).toContain('系统管理员')
    expect(summary.find('.platform-account-chevron').exists()).toBe(true)
    expect(wrapper.get('.platform-account-panel').text()).toContain('进入数据工作台')
    wrapper.unmount()
  })
  it('exposes the home tour only when requested on the homepage and closes mobile navigation', async () => {
    const wrapper = await mountHeader('/', { showHomeGuide: true })
    const trigger = wrapper.get('.platform-home-guide-button')
    expect(trigger.attributes('aria-label')).toBe('首页导览')
    await wrapper.get('.platform-menu-button').trigger('click')
    await trigger.trigger('click')
    expect(wrapper.emitted('requestHomeGuide')).toHaveLength(1)
    expect(wrapper.get('.platform-menu-button').attributes('aria-expanded')).toBe('false')
    expect(wrapper.vm.homeGuideTrigger).toBe(trigger.element)
    wrapper.unmount()
    const otherPage = await mountHeader('/map-visualization', { showHomeGuide: true })
    expect(otherPage.find('.platform-home-guide-button').exists()).toBe(false)
    otherPage.unmount()
  })

  it('can hide on downward scroll and reveal on upward scroll or keyboard focus', async () => {
    const wrapper = await mountHeader('/icd11-sankey', { autoHideOnScroll: true })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 140 })
    window.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => window.setTimeout(resolve, 20))
    expect(wrapper.get('.platform-header-shell').classes()).toContain('is-scroll-hidden')
    const hiddenEvents = wrapper.emitted('visibilityChange') ?? []
    expect(hiddenEvents[hiddenEvents.length - 1]).toEqual([true])

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 80 })
    window.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => window.setTimeout(resolve, 20))
    expect(wrapper.get('.platform-header-shell').classes()).not.toContain('is-scroll-hidden')
    const revealedEvents = wrapper.emitted('visibilityChange') ?? []
    expect(revealedEvents[revealedEvents.length - 1]).toEqual([false])

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 180 })
    window.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => window.setTimeout(resolve, 20))
    await wrapper.get('.platform-brand').trigger('focusin')
    expect(wrapper.get('.platform-header-shell').classes()).not.toContain('is-scroll-hidden')
    wrapper.unmount()
  })
})
