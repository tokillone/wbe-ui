import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PrescriptionRatio from '../components/sankey/PrescriptionRatio.vue'

describe('PrescriptionRatio', () => {
  it('renders a quiet proportion bar with readable counts and percentages', () => {
    const wrapper = mount(PrescriptionRatio, {
      props: {
        summary: {
          available: true,
          total: 100,
          counts: { prescription: 80, nonprescription: 15, conflict: 3, unknown: 2 },
        },
      },
    })
    const segments = wrapper.findAll('.prescription-track > i')
    expect(segments).toHaveLength(4)
    expect(segments.map((segment) => segment.attributes('style'))).toEqual([
      expect.stringContaining('width: 80%'),
      expect.stringContaining('width: 15%'),
      expect.stringContaining('width: 3%'),
      expect.stringContaining('width: 2%'),
    ])
    expect(segments.every((segment) => segment.text() === '')).toBe(true)
    expect(wrapper.findAll('li')).toHaveLength(4)
    expect(wrapper.get('.prescription-track').attributes('aria-label')).toContain('处方药 80.0%')
    expect(wrapper.text()).toContain('记录不一致')
    expect(wrapper.text()).toContain('未匹配')
  })

  it('distinguishes unavailable metadata from an empty drug scope', () => {
    const counts = { prescription: 0, nonprescription: 0, conflict: 0, unknown: 0 }
    const unavailable = mount(PrescriptionRatio, {
      props: { summary: { available: false, total: 0, counts } },
    })
    const empty = mount(PrescriptionRatio, {
      props: { summary: { available: true, total: 0, counts } },
    })
    expect(unavailable.text()).toContain('属性数据暂不可用')
    expect(empty.text()).toContain('当前范围暂无药物')
    expect(unavailable.find('.prescription-track').exists()).toBe(false)
    expect(empty.find('.prescription-track').exists()).toBe(false)
  })

  it('uses one plain row instead of a ratio graphic for one drug', () => {
    const wrapper = mount(PrescriptionRatio, {
      props: {
        summary: {
          available: true,
          total: 1,
          counts: { prescription: 1, nonprescription: 0, conflict: 0, unknown: 0 },
        },
      },
    })
    expect(wrapper.find('.prescription-track').exists()).toBe(false)
    expect(wrapper.find('ul').exists()).toBe(false)
    expect(wrapper.get('.single-prescription-status').text()).toContain('处方药')
    expect(wrapper.get('.single-prescription-status').text()).toContain('1 种')
    expect(wrapper.get('.single-prescription-status').text()).not.toContain('不显示比例图')
  })

  it('explains unknown and conflicting records only when requested and closes with Escape', async () => {
    const wrapper = mount(PrescriptionRatio, {
      props: {
        summary: {
          available: true,
          total: 2,
          counts: { prescription: 0, nonprescription: 0, conflict: 1, unknown: 1 },
        },
      },
    })
    const help = wrapper.get('button[aria-label="处方属性分类说明"]')
    expect(help.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.prescription-explanation').exists()).toBe(false)
    await help.trigger('click')
    expect(help.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.prescription-explanation').text()).toContain(
      '未匹配：方法学表中没有完全同名药物',
    )
    expect(wrapper.get('.prescription-explanation').text()).toContain(
      '原始记录同时标为处方药和非处方药',
    )
    await help.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.prescription-explanation').exists()).toBe(false)
  })
})
