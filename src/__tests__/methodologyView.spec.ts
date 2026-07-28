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

    expect(wrapper.get('[data-state="error"]').text()).toContain('503 Service Unavailable')
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
})
