import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BrandMark from '../components/BrandMark.vue'

const brandedViews = [
  'HomeView.vue',
  'MapVisualizationView.vue',
  'Icd11SankeyView.vue',
  'CoreMarkerPriorityView.vue',
  'MethodologyVerificationView.vue',
  'DataEntryView.vue',
  'AuthView.vue',
]

describe('shared blue brand mark', () => {
  it('renders the restrained drop and data-wave symbol', () => {
    const wrapper = mount(BrandMark, { props: { size: 44 } })

    expect(wrapper.get('.site-emblem').attributes('style')).toContain('--emblem-size: 44px')
    expect(wrapper.findAll('.wave')).toHaveLength(2)
    expect(wrapper.find('.data-point').exists()).toBe(true)
    expect(wrapper.get('.site-emblem').attributes('aria-hidden')).toBe('true')
  })

  it.each(brandedViews)('%s uses the shared component', (fileName) => {
    const source = readFileSync(resolve(process.cwd(), 'src/views', fileName), 'utf8')
    expect(source).toContain("import BrandMark from '../components/BrandMark.vue'")
    expect(source).toContain('<BrandMark')
  })
})
