import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
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

const overviewResult = {
  metrics: [
    {
      key: 'docs',
      label: '文献样本',
      value: '198',
      unit: '篇',
      detail: '真实文献',
      trend: '更新中',
      tone: 'blue',
    },
    {
      key: 'coverage',
      label: '国家 / 地区',
      value: '45 / 259',
      unit: '',
      detail: '空间覆盖',
      trend: '可用',
      tone: 'green',
    },
    {
      key: 'categories',
      label: '目标物质类别',
      value: '32',
      unit: '类',
      detail: '分类覆盖',
      trend: '可用',
      tone: 'amber',
    },
    {
      key: 'markers',
      label: '生物标记物',
      value: '601',
      unit: '项',
      detail: '标记物覆盖',
      trend: '可用',
      tone: 'cyan',
    },
  ],
  targetCategoryOptions: [
    { value: 'all', name: '全部', frequency: 119 },
    { value: 'drug', name: '药物类', frequency: 55 },
    { value: 'consumer', name: '消费品类', frequency: 64 },
  ],
  biomarkerFrequencies: [
    {
      name: '烟草',
      frequency: 64,
      category: '消费品类',
      targetCategory: 'consumer',
      rows: 1799,
      trend: [
        { period: '可替宁', subclass: '烟草代谢物', frequency: 54 },
        { period: '尼古丁', subclass: '烟草代谢物', frequency: 14 },
      ],
    },
    {
      name: '抗生素',
      frequency: 55,
      category: '药物类',
      targetCategory: 'drug',
      rows: 4488,
      trend: [
        { period: '阿奇霉素', subclass: '大环内酯类', frequency: 15 },
        { period: '磺胺甲噁唑', subclass: '磺胺类', frequency: 44 },
      ],
    },
  ],
  keywords: [
    {
      name: '可替宁',
      value: 54,
      docs: 54,
      rows: 1296,
      countries: 23,
      regions: 148,
      category: '烟草',
      targetLabel: '消费品类',
      tone: '#996923',
      subcategories: ['烟草代谢物'],
      aliases: ['Cotinine'],
    },
    {
      name: '磺胺甲噁唑',
      value: 44,
      docs: 44,
      rows: 311,
      countries: 20,
      regions: 41,
      category: '抗生素',
      targetLabel: '药物类',
      tone: '#1768b0',
      subcategories: ['磺胺类'],
      aliases: ['SMX'],
    },
    {
      name: '阿奇霉素',
      value: 15,
      docs: 15,
      rows: 106,
      countries: 9,
      regions: 19,
      category: '抗生素',
      targetLabel: '药物类',
      tone: '#3d756d',
      subcategories: ['大环内酯类'],
      aliases: [],
    },
  ],
}

async function mountAcademicHome() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div>home</div>' } },
      { path: '/guide', component: { template: '<div>guide</div>' } },
      { path: '/about', component: { template: '<div>about</div>' } },
      { path: '/map-visualization', component: { template: '<div>map</div>' } },
      { path: '/icd11-sankey', component: { template: '<div>sankey</div>' } },
      { path: '/core-marker-priority', component: { template: '<div>priority</div>' } },
      { path: '/methodology-verification', component: { template: '<div>methodology</div>' } },
    ],
  })
  await router.push('/?ui=academic-home')
  await router.isReady()
  const wrapper = mount(HomeView, {
    attachTo: document.body,
    global: { plugins: [router] },
  })
  await flushPromises()
  return wrapper
}

