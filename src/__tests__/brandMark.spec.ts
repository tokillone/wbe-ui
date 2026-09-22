import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BrandMark from '../components/BrandMark.vue'

const platformViews = [
  'HomeView.vue',
  'Icd11SankeyView.vue',
  'CoreMarkerPriorityView.vue',
  'DataEntryView.vue',
]

describe('shared blue brand mark', () => {
  it('renders the institutional WBE wordmark', () => {
    const wrapper = mount(BrandMark, { props: { size: 44 } })

    expect(wrapper.get('.site-emblem').attributes('style')).toContain('--emblem-size: 44px')
    expect(wrapper.get('.site-emblem strong').text()).toBe('WBE')
    expect(wrapper.find('.wave').exists()).toBe(false)
    expect(wrapper.get('.site-emblem').attributes('aria-hidden')).toBe('true')
  })

  it('renders the academic evidence-path symbol with four tool nodes', () => {
    const wrapper = mount(BrandMark, { props: { size: 40, variant: 'academic' } })

    expect(wrapper.get('.site-emblem').classes()).toContain('is-academic')
    expect(wrapper.get('.site-emblem-symbol').attributes('viewBox')).toBe('0 0 35 32')
    expect(wrapper.findAll('.site-emblem-node')).toHaveLength(4)
    expect(wrapper.get('.site-emblem strong').text()).toBe('WBE')
  })

  it('the platform header owns the shared brand mark', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/PlatformHeader.vue'), 'utf8')
    expect(source).toContain("import BrandMark from './BrandMark.vue'")
    expect(source).toContain('<BrandMark')
  })

  it.each(platformViews)('%s uses the unified platform header', (fileName) => {
    const source = readFileSync(resolve(process.cwd(), 'src/views', fileName), 'utf8')
    expect(source).toContain("import PlatformHeader from '../components/PlatformHeader.vue'")
    expect(source).toContain('<PlatformHeader')
  })

  it('MapVisualizationView.vue uses the shared component through MapPageHeader', () => {
    const viewSource = readFileSync(
      resolve(process.cwd(), 'src/views/MapVisualizationView.vue'),
      'utf8',
    )
    const headerSource = readFileSync(
      resolve(process.cwd(), 'src/components/map/MapPageHeader.vue'),
      'utf8',
    )

    expect(viewSource).toContain("import MapPageHeader from '../components/map/MapPageHeader.vue'")
    expect(viewSource).toContain('<MapPageHeader')
    expect(headerSource).toContain("import PlatformHeader from '../PlatformHeader.vue'")
    expect(headerSource).toContain('<PlatformHeader')
  })

  it('MethodologyVerificationView.vue uses the shared component through PageHeader', () => {
    const viewSource = readFileSync(
      resolve(process.cwd(), 'src/views/MethodologyVerificationView.vue'),
      'utf8',
    )
    const headerSource = readFileSync(
      resolve(process.cwd(), 'src/components/methodology/PageHeader.vue'),
      'utf8',
    )

    expect(viewSource).toContain(
      "import PageHeader from '../components/methodology/PageHeader.vue'",
    )
    expect(viewSource).toContain('<PageHeader')
    expect(headerSource).toContain("import PlatformHeader from '../PlatformHeader.vue'")
    expect(headerSource).toContain('<PlatformHeader')
  })

  it('keeps the standalone authentication screen branded', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/views/AuthView.vue'), 'utf8')
    expect(source).toContain("import BrandMark from '../components/BrandMark.vue'")
    expect(source).toContain('<BrandMark')
  })
})
