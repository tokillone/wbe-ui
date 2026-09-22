export const SANKEY_ROUTE_NODE_PREFIX = '__wbe_level3_route__'
export const SANKEY_ROUTE_BRIDGE_WIDTH = 34
export const SANKEY_ROUTE_BRIDGE_HEIGHT = 4
export const SANKEY_NODE_GRAPHIC_Z2 = 20
export const SANKEY_LABEL_GRAPHIC_Z2 = 100

export interface SankeyLayerElement {
  z2?: number
  getTextContent?: () => SankeyLayerElement | undefined
  markRedraw?: () => void
}

export function raiseSankeyNodeLabelLayer(element: SankeyLayerElement, routing = false) {
  if (routing) return
  element.z2 = SANKEY_NODE_GRAPHIC_Z2
  const label = element.getTextContent?.()
  if (label) {
    label.z2 = SANKEY_LABEL_GRAPHIC_Z2
    label.markRedraw?.()
  }
  element.markRedraw?.()
}

export interface SankeyRoutableLink {
  linkId: string
  source: string
  target: string
  mappingLevel: string
  edgeType: string
  semanticLinkId?: string
  semanticSource?: string
  semanticTarget?: string
}

export interface SankeyRouteGroup<TLink extends SankeyRoutableLink> {
  source: string
  links: TLink[]
}

export interface SankeyRoutingNode {
  name: string
  depth: number
  focused?: boolean
  routing?: boolean
}

export function orderSankeyRoutingNodes<TNode extends SankeyRoutingNode>(
  nodes: TNode[],
  preserveNodeOrder = false,
) {
  const ordered = [...nodes]
  if (preserveNodeOrder) return ordered

  const originalIndex = new Map(ordered.map((node, index) => [node.name, index]))
  const rank = (node: SankeyRoutingNode) =>
    node.routing ? (node.focused ? 1 : 3) : node.focused ? 0 : 2
  return ordered.sort((left, right) => {
    if (left.depth !== 2 || right.depth !== 2) {
      return (originalIndex.get(left.name) ?? 0) - (originalIndex.get(right.name) ?? 0)
    }
    return (
      rank(left) - rank(right) ||
      (originalIndex.get(left.name) ?? 0) - (originalIndex.get(right.name) ?? 0)
    )
  })
}

export function sankeyRouteNodeName(source: string) {
  return `${SANKEY_ROUTE_NODE_PREFIX}${source}`
}

export function splitLevel2OnlyLinks<TLink extends SankeyRoutableLink>(links: TLink[]) {
  const groups = new Map<string, TLink[]>()
  for (const link of links) {
    if (link.mappingLevel !== 'Level2' || link.edgeType !== 'ICD11_Level2 → 药物') continue
    const source = link.semanticSource ?? link.source
    const entries = groups.get(source) ?? []
    entries.push(link)
    groups.set(source, entries)
  }

  const routedLinks = links.flatMap((link) => {
    const isDirect = link.mappingLevel === 'Level2' && link.edgeType === 'ICD11_Level2 → 药物'
    if (!isDirect) return [link]
    const source = link.semanticSource ?? link.source
    const target = link.semanticTarget ?? link.target
    const routeName = sankeyRouteNodeName(source)
    const semanticLinkId = link.semanticLinkId ?? link.linkId
    return [
      {
        ...link,
        linkId: `${link.linkId}@@route:in`,
        target: routeName,
        semanticLinkId,
        semanticSource: source,
        semanticTarget: target,
      },
      {
        ...link,
        linkId: `${link.linkId}@@route:out`,
        source: routeName,
        semanticLinkId,
        semanticSource: source,
        semanticTarget: target,
      },
    ]
  }) as TLink[]

  return {
    groups: [...groups.entries()].map(([source, groupedLinks]) => ({
      source,
      links: groupedLinks,
    })) as SankeyRouteGroup<TLink>[],
    links: routedLinks,
  }
}

export interface RoutingBridgeBounds {
  x: number
  y: number
  width: number
  height: number
  left: number
  right: number
  joinX: number
  centerY: number
}

export interface RoutingBridgeLaneInput {
  id: string
  incomingY: number
  outgoingY: number
  incomingExtent: number
  outgoingExtent: number
}

export interface RoutingBridgeLane {
  id: string
  y: number
  extent: number
}

export function routingHorizontalBridgeBounds(
  x: number,
  y: number,
  nodeWidth: number,
  nodeHeight: number,
  bridgeWidth = SANKEY_ROUTE_BRIDGE_WIDTH,
  bridgeHeight = SANKEY_ROUTE_BRIDGE_HEIGHT,
): RoutingBridgeBounds {
  const safeNodeWidth = Math.max(1, nodeWidth)
  const safeNodeHeight = Math.max(1, nodeHeight)
  const width = Math.max(safeNodeWidth, bridgeWidth)
  const height = Math.min(safeNodeHeight, Math.max(2, bridgeHeight))
  const joinX = x + safeNodeWidth / 2
  const centerY = y + safeNodeHeight / 2
  const bridgeX = joinX - width / 2
  const bridgeY = centerY - height / 2
  return {
    x: bridgeX,
    y: bridgeY,
    width,
    height,
    left: bridgeX,
    right: bridgeX + width,
    joinX,
    centerY,
  }
}

export function connectRoutingLinkHorizontally(
  shape: Record<string, unknown>,
  endpoint: 'source' | 'target',
  x: number,
  curveness = 0.52,
) {
  const next = { ...shape }
  const x1 = endpoint === 'source' ? x : numericShapeValue(next.x1)
  const x2 = endpoint === 'target' ? x : numericShapeValue(next.x2)
  next.x1 = x1
  next.x2 = x2
  next.cpx1 = x1 * (1 - curveness) + x2 * curveness
  next.cpx2 = x1 * curveness + x2 * (1 - curveness)
  return next
}

export function layoutRoutingBridgeLanes(
  entries: RoutingBridgeLaneInput[],
  centerY: number,
): RoutingBridgeLane[] {
  const lanes = entries
    .map((entry) => ({
      ...entry,
      extent: Math.max(1, safeNumericValue(entry.incomingExtent, entry.outgoingExtent)),
    }))
    .sort((left, right) => left.incomingY - right.incomingY || left.id.localeCompare(right.id))
  const totalExtent = lanes.reduce((sum, lane) => sum + lane.extent, 0)
  let cursor = centerY - totalExtent / 2
  return lanes.map((lane) => {
    const result = { id: lane.id, y: cursor, extent: lane.extent }
    cursor += lane.extent
    return result
  })
}

export function connectRoutingLinkToBridge(
  shape: Record<string, unknown>,
  endpoint: 'source' | 'target',
  point: { x: number; y: number; extent: number },
  curveness = 0.52,
) {
  const next = connectRoutingLinkHorizontally(shape, endpoint, point.x, curveness)
  if (endpoint === 'source') {
    next.y1 = point.y
    next.cpy1 = point.y
  } else {
    next.y2 = point.y
    next.cpy2 = point.y
  }
  next.extent = Math.max(1, point.extent)
  return next
}

export function sankeyLayoutMotionProgress(progress: number) {
  const safeProgress = Math.max(0, Math.min(1, progress))
  const response = 7.2
  const criticallyDamped = 1 - Math.exp(-response * safeProgress) * (1 + response * safeProgress)
  const normalization = 1 - Math.exp(-response) * (1 + response)
  return safeProgress >= 1 ? 1 : criticallyDamped / normalization
}

function numericShapeValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function safeNumericValue(...values: number[]) {
  return Math.max(
    0,
    ...values.map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)),
  )
}
