import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const sankeyView = readFileSync(resolve(process.cwd(), 'src/views/Icd11SankeyView.vue'), 'utf8')
const coreMarkerView = readFileSync(
  resolve(process.cwd(), 'src/views/CoreMarkerPriorityView.vue'),
  'utf8',
)
const coreMarkerDocument = readFileSync(
  resolve(process.cwd(), 'public/core-marker-priority/index.html'),
  'utf8',
)

describe('page operation guide integrations', () => {
  it('adds a six-step first-visit guide to the Sankey page', () => {
    const steps = sankeyView.slice(
      sankeyView.indexOf('const SANKEY_OPERATION_GUIDE_STEPS'),
      sankeyView.indexOf('use([SankeyChart'),
    )

    expect(steps.match(/targetSelectors:/g)).toHaveLength(6)
    expect(sankeyView).toContain("'wbe:icd11-sankey-operation-guide:v2'")
    expect(sankeyView).toContain('const SANKEY_OPERATION_GUIDE_DELAY_MS = 600')
    expect(sankeyView).toContain("loadState.value === 'ready'")
    expect(sankeyView).toContain('hasRenderableGraph.value')
    expect(sankeyView).toContain('handleSankeyWorkspaceInteraction')
    expect(sankeyView).toContain("openSankeyOperationGuide('auto')")
    expect(sankeyView).toContain("openSankeyOperationGuide('manual')")
    expect(sankeyView).toContain('aria-label="操作指引"')
    expect(sankeyView).toContain('图表说明')
    expect(sankeyView).toContain('class="reading-guide-layer"')
    expect(sankeyView).not.toContain('class="reading-guide-disclosure"')
    expect(sankeyView).toContain('<OperationGuide')
  })

  it('waits for a trusted iframe ready message before opening the core-marker guide', () => {
    const steps = coreMarkerView.slice(
      coreMarkerView.indexOf('const CORE_MARKER_OPERATION_GUIDE_STEPS'),
      coreMarkerView.indexOf('const isPrototypeReady'),
    )

    expect(steps.match(/targetSelectors:/g)).toHaveLength(5)
    expect(coreMarkerView).toContain("'wbe:core-marker-priority-operation-guide:v1'")
    expect(coreMarkerView).toContain('const CORE_MARKER_OPERATION_GUIDE_DELAY_MS = 600')
    expect(coreMarkerView).toContain('event.origin !== window.location.origin')
    expect(coreMarkerView).toContain('event.source !== prototypeFrame.value?.contentWindow')
    expect(coreMarkerView).toContain("event.data.type === 'core-marker-priority:ready'")
    expect(coreMarkerView).toContain('scheduleCoreMarkerOperationGuide()')
    expect(coreMarkerView).toContain(':target-document="prototypeTargetDocument"')
    expect(coreMarkerView).toContain(':target-frame="prototypeFrame"')
    expect(coreMarkerView).toContain("openCoreMarkerOperationGuide('manual')")
  })

  it('lets the trusted host prepare the embedded page without accepting foreign messages', () => {
    expect(coreMarkerDocument).toContain('event.origin!==location.origin')
    expect(coreMarkerDocument).toContain('event.source!==parent')
    expect(coreMarkerDocument).toContain(
      'event.data?.type!=="core-marker-priority:prepare-guide"',
    )
    expect(coreMarkerDocument).toContain(
      'closeSearchSuggestions();closeRankingPickers();closePathDialog(true);closeDrawer()',
    )
  })
})