describe('academic home preview', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1100)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(390)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    localStorage.setItem('wbe-home-guide-v2', 'seen')
  })
  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('keeps the factor cloud, two bar-chart levels and three analysis routes', async () => {
    fetchOverviewMock.mockResolvedValue(overviewResult)
    const wrapper = await mountAcademicHome()

    expect(wrapper.get('#academicHeroTitle').text()).toContain('可检索、可比较')
    const introStage = wrapper.get('.academic-intro-stage')
    expect(introStage.find('#academicHeroTitle').exists()).toBe(true)
    expect(introStage.find('#visual-entry').exists()).toBe(true)
    expect(introStage.find('.academic-intro-backdrop').exists()).toBe(false)
    expect(introStage.find('.academic-intro-node').exists()).toBe(false)
    expect(introStage.get('.academic-hero-kicker').text()).toBe('WASTEWATER-BASED EPIDEMIOLOGY')
    expect(introStage.get('.academic-secondary-action').text()).toContain('查看高频因子')
    expect(wrapper.findAll('.factor-cloud-word').length).toBeGreaterThan(0)
    expect(wrapper.findAll('.frequency-bar')).toHaveLength(2)
    expect(wrapper.findAll('.detail-column-bar')).toHaveLength(2)
    expect(wrapper.findAll('.academic-module')).toHaveLength(3)
    expect(wrapper.findAll('.academic-module-grid')).toHaveLength(1)
    expect(wrapper.findAll('.academic-module-index').map((item) => item.text())).toEqual([
      '01',
      '02',
      '03',
    ])
    expect(wrapper.find('.academic-page-continuum').exists()).toBe(false)
    expect(wrapper.findAll('.academic-module').map((link) => link.attributes('href'))).toEqual([
      '/map-visualization',
      '/icd11-sankey',
      '/core-marker-priority',
    ])
    expect(wrapper.find('.academic-module-link').exists()).toBe(false)
    expect(wrapper.find('.academic-module-metric').exists()).toBe(false)
    expect(wrapper.findAll('.academic-module-steps')).toHaveLength(3)
    expect(
      wrapper
        .findAll('.academic-module-steps')
        .map((list) => list.findAll('li').map((item) => item.text())),
    ).toEqual([
      ['1 选择范围', '2 确认标记物', '3 查看热区'],
      ['1 选择疾病层级', '2 定位节点', '3 追踪流带'],
      ['1 选择目标类别', '2 比较评分', '3 查看排名'],
    ])
    expect(wrapper.findAll('.academic-module-action').map((item) => item.text())).toEqual([
      '进入空间分析→',
      '进入关联分析→',
      '进入优先级评估→',
    ])
    expect(wrapper.find('.home-section-navigation').exists()).toBe(false)
    expect(wrapper.get('.platform-home-guide-button').attributes('aria-label')).toBe('首页导览')
    expect(wrapper.find('#data-scope').exists()).toBe(false)
    expect(
      wrapper.findAll('.academic-module-visual img').map((image) => image.attributes('src')),
    ).toEqual([
      '/academic-home/posters/map-usage.webp',
      '/academic-home/posters/sankey-usage.webp',
      '/academic-home/posters/priority-usage.webp',
    ])
    expect(
      wrapper
        .findAll('.academic-module-visual source')
        .map((source) => source.attributes('srcset')),
    ).toEqual([
      '/academic-home/posters/map-usage.webp',
      '/academic-home/posters/sankey-usage.webp',
      '/academic-home/posters/priority-usage.webp',
    ])

    const modules = wrapper.findAll('.academic-module')
    await modules[1]!.trigger('pointerenter')
    expect(wrapper.findAll('.academic-module.is-demo-active')).toHaveLength(1)
    expect(wrapper.findAll('.academic-module-visual img')[1]!.attributes('src')).toMatch(
      /^\/academic-home\/gifs\/sankey-usage\.gif\?run=\d+$/,
    )
    expect(
      wrapper
        .findAll('.academic-module-visual img')
        .filter((image) => image.attributes('src')?.includes('.gif')),
    ).toHaveLength(1)
    expect(wrapper.find('figcaption').exists()).toBe(false)
    expect(wrapper.find('.academic-module-demo-progress').exists()).toBe(false)
    expect(modules[1]!.find('.academic-module-demo-pointer').exists()).toBe(true)

    await modules[1]!.trigger('pointerleave')
    expect(wrapper.findAll('.academic-module.is-demo-active')).toHaveLength(0)
    expect(wrapper.findAll('.academic-module-visual img')[1]!.attributes('src')).toBe(
      '/academic-home/posters/sankey-usage.webp',
    )
    expect(wrapper.find('.updates-section').exists()).toBe(false)
    expect(wrapper.get('#methods').classes()).toContain('route-anchor-sentinel')

    wrapper.unmount()
  })

  it('uses a quiet blue-white intro without decorative illustration assets', async () => {
    fetchOverviewMock.mockResolvedValue(overviewResult)
    const wrapper = await mountAcademicHome()

    expect(wrapper.get('.academic-hero').find('picture').exists()).toBe(false)
    expect(wrapper.get('.academic-module-grid').findAll('img')).toHaveLength(3)
    expect(wrapper.findAll('.academic-module')).toHaveLength(3)
    wrapper.unmount()
  })

  it('pauses the word field and opens a complete evidence panel for a factor', async () => {
    fetchOverviewMock.mockResolvedValue(overviewResult)
    const wrapper = await mountAcademicHome()
    const word = wrapper
      .findAll('.factor-cloud-word')
      .find((item) => item.text().includes('可替宁'))

    expect(word).toBeTruthy()
    await word!.trigger('focusin')
    expect(wrapper.get('.factor-cloud-canvas').attributes('data-paused')).toBe('true')
    await word!.trigger('click', { clientX: 160, clientY: 180 })

    expect(wrapper.get('.factor-detail').text()).toContain('可替宁')
    expect(wrapper.get('.factor-detail').text()).toContain('1,296')
    expect(wrapper.get('.factor-detail').text()).toContain('烟草代谢物')
    expect(wrapper.get('.factor-detail').text()).not.toContain('国家')

    await wrapper.get('.factor-detail header button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.factor-detail').exists()).toBe(false)
    expect(document.activeElement).toBe(word!.element)
    wrapper.unmount()
  })

  it('opens a focused, branded login dialog and returns focus when closed', async () => {
    fetchOverviewMock.mockResolvedValue(overviewResult)
    const wrapper = await mountAcademicHome()
    const trigger = wrapper.get('.platform-login-button')
    ;(trigger.element as HTMLElement).focus()
    await trigger.trigger('click')
    await flushPromises()

    const dialog = document.body.querySelector<HTMLElement>('.auth-card')
    const account = dialog?.querySelector<HTMLInputElement>('input[autocomplete="username"]')
    expect(dialog?.getAttribute('role')).toBe('dialog')
    expect(dialog?.querySelector('#authTitle')?.textContent).toBe('登录 WBE 数据平台')
    expect(dialog?.querySelector('.auth-header')?.textContent).toContain(
      '登录后可按账号权限使用数据下载与维护功能',
    )
    expect(account?.placeholder).toBe('请输入用户名或邮箱')
    expect(
      dialog?.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')
        ?.placeholder,
    ).toBe('请输入密码')
    expect(document.activeElement).toBe(account)

    dialog?.querySelector<HTMLButtonElement>('.close-button')?.click()
    await flushPromises()
    expect(document.body.querySelector('.auth-overlay')).toBeNull()
    expect(document.body.contains(trigger.element)).toBe(true)
    wrapper.unmount()
  })

  it('supports three sorts, target ranges, category selection and subclass switching', async () => {
    fetchOverviewMock.mockResolvedValue(overviewResult)
    const wrapper = await mountAcademicHome()
    const labels = () => wrapper.findAll('.frequency-bar strong').map((item) => item.text())
    const sortButtons = wrapper.findAll('.biomarker-sort-control button')

    expect(wrapper.find('.frequency-plot').exists()).toBe(true)
    expect(labels()).toEqual(['烟草', '抗生素'])
    await sortButtons[1]!.trigger('click')
    expect(labels()).toEqual(['抗生素', '烟草'])
    await sortButtons[2]!.trigger('click')
    expect(labels()).toEqual(['抗生素', '烟草'])

    await wrapper.get('.biomarker-filter-control select').setValue('drug')
    await flushPromises()
    expect(labels()).toEqual(['抗生素'])
    expect(wrapper.get('.biomarker-detail-section').text()).toContain('抗生素')

    const subclassSelect = wrapper.get('.subclass-filter select')
    expect(subclassSelect.findAll('option').map((option) => option.text())).toEqual([
      '磺胺类（44）',
      '大环内酯类（15）',
    ])
    await subclassSelect.setValue('大环内酯类')
    expect(wrapper.findAll('.detail-column-bar')).toHaveLength(1)
    expect(wrapper.get('.detail-column-bar').text()).toContain('阿奇霉素')

    wrapper.unmount()
  })
})
