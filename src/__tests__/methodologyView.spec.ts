import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const methodologyMocks = vi.hoisted(() => ({
  fetchMethodologyData: vi.fn(),
}))

vi.mock('../services/methodology', () => ({
  fetchMethodologyData: methodologyMocks.fetchMethodologyData,
}))

import MethodologyVerificationView from '../views/MethodologyVerificationView.vue'

const emptyData = {
  meta: {
    sourceName: 'WBE汇总表.xlsx',
    rowCount: 0,
    docCount: 0,
    drugCount: 0,
    markerCount: 0,
    countryCount: 0,
    samplingStandardCount: 0,
    samplingRingStandardCount: 0,
    samplingClassCount: 0,
    documentMethodCount: 0,
    documentRingMethodCount: 0,
    documentMethodDetailCount: 0,
    naDocumentCount: 0,
    analysisGroupCount: 0,
    auditRows: 0,
    impactRows: 0,
  },
  records: [],
  samplingMethods: [],
  options: {
    targetClass: [],
    category: [],
    country: [],
    prescription: [],
    samplingStandard: [],
    samplingClass: [],
    sampleObject: [],
    proportion: [],
    duration: [],
    passiveSampler: [],
  },
}

const populatedData = {
  ...emptyData,
  meta: { ...emptyData.meta, rowCount: 2, docCount: 2, markerCount: 2, samplingStandardCount: 2 },
  records: [
    {
      doc: 'WBE0001', doi: '', targetClass: '药物', category: '抗生素', subcategory: '', drug: 'Drug A', marker: 'Marker A', prescription: '处方药', samplingRaw: '24 h', samplingStandard: '时间比例复合采样', samplingDetail: '24 h', samplingClass: '复合采样', sampleObject: '进水样', proportion: '时间比例', duration: '24 h', passiveSampler: '不适用', stationStatus: '已明确', analysisRaw: 'LC-MS/MS', analysisGroup: 'LC-MS/MS', country: 'China',
    },
    {
      doc: 'WBE0002', doi: '', targetClass: '生活方式', category: '咖啡因', subcategory: '', drug: 'Drug B', marker: 'Marker B', prescription: '非处方药', samplingRaw: '抓取', samplingStandard: '抓取采样', samplingDetail: '抓取', samplingClass: '抓取采样', sampleObject: '进水样', proportion: '不适用', duration: '不适用', passiveSampler: '不适用', stationStatus: '已明确', analysisRaw: 'GC-MS', analysisGroup: 'GC-MS', country: 'Australia',
    },
  ],
  samplingMethods: [
    { standard: '时间比例复合采样', samplingClass: ['复合采样'], sampleObject: ['进水样'], proportion: ['时间比例'], duration: ['24 h'], passiveSampler: ['不适用'], stationStatus: ['已明确'], auditSourceGroups: 1, impactRows: 1 },
    { standard: '抓取采样', samplingClass: ['抓取采样'], sampleObject: ['进水样'], proportion: ['不适用'], duration: ['不适用'], passiveSampler: ['不适用'], stationStatus: ['已明确'], auditSourceGroups: 1, impactRows: 1 },
  ],
  options: {
    ...emptyData.options,
    targetClass: ['药物', '生活方式'], country: ['China', 'Australia'], prescription: ['处方药', '非处方药'], samplingStandard: ['时间比例复合采样', '抓取采样'], samplingClass: ['复合采样', '抓取采样'],
  },
}

function mountView() {
  return mount(MethodologyVerificationView, {
    global: {
      stubs: {
        RouterLink: { template: '<a><slot /></a>' },
      },
    },
  })
}

