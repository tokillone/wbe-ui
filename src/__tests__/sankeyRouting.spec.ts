import { describe, expect, it, vi } from 'vitest'

import {
  connectRoutingLinkHorizontally,
  connectRoutingLinkToBridge,
  layoutRoutingBridgeLanes,
  orderSankeyRoutingNodes,
  raiseSankeyNodeLabelLayer,
  routingHorizontalBridgeBounds,
  sankeyLayoutMotionProgress,
  sankeyRouteNodeName,
  splitLevel2OnlyLinks,
} from '../utils/icd11SankeyRouting'

describe('sankey Level2 direct routing', () => {
  it('keeps semantic relation ids while splitting a Level2 to drug link around the route channel', () => {
    const direct = {
      linkId: 'level2-to-drug',
      source: 'level2-a',
      target: 'drug-a',
      mappingLevel: 'Level2',
      edgeType: 'ICD11_Level2 → 药物',
      pathIds: ['path-a'],
    }
    const ordinary = {
      linkId: 'drug-to-marker',
      source: 'drug-a',
      target: 'marker-a',
      mappingLevel: 'Level2',
      edgeType: '药物 → 生物标记物',
      pathIds: ['path-a'],
    }

    const routed = splitLevel2OnlyLinks([direct, ordinary])

    expect(routed.groups).toEqual([{ source: 'level2-a', links: [direct] }])
    expect(routed.links).toHaveLength(3)
    expect(routed.links.slice(0, 2)).toMatchObject([
      {
        linkId: 'level2-to-drug@@route:in',
        source: 'level2-a',
        target: sankeyRouteNodeName('level2-a'),
        semanticLinkId: 'level2-to-drug',
        semanticSource: 'level2-a',
        semanticTarget: 'drug-a',
      },
      {
        linkId: 'level2-to-drug@@route:out',
        source: sankeyRouteNodeName('level2-a'),
        target: 'drug-a',
        semanticLinkId: 'level2-to-drug',
        semanticSource: 'level2-a',
        semanticTarget: 'drug-a',
      },
    ])
    expect(routed.links[2]).toBe(ordinary)
  })

  it('centers a horizontal route bridge and joins both cubic links without a vertical gap', () => {
    const bounds = routingHorizontalBridgeBounds(200, 40, 22, 80)
    expect(bounds).toEqual({
      x: 194,
      y: 78,
      width: 34,
      height: 4,
      left: 194,
      right: 228,
      joinX: 211,
      centerY: 80,
    })

    const shape = { x1: 100, x2: 300, cpx1: 204, cpx2: 196, y1: 40, y2: 80 }
    const incoming = connectRoutingLinkHorizontally(shape, 'target', bounds.joinX)
    const outgoing = connectRoutingLinkHorizontally(shape, 'source', bounds.joinX)
    expect(incoming).toMatchObject({ x1: 100, x2: 211, y1: 40, y2: 80 })
    expect(outgoing).toMatchObject({ x1: 211, x2: 300, y1: 40, y2: 80 })
    expect(incoming.cpx1).toBeGreaterThan(100)
    expect(incoming.cpx2).toBeLessThan(211)
    expect(outgoing.cpx1).toBeGreaterThan(211)
    expect(outgoing.cpx2).toBeLessThan(300)
  })

  it('pairs split route segments on the same vertical lane and preserves their band thickness', () => {
    const lanes = layoutRoutingBridgeLanes(
      [
        {
          id: 'path-b',
          incomingY: 90,
          outgoingY: 180,
          incomingExtent: 12,
          outgoingExtent: 12,
        },
        {
          id: 'path-a',
          incomingY: 70,
          outgoingY: 140,
          incomingExtent: 8,
          outgoingExtent: 8,
        },
      ],
      120,
    )
    expect(lanes).toEqual([
      { id: 'path-a', y: 110, extent: 8 },
      { id: 'path-b', y: 118, extent: 12 },
    ])

    const incoming = connectRoutingLinkToBridge(
      { x1: 100, y1: 70, x2: 210, y2: 70, cpx1: 156, cpy1: 70, cpx2: 154, cpy2: 70, extent: 8 },
      'target',
      { x: 220, y: 110, extent: 8 },
    )
    const outgoing = connectRoutingLinkToBridge(
      { x1: 230, y1: 140, x2: 340, y2: 140, cpx1: 286, cpy1: 140, cpx2: 284, cpy2: 140, extent: 8 },
      'source',
      { x: 220, y: 110, extent: 8 },
    )
    expect(incoming).toMatchObject({ x2: 220, y2: 110, cpy2: 110, extent: 8 })
    expect(outgoing).toMatchObject({ x1: 220, y1: 110, cpy1: 110, extent: 8 })
  })

  it('keeps route and Level3 node order stable for an unlocked hover preview', () => {
    const nodes = [
      { name: 'level3-a', depth: 2, focused: false },
      { name: 'level3-hovered', depth: 2, focused: true },
      { name: 'route-a', depth: 2, routing: true, focused: false },
      { name: 'route-hovered', depth: 2, routing: true, focused: true },
    ]

    expect(orderSankeyRoutingNodes(nodes, true).map((node) => node.name)).toEqual(
      nodes.map((node) => node.name),
    )
    expect(orderSankeyRoutingNodes(nodes).map((node) => node.name)).toEqual([
      'level3-hovered',
      'route-hovered',
      'level3-a',
      'route-a',
    ])
  })

  it('uses a continuous critically damped layout transition without overshoot', () => {
    const samples = [0, 0.1, 0.3, 0.5, 0.75, 1].map(sankeyLayoutMotionProgress)
    expect(samples[0]).toBe(0)
    expect(samples[samples.length - 1]).toBe(1)
    expect(samples.every((value, index) => index === 0 || value >= samples[index - 1]!)).toBe(true)
    expect(samples.every((value) => value >= 0 && value <= 1)).toBe(true)
    expect(samples[1]).toBeLessThan(0.2)
    expect(samples[4]).toBeGreaterThan(0.95)
  })

  it('keeps every visible node label above nodes, links and routing bridges', () => {
    const label = { z2: 0, markRedraw: vi.fn() }
    const node = { z2: 0, getTextContent: () => label, markRedraw: vi.fn() }
    raiseSankeyNodeLabelLayer(node)

    expect(node.z2).toBe(20)
    expect(label.z2).toBe(100)
    expect(label.markRedraw).toHaveBeenCalledOnce()
    expect(node.markRedraw).toHaveBeenCalledOnce()

    const routeNode = { z2: 12, markRedraw: vi.fn() }
    raiseSankeyNodeLabelLayer(routeNode, true)
    expect(routeNode.z2).toBe(12)
    expect(routeNode.markRedraw).not.toHaveBeenCalled()
  })
})
