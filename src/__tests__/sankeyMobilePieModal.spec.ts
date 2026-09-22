import { flushPromises, mount } from '@vue/test-utils'
import { init } from 'echarts/core'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Icd11SankeyView from '../views/Icd11SankeyView.vue'
import type { Icd11SankeyGraph, Icd11SankeyLink, Icd11SankeyPath } from '../types/icd11Sankey'
import { summarizeSankeyOverview } from '../utils/icd11SankeyDisplay'

const { fetchGraphMock } = vi.hoisted(() => ({ fetchGraphMock: vi.fn() }))

vi.mock('echarts/core', () => ({
  use: vi.fn(),
  init: vi.fn(() => ({
    setOption: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    resize: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
    dispatchAction: vi.fn(),
    getZr: () => ({ on: vi.fn(), off: vi.fn() }),
  })),
}))
vi.mock('../services/icd11Sankey', () => ({
  fetchIcd11SankeyCategories: vi.fn(async () => ({ categories: ['ALL'], defaultCategory: 'ALL' })),
  fetchIcd11SankeyGraph: fetchGraphMock,
}))

function testGraph(multiple = false): Icd11SankeyGraph {
  const firstPath: Icd11SankeyPath = {
    pathId: 'p1',
    level1: '神经系统疾病',
    level2: '其他疾患',
    level3: '疼痛疾患',
    mappingLevel: 'Level3',
    drug: '布洛芬',
    biomarker: '布洛芬',
    biomarkerAliases: [],
    weight: 10,
    mappingRows: 1,
    share: multiple ? 0.625 : 1,
    nodeIds: ['l1', 'l2', 'l3', 'drug::布洛芬', 'bio::布洛芬'],
  }
  const secondPath: Icd11SankeyPath = {
    ...firstPath,
    pathId: 'p2',
    drug: '卡马西平',
    biomarker: '卡马西平',
    weight: 6,
    share: 0.375,
    nodeIds: ['l1', 'l2', 'l3', 'drug::卡马西平', 'bio::卡马西平'],
  }
  const paths = multiple ? [firstPath, secondPath] : [firstPath]
  const kinds = ['level1', 'level2', 'level3', 'drug', 'biomarker'] as const
  const nodes = new Map<string, Icd11SankeyGraph['nodes'][number]>()
  for (const path of paths) {
    const labels = [path.level1, path.level2, path.level3!, path.drug, path.biomarker]
    path.nodeIds.forEach((name, depth) => {
      const existing = nodes.get(name)
      if (existing) {
        existing.value += path.weight
        return
      }
      nodes.set(name, {
        name,
        displayName: labels[depth]!,
        kind: kinds[depth]!,
        depth,
        value: path.weight,
        searchText: name,
        level1: path.level1,
        color: '#245f8e',
      })
    })
  }
  return {
    category: 'ALL',
    paths,
    links: [],
    level1Colors: {},
    stats: summarizeSankeyOverview(paths),
    drugPrescriptions: {
      'drug::布洛芬': 'nonprescription',
      ...(multiple ? { 'drug::卡马西平': 'prescription' as const } : {}),
    },
    nodes: [...nodes.values()],
  }
}