function stubViewport(compact: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: compact,
      media: '(max-width: 760px)',
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

describe('MethodologyVerificationView states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubViewport(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a loading state while the large records request is pending', () => {
    methodologyMocks.fetchMethodologyData.mockReturnValue(new Promise(() => undefined))

    const wrapper = mountView()

    expect(wrapper.get('[data-state="loading"]').text()).toContain('正在装载')
    wrapper.unmount()
  })

  it('shows an explicit empty state for a successful response with no records', async () => {
    methodologyMocks.fetchMethodologyData.mockResolvedValue(emptyData)

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('[data-state="empty"]').text()).toContain('暂无方法学数据')
    wrapper.unmount()
  })

  it('shows an API error state without rendering stale content', async () => {
    methodologyMocks.fetchMethodologyData.mockRejectedValue(new Error('503 Service Unavailable'))

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('[data-state="error"]').text()).toContain('方法学数据加载失败')
    expect(wrapper.get('[data-state="error"]').text()).not.toContain('503 Service Unavailable')
    expect(wrapper.find('.filter-console').exists()).toBe(false)
    wrapper.unmount()
  })

  it('marks the page as compact at the small-screen breakpoint', async () => {
    stubViewport(true)
    methodologyMocks.fetchMethodologyData.mockResolvedValue(emptyData)

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('main').attributes('data-layout')).toBe('compact')
    expect(wrapper.get('main').classes()).toContain('is-compact')
    wrapper.unmount()
  })

  it('filters evidence immediately and exposes removable active criteria', async () => {
    methodologyMocks.fetchMethodologyData.mockResolvedValue(populatedData)
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('.result-count').text()).toContain('2')
    await wrapper.get('[data-filter="query"]').setValue('Drug A')
    expect(wrapper.get('.result-count').text()).toContain('1')
    expect(wrapper.get('.active-filter-list').text()).toContain('Drug A')
    await wrapper.get('.active-filter-list button').trigger('click')
    expect(wrapper.get('.result-count').text()).toContain('2')
    wrapper.unmount()
  })

  it('uses searchable custom controls for long lists and native controls for short lists', async () => {
    methodologyMocks.fetchMethodologyData.mockResolvedValue(populatedData)
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[data-filter="targetClass"] .methodology-filter-select__trigger').exists()).toBe(true)
    expect(wrapper.find('[data-filter="country"] .methodology-filter-select__trigger').exists()).toBe(true)
    expect(wrapper.find('[data-filter="samplingStandard"] .methodology-filter-select__trigger').exists()).toBe(true)
    expect(wrapper.find('select[data-filter="samplingClass"]').exists()).toBe(true)

    await wrapper.get('[data-filter="country"] .methodology-filter-select__trigger').trigger('click')
    const china = wrapper.findAll('[data-filter="country"] .methodology-filter-select__option').find((option) => option.text().includes('中国'))
    expect(china).toBeTruthy()
    await china!.trigger('click')
    expect(wrapper.get('.result-count').text()).toContain('1')
    expect(wrapper.get('.active-filter-list').text()).toContain('中国')
    wrapper.unmount()
  })

  it('expands advanced filters and changes the prescription counting mode', async () => {
    methodologyMocks.fetchMethodologyData.mockResolvedValue(populatedData)
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('.advanced-toggle').trigger('click')
    expect(wrapper.find('.filter-grid--advanced').exists()).toBe(true)
    const modeButtons = wrapper.findAll('.mode-switch button')
    await modeButtons[2]!.trigger('click')
    expect(modeButtons[2]!.classes()).toContain('active')
    expect(wrapper.get('.prescription-chart').text()).toContain('数据记录')
    wrapper.unmount()
  })

  it('renders the method ranking, responsive method cards and analysis coverage', async () => {
    methodologyMocks.fetchMethodologyData.mockResolvedValue(populatedData)
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.findAll('.ranking-list button')).toHaveLength(2)
    expect(wrapper.findAll('.method-card')).toHaveLength(2)
    expect(wrapper.findAll('.analysis-row')).toHaveLength(2)
    await wrapper.get('.method-card__summary').trigger('click')
    expect(wrapper.find('.method-card__details').exists()).toBe(true)
    wrapper.unmount()
  })
})