function edgeShareGraph(): Icd11SankeyGraph {
  const basePath: Icd11SankeyPath = {
    pathId: 'edge-p1',
    level1: '神经系统疾病',
    level2: '癫痫或癫痫发作',
    level3: null,
    mappingLevel: 'Level2',
    drug: '卡马西平',
    biomarker: '卡马西平',
    biomarkerAliases: [],
    weight: 22,
    mappingRows: 1,
    share: 0.44,
    nodeIds: ['l1', 'l2', 'drug::卡马西平', 'bio::卡马西平'],
  }
  const paths: Icd11SankeyPath[] = [
    basePath,
    {
      ...basePath,
      pathId: 'edge-p2',
      biomarker: '10,11-二氢-10,11-羟基卡马西平',
      weight: 18,
      share: 0.36,
      nodeIds: ['l1', 'l2', 'drug::卡马西平', 'bio::羟基卡马西平'],
    },
    {
      ...basePath,
      pathId: 'edge-p3',
      drug: '奥卡西平',
      weight: 10,
      share: 0.2,
      nodeIds: ['l1', 'l2', 'drug::奥卡西平', 'bio::卡马西平'],
    },
  ]
  const nodeSpecs = [
    ['l1', '神经系统疾病', 'level1', 0],
    ['l2', '癫痫或癫痫发作', 'level2', 1],
    ['drug::卡马西平', '卡马西平', 'drug', 3],
    ['drug::奥卡西平', '奥卡西平', 'drug', 3],
    ['bio::卡马西平', '卡马西平', 'biomarker', 4],
    ['bio::羟基卡马西平', '10,11-二氢-10,11-羟基卡马西平', 'biomarker', 4],
  ] as const
  const nodes = nodeSpecs.map(([name, displayName, kind, depth]) => ({
    name,
    displayName,
    kind,
    depth,
    value: paths
      .filter((path) => path.nodeIds.includes(name))
      .reduce((sum, path) => sum + path.weight, 0),
    searchText: `${displayName} ${name}`,
    level1: '神经系统疾病',
    color: '#245f8e',
  }))
  const drugBiomarkerLinks: Icd11SankeyLink[] = paths.map((path) => ({
    linkId: `${path.nodeIds[2]}->${path.nodeIds[3]}`,
    source: path.nodeIds[2]!,
    target: path.nodeIds[3]!,
    value: path.weight,
    level1: path.level1,
    level2: path.level2,
    sourceLabel: path.drug,
    targetLabel: path.biomarker,
    edgeType: '药物 → 生物标记物',
    mappingLevel: path.mappingLevel,
    pathIds: [path.pathId],
    color: '#245f8e',
  }))
  return {
    category: 'ALL',
    paths,
    links: drugBiomarkerLinks,
    level1Colors: {},
    stats: summarizeSankeyOverview(paths),
    drugPrescriptions: {
      'drug::卡马西平': 'prescription',
      'drug::奥卡西平': 'prescription',
    },
    nodes,
  }
}

describe('mobile Sankey pie above the overview drawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchGraphMock.mockReset()
    fetchGraphMock.mockResolvedValue(testGraph())
  })

  afterEach(() => {
    document.body.innerHTML = ''
    document.body.style.overflow = ''
    localStorage.clear()
    window.history.replaceState({}, '', '/')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('teleports above the drawer, suspends its focus trap, and returns to the same overview after Escape', async () => {
    fetchGraphMock.mockResolvedValue(testGraph(true))
    vi.stubGlobal('innerWidth', 390)
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    Element.prototype.scrollTo = vi.fn()
    localStorage.setItem('wbe:icd11-sankey-operation-guide:v2', '1')
    const wrapper = mount(Icd11SankeyView, {
      attachTo: document.body,
      global: { stubs: { PlatformHeader: true, OperationGuide: true } },
    })
    await flushPromises()
    await nextTick()
    await wrapper.get('.mobile-overview-button').trigger('click')
    await nextTick()
    const drawer = document.body.querySelector<HTMLElement>('.sankey-mobile-drawer-layer')!
    const opener = drawer.querySelector<HTMLButtonElement>('.drug-share-heading button')!
    expect(opener).not.toBeNull()
    opener.focus()
    opener.click()
    await nextTick()
    await nextTick()

    const backdrop = document.body.querySelector<HTMLElement>('.pie-modal-backdrop')!
    const dialog = backdrop.querySelector<HTMLElement>('[role="dialog"]')!
    const close = dialog.querySelector<HTMLButtonElement>('button')!
    expect(backdrop.parentElement).toBe(document.body)
    expect(drawer.contains(dialog)).toBe(false)
    expect(drawer.hasAttribute('inert')).toBe(true)
    expect(drawer.getAttribute('aria-hidden')).toBe('true')
    expect(document.activeElement).toBe(close)
    expect(wrapper.get('main').attributes()).toHaveProperty('inert')

    close.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    )
    const modalItems = [...dialog.querySelectorAll('[tabindex="0"]')]
    expect(document.activeElement).toBe(modalItems[modalItems.length - 1])
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    await nextTick()
    await nextTick()
    expect(document.body.querySelector('.pie-modal-backdrop')).toBeNull()
    expect(document.body.contains(drawer)).toBe(true)
    expect(drawer.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(opener)
    expect(document.body.style.overflow).toBe('hidden')
    wrapper.unmount()
  })

  it('keeps reading guidance in the statistics toolbar and supports keyboard dismissal', async () => {
    vi.stubGlobal('innerWidth', 1200)
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    Element.prototype.scrollTo = vi.fn()
    localStorage.setItem('wbe:icd11-sankey-operation-guide:v2', '1')
    const wrapper = mount(Icd11SankeyView, {
      attachTo: document.body,
      global: { stubs: { PlatformHeader: true, OperationGuide: true } },
    })
    await flushPromises()
    const toolbar = wrapper.get('.overview-toolbar')
    expect(toolbar.text()).toContain('当前范围')
    expect(toolbar.text()).toContain('全局概览')
    const trigger = toolbar.get('#reading-guide')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('#reading-guide-content').exists()).toBe(false)
    await trigger.trigger('click')
    await nextTick()
    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(document.body.querySelector('#reading-guide-content')?.textContent).toContain(
      '包含“其他”',
    )
    window.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(document.body.querySelector('#reading-guide-content')).not.toBeNull()
    document.body.querySelector<HTMLElement>('.reading-guide-popover')?.click()
    await nextTick()
    expect(document.body.querySelector('#reading-guide-content')).toBeNull()

    await trigger.trigger('click')
    await nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(document.body.querySelector('#reading-guide-content')).toBeNull()
    wrapper.unmount()
  })

  it('opens the mobile drawer and reading guidance when arriving at the legacy hash', async () => {
    vi.stubGlobal('innerWidth', 390)
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    Element.prototype.scrollTo = vi.fn()
    Element.prototype.scrollIntoView = vi.fn()
    window.history.replaceState({}, '', '/icd11-sankey#reading-guide')
    const wrapper = mount(Icd11SankeyView, {
      attachTo: document.body,
      global: { stubs: { PlatformHeader: true, OperationGuide: true } },
    })
    await flushPromises()
    await nextTick()
    expect(document.body.querySelector('.sankey-mobile-drawer-layer')).not.toBeNull()
    expect(document.body.querySelector('#reading-guide')?.getAttribute('aria-expanded')).toBe(
      'true',
    )
    expect(document.body.querySelector('#reading-guide-content')?.textContent).toContain(
      '处方属性比例',
    )
    wrapper.unmount()
  })

  it('uses a one-line relation summary and a plain single prescription row', async () => {
    vi.stubGlobal('innerWidth', 1200)
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    Element.prototype.scrollTo = vi.fn()
    localStorage.setItem('wbe:icd11-sankey-operation-guide:v2', '1')
    const wrapper = mount(Icd11SankeyView, {
      attachTo: document.body,
      global: { stubs: { PlatformHeader: true, OperationGuide: true } },
    })
    await flushPromises()
    const drugSection = wrapper
      .findAll('.drug-share-block')
      .find((section) => section.get('h3').text().includes('药物'))!
    const summary = drugSection.get('.relation-single-summary')
    expect(summary.text()).toContain('布洛芬')
    expect(summary.text()).toContain('10 权重')
    expect(summary.text()).toContain('100.0%')
    expect(summary.get('.inline-prescription-label').text()).toBe('非处方药')
    expect(drugSection.find('.drug-share-chart').exists()).toBe(false)
    expect(drugSection.find('.drug-share-heading button').exists()).toBe(false)
    expect(wrapper.find('.prescription-ratio').exists()).toBe(false)
    wrapper.unmount()
  })

  it('clears stale hover state and changes focused text color without a label box', async () => {
    const graph = testGraph(true)
    fetchGraphMock.mockResolvedValue(graph)
    vi.stubGlobal('innerWidth', 1200)
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    Element.prototype.scrollTo = vi.fn()
    localStorage.setItem('wbe:icd11-sankey-operation-guide:v2', '1')
    const wrapper = mount(Icd11SankeyView, {
      attachTo: document.body,
      global: { stubs: { PlatformHeader: true, OperationGuide: true } },
    })
    await flushPromises()

    const mainChart = vi.mocked(init).mock.results[0]?.value as {
      dispatchAction: ReturnType<typeof vi.fn>
      on: ReturnType<typeof vi.fn>
      setOption: ReturnType<typeof vi.fn>
    }
    const initialOption = mainChart.setOption.mock.calls
      .map((call) => call[0])
      .find((option) => option?.series?.[0]?.type === 'sankey')
    expect(initialOption.series[0].emphasis.focus).toBe('none')

    const clickHandler = mainChart.on.mock.calls.find(([event]) => event === 'click')?.[1]
    const focusedNode = graph.nodes.find((node) => node.name === 'drug::卡马西平')!
    clickHandler({ dataType: 'node', data: focusedNode })
    await flushPromises()
    await nextTick()

    expect(mainChart.dispatchAction).toHaveBeenCalledWith({ type: 'hideTip' })
    expect(mainChart.dispatchAction).toHaveBeenCalledWith({ type: 'downplay', seriesIndex: 0 })
    const focusedOptions = mainChart.setOption.mock.calls
      .map((call) => call[0])
      .filter((option) => option?.series?.[0]?.data)
    const latestNodes = focusedOptions[focusedOptions.length - 1]!.series[0].data
    const renderedFocus = latestNodes.find(
      (node: { name: string }) => node.name === focusedNode.name,
    )
    expect(renderedFocus.label).toMatchObject({
      verticalAlign: 'middle',
      color: '#123F5B',
      fontWeight: 650,
      textBorderColor: 'transparent',
      textBorderWidth: 0,
      backgroundColor: 'transparent',
      borderWidth: 0,
      padding: [0, 0],
    })
    wrapper.unmount()
  })

  it('highlights an unlocked Level2 route without changing the Sankey node order', async () => {
    fetchGraphMock.mockResolvedValue(edgeShareGraph())
    vi.stubGlobal('innerWidth', 1200)
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    Element.prototype.scrollTo = vi.fn()
    localStorage.setItem('wbe:icd11-sankey-operation-guide:v2', '1')
    const wrapper = mount(Icd11SankeyView, {
      attachTo: document.body,
      global: { stubs: { PlatformHeader: true, OperationGuide: true } },
    })
    await flushPromises()

    const mainChart = vi.mocked(init).mock.results[0]?.value as {
      on: ReturnType<typeof vi.fn>
      setOption: ReturnType<typeof vi.fn>
    }
    const initialOption = mainChart.setOption.mock.calls
      .map((call) => call[0])
      .find((option) => option?.series?.[0]?.type === 'sankey')
    const initialSeries = initialOption.series[0]
    const directRoute = initialSeries.links.find(
      (link: Icd11SankeyLink) =>
        link.mappingLevel === 'Level2' && link.edgeType === 'ICD11_Level2 → 药物',
    )
    const initialNodeOrder = initialSeries.data.map((node: { name: string }) => node.name)
    const mouseOver = mainChart.on.mock.calls.find(([event]) => event === 'mouseover')?.[1]

    mouseOver({ dataType: 'edge', data: directRoute })
    await new Promise((resolve) => window.setTimeout(resolve, 100))
    await nextTick()

    const graphUpdates = mainChart.setOption.mock.calls
      .map((call) => call[0])
      .filter((option) => option?.series?.[0]?.data)
    const hoveredNodeOrder = graphUpdates[graphUpdates.length - 1]!.series[0].data.map(
      (node: { name: string }) => node.name,
    )
    expect(hoveredNodeOrder).toEqual(initialNodeOrder)
    wrapper.unmount()
  })

  it('keeps weights in pie labels while the legend contains names only', async () => {
    fetchGraphMock.mockResolvedValue(testGraph(true))
    vi.stubGlobal('innerWidth', 1200)
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    Element.prototype.scrollTo = vi.fn()
    localStorage.setItem('wbe:icd11-sankey-operation-guide:v2', '1')
    const wrapper = mount(Icd11SankeyView, {
      attachTo: document.body,
      global: { stubs: { PlatformHeader: true, OperationGuide: true } },
    })
    await flushPromises()
    const drugSection = wrapper
      .findAll('.drug-share-block')
      .find((section) => section.get('h3').text().includes('药物'))!
    const legendItems = drugSection.findAll('.relation-pie-legend li')
    expect(legendItems).toHaveLength(2)
    expect(legendItems.map((item) => item.text())).toEqual(['布洛芬', '卡马西平'])
    expect(drugSection.find('.relation-legend-value').exists()).toBe(false)
    expect(drugSection.find('.relation-legend-percent').exists()).toBe(false)

    const chartInstances = vi
      .mocked(init)
      .mock.results.map((result) => result.value as { setOption: ReturnType<typeof vi.fn> })
    const pieOption = chartInstances
      .flatMap((instance) => instance.setOption.mock.calls.map((call) => call[0]))
      .find((option) => option?.series?.[0]?.type === 'pie')
    const pieSeries = pieOption?.series?.[0]
    expect(pieSeries).toBeTruthy()
    expect(pieSeries.label.formatter({ data: { value: 10, share: 0.625 } })).toContain('10')
    expect(pieSeries.label.formatter({ data: { value: 10, share: 0.625 } })).toContain('62.5%')
    expect(pieSeries.startAngle).not.toBe(90)
    expect(pieSeries.labelLayout).toMatchObject({ moveOverlap: 'shiftY' })

    await drugSection.get('.drug-share-heading button').trigger('click')
    await nextTick()
    const modal = document.body.querySelector('.pie-modal')!
    expect(
      [...modal.querySelectorAll('.relation-pie-legend li')].map((item) =>
        item.textContent?.trim(),
      ),
    ).toEqual(['布洛芬', '卡马西平'])
    expect(modal.querySelector('[aria-label="处方属性分类说明"]')).not.toBeNull()
    wrapper.unmount()
  })

  it('shows source and target shares for a flow band without redundant one-item summaries', async () => {
    const graph = edgeShareGraph()
    fetchGraphMock.mockResolvedValue(graph)
    vi.stubGlobal('innerWidth', 1200)
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    Element.prototype.scrollTo = vi.fn()
    localStorage.setItem('wbe:icd11-sankey-operation-guide:v2', '1')
    const wrapper = mount(Icd11SankeyView, {
      attachTo: document.body,
      global: { stubs: { PlatformHeader: true, OperationGuide: true } },
    })
    await flushPromises()
    await nextTick()

    const mainChart = vi.mocked(init).mock.results[0]?.value as {
      on: ReturnType<typeof vi.fn>
    }
    const clickHandler = mainChart.on.mock.calls.find(([event]) => event === 'click')?.[1]
    expect(clickHandler).toBeTypeOf('function')
    clickHandler({ dataType: 'edge', data: graph.links[0] })
    await flushPromises()
    await nextTick()

    const sidePanel = wrapper.get('.side-panel')
    expect(sidePanel.get('.edge-detail-heading').text()).toContain('药物与生物标记物关系')
    expect(sidePanel.get('.edge-route').text()).toContain('卡马西平')
    expect(sidePanel.get('.edge-route').text()).toContain('处方药')
    expect(sidePanel.get('.edge-metrics').text()).toContain('55.0%')
    expect(sidePanel.get('.edge-metrics').text()).toContain('68.8%')
    expect(sidePanel.text()).not.toContain('已锁定')
    expect(sidePanel.text()).not.toContain('该流带关联药物')
    expect(sidePanel.find('.prescription-ratio').exists()).toBe(false)
    expect(sidePanel.find('.relation-pie-legend').exists()).toBe(false)
    expect(wrapper.get('.filter-summary').text()).not.toContain('智能精简')
    expect(wrapper.get('.filter-summary').text()).not.toContain('最多')
    wrapper.unmount()
  })
})
