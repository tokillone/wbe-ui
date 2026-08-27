#!/usr/bin/env node

import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { VectorTile } from '@mapbox/vector-tile'
import Protobuf from 'pbf'
import { PMTiles } from 'pmtiles'

const TILE_SIZE = 512
const NEAR_TOLERANCE_PX = 1.25
const MIN_OVERLAP_PX = 2
const MIN_OVERLAP_RATIO = 0.7
const MAX_ANGLE_DEGREES = 8
const GRID_SIZE_PX = 16
const CONNECTIVITY_TOLERANCE_PX = 1.25
const COUNTRY_PERIMETER_PARENT = 'preview_region_polygons:country'

const CONNECTIVITY_PARENT_LAYERS = Object.freeze({
  preview_presentation_admin1_boundaries: ['preview_country_boundaries', COUNTRY_PERIMETER_PARENT],
  preview_china_province_boundaries: ['preview_country_boundaries', COUNTRY_PERIMETER_PARENT],
  preview_presentation_admin2_boundaries: [
    'preview_presentation_admin1_boundaries',
    'preview_country_boundaries',
  ],
  preview_china_city_boundaries: [
    'preview_china_province_boundaries',
    'preview_country_boundaries',
  ],
})

const BOUNDARY_LAYER_RANGES = Object.freeze({
  preview_country_overview: [0, 2],
  preview_country_boundaries: [3, 8],
  preview_presentation_admin1_boundaries: [4, 8],
  // MapLibre uses z6 source tiles throughout the fractional 6.x range.
  // Audit the child layers conservatively from z6 because their style
  // becomes visible at 6.35.
  preview_presentation_admin2_boundaries: [6, 8],
  preview_china_province_boundaries: [4, 8],
  preview_china_city_boundaries: [6, 8],
})

export async function auditPreviewTileBoundaries(archivePath, options = {}) {
  const source = new NodeFileSource(archivePath)
  try {
    const legalEndpointsPath = resolve(
      options.legalEndpointsPath ??
        join(dirname(resolve(archivePath)), 'generated/boundary-legal-endpoints.json'),
    )
    const legalEndpointManifest = existsSync(legalEndpointsPath)
      ? JSON.parse(readFileSync(legalEndpointsPath, 'utf8'))
      : { zooms: {} }
    const archive = new PMTiles(source)
    const header = await archive.getHeader()
    const minZoom = Math.max(0, header.minZoom)
    const maxZoom = Math.min(8, header.maxZoom)
    const zooms = []
    const samples = []
    const globalSampleCounts = { exact: 0, near: 0, cross: 0 }
    let totalTileCount = 0
    let totalSegmentCount = 0
    let exactDuplicateCount = 0
    let nearDuplicateLikeCount = 0
    let crossLayerOverlapCount = 0
    let interiorDanglingEndpointCount = 0
    let tileSeamDanglingEndpointCount = 0
    let parentConnectedEndpointCount = 0
    let manifestLegalEndpointCount = 0
    const connectivitySamples = []

    for (let zoom = minZoom; zoom <= maxZoom; zoom += 1) {
      const limit = 2 ** zoom
      const zoomReport = {
        zoom,
        tileCount: 0,
        segmentCount: 0,
        exactDuplicateCount: 0,
        nearDuplicateLikeCount: 0,
        crossLayerOverlapCount: 0,
        interiorDanglingEndpointCount: 0,
        tileSeamDanglingEndpointCount: 0,
        parentConnectedEndpointCount: 0,
        manifestLegalEndpointCount: 0,
      }
      const zoomConnectivitySegments = []
      const zoomParentSegments = new Map()
      for (let x = 0; x < limit; x += 1) {
        for (let y = 0; y < limit; y += 1) {
          const response = await archive.getZxy(zoom, x, y)
          if (!response?.data) continue
          zoomReport.tileCount += 1
          const tile = new VectorTile(new Protobuf(response.data))
          const segments = tileBoundarySegments(tile, zoom)
          zoomConnectivitySegments.push(...globalizeSegments(segments, x, y))
          const parentLayerNames = new Set(
            segments.flatMap((segment) => CONNECTIVITY_PARENT_LAYERS[segment.layer] ?? []),
          )
          for (const layerName of parentLayerNames) {
            const values = zoomParentSegments.get(layerName) ?? []
            values.push(...globalizeSegments(tileLayerSegments(tile, layerName, zoom), x, y))
            zoomParentSegments.set(layerName, values)
          }
          zoomReport.segmentCount += segments.length
          const tileAudit = auditTileSegments(segments)
          zoomReport.exactDuplicateCount += tileAudit.exactDuplicateCount
          zoomReport.nearDuplicateLikeCount += tileAudit.nearDuplicateLikeCount
          zoomReport.crossLayerOverlapCount += tileAudit.crossLayerOverlapCount
          for (const sample of tileAudit.samples) {
            if (globalSampleCounts[sample.kind] >= 4) continue
            samples.push({ z: zoom, x, y, ...sample })
            globalSampleCounts[sample.kind] += 1
          }
        }
      }
      const legalEndpointIndexes = buildLegalEndpointIndexes(
        legalEndpointManifest.zooms?.[zoom] ?? {},
        zoom,
      )
      const connectivity = auditConnectivity(
        zoomConnectivitySegments,
        zoomParentSegments,
        legalEndpointIndexes,
      )
      zoomReport.interiorDanglingEndpointCount = connectivity.interiorDanglingEndpointCount
      zoomReport.tileSeamDanglingEndpointCount = connectivity.tileSeamDanglingEndpointCount
      zoomReport.parentConnectedEndpointCount = connectivity.parentConnectedEndpointCount
      zoomReport.manifestLegalEndpointCount = connectivity.manifestLegalEndpointCount
      for (const sample of connectivity.samples) {
        if (connectivitySamples.length >= 16) break
        connectivitySamples.push({ zoom, ...sample })
      }
      zooms.push(zoomReport)
      totalTileCount += zoomReport.tileCount
      totalSegmentCount += zoomReport.segmentCount
      exactDuplicateCount += zoomReport.exactDuplicateCount
      nearDuplicateLikeCount += zoomReport.nearDuplicateLikeCount
      crossLayerOverlapCount += zoomReport.crossLayerOverlapCount
      interiorDanglingEndpointCount += zoomReport.interiorDanglingEndpointCount
      tileSeamDanglingEndpointCount += zoomReport.tileSeamDanglingEndpointCount
      parentConnectedEndpointCount += zoomReport.parentConnectedEndpointCount
      manifestLegalEndpointCount += zoomReport.manifestLegalEndpointCount
    }

    return {
      zoomRange: { min: minZoom, max: maxZoom },
      policy: {
        tileSize: TILE_SIZE,
        tolerancePx: NEAR_TOLERANCE_PX,
        minOverlapPx: MIN_OVERLAP_PX,
        minOverlapRatio: MIN_OVERLAP_RATIO,
        maxAngleDegrees: MAX_ANGLE_DEGREES,
        visibleLayerRanges: BOUNDARY_LAYER_RANGES,
        simultaneouslyVisibleParentChildPairs: [
          ['preview_presentation_admin1_boundaries', 'preview_presentation_admin2_boundaries'],
          ['preview_china_province_boundaries', 'preview_china_city_boundaries'],
        ],
        connectivityTolerancePx: CONNECTIVITY_TOLERANCE_PX,
        legalEndpointPolicy:
          legalEndpointManifest.policy ?? 'missing-source-legal-endpoint-manifest',
      },
      totalTileCount,
      totalSegmentCount,
      exactDuplicateCount,
      nearDuplicateLikeCount,
      crossLayerOverlapCount,
      interiorDanglingEndpointCount,
      tileSeamDanglingEndpointCount,
      parentConnectedEndpointCount,
      manifestLegalEndpointCount,
      samples,
      connectivitySamples,
      zooms,
    }
  } finally {
    source.close()
  }
}

function tileLayerSegments(tile, layerName, zoom) {
  const polygonParentLevel = layerName.startsWith('preview_region_polygons:')
    ? layerName.split(':').at(-1)
    : ''
  const sourceLayerName = polygonParentLevel ? 'preview_region_polygons' : layerName
  const visibleRange = BOUNDARY_LAYER_RANGES[layerName]
  if (!polygonParentLevel && visibleRange && (zoom < visibleRange[0] || zoom > visibleRange[1])) {
    return []
  }
  const layer = tile.layers[sourceLayerName]
  if (!layer) return []
  const scale = TILE_SIZE / layer.extent
  const segments = []
  for (let featureIndex = 0; featureIndex < layer.length; featureIndex += 1) {
    const feature = layer.feature(featureIndex)
    if (polygonParentLevel) {
      if (feature.type !== 3 || String(feature.properties?.level ?? '') !== polygonParentLevel) {
        continue
      }
    } else {
      if (feature.type !== 2) continue
      if (!boundaryFeatureVisible(layerName, zoom, feature.properties ?? {})) continue
    }
    const semanticPair = boundarySemanticPair(feature.properties ?? {}, featureIndex)
    for (const line of feature.loadGeometry()) {
      for (let index = 1; index < line.length; index += 1) {
        const clipped = clipSegmentToTile(
          [line[index - 1].x * scale, line[index - 1].y * scale],
          [line[index].x * scale, line[index].y * scale],
        )
        if (!clipped || distance(clipped[0], clipped[1]) < 1e-6) continue
        segments.push({
          layer: sourceLayerName,
          semanticPair,
          start: clipped[0],
          end: clipped[1],
        })
      }
    }
  }
  return segments
}

function globalizeSegments(segments, tileX, tileY) {
  return segments.map((segment) => ({
    ...segment,
    start: [tileX * TILE_SIZE + segment.start[0], tileY * TILE_SIZE + segment.start[1]],
    end: [tileX * TILE_SIZE + segment.end[0], tileY * TILE_SIZE + segment.end[1]],
  }))
}

function auditConnectivity(segments, parentSegmentsByLayer, legalEndpointIndexes) {
  let interiorDanglingEndpointCount = 0
  let tileSeamDanglingEndpointCount = 0
  let parentConnectedEndpointCount = 0
  let manifestLegalEndpointCount = 0
  const samples = []
  const byLayer = new Map()
  for (const segment of segments) {
    if (!CONNECTIVITY_PARENT_LAYERS[segment.layer]) continue
    const values = byLayer.get(segment.layer) ?? []
    values.push(segment)
    byLayer.set(segment.layer, values)
  }
  for (const [layerName, layerSegments] of byLayer) {
    const endpointGroups = clusterEndpoints(layerSegments, CONNECTIVITY_TOLERANCE_PX)
    const parentSegments = (CONNECTIVITY_PARENT_LAYERS[layerName] ?? []).flatMap(
      (parentLayer) => parentSegmentsByLayer.get(parentLayer) ?? [],
    )
    const parentIndex = segmentDistanceIndex(parentSegments, CONNECTIVITY_TOLERANCE_PX)
    const legalEndpointIndex = legalEndpointIndexes.get(layerName) ?? new Map()
    for (const group of endpointGroups) {
      if (group.degree !== 1) continue
      if (pointNearSegmentIndex(group.point, parentIndex, CONNECTIVITY_TOLERANCE_PX)) {
        parentConnectedEndpointCount += 1
        continue
      }
      if (pointNearSegmentIndex(group.point, legalEndpointIndex, CONNECTIVITY_TOLERANCE_PX)) {
        manifestLegalEndpointCount += 1
        continue
      }
      interiorDanglingEndpointCount += 1
      const onTileSeam = pointOnTileSeam(group.point, CONNECTIVITY_TOLERANCE_PX)
      if (onTileSeam) tileSeamDanglingEndpointCount += 1
      if (samples.length < 8) {
        samples.push({
          layer: layerName,
          point: group.point,
          onTileSeam,
          semanticPairs: [...group.semanticPairs],
        })
      }
    }
  }
  return {
    interiorDanglingEndpointCount,
    tileSeamDanglingEndpointCount,
    parentConnectedEndpointCount,
    manifestLegalEndpointCount,
    samples,
  }
}

function buildLegalEndpointIndexes(layers, zoom) {
  const indexes = new Map()
  for (const [layerName, coordinates] of Object.entries(layers ?? {})) {
    const segments = coordinates
      .map((coordinate) => longitudeLatitudeWorldPixel(coordinate, zoom))
      .filter(Boolean)
      .map((point) => ({ start: point, end: point }))
    indexes.set(layerName, segmentDistanceIndex(segments, CONNECTIVITY_TOLERANCE_PX))
  }
  return indexes
}

function longitudeLatitudeWorldPixel(coordinate, zoom) {
  if (!Array.isArray(coordinate) || coordinate.length < 2) return null
  const longitude = Number(coordinate[0])
  const latitude = Number(coordinate[1])
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null
  const size = TILE_SIZE * 2 ** zoom
  const clampedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude))
  const sine = Math.sin((clampedLatitude * Math.PI) / 180)
  return [
    ((longitude + 180) / 360) * size,
    (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * size,
  ]
}

function clusterEndpoints(segments, tolerance) {
  const endpoints = []
  const grid = new Map()
  for (const segment of segments) {
    for (const point of [segment.start, segment.end]) {
      const cellX = Math.floor(point[0] / tolerance)
      const cellY = Math.floor(point[1] / tolerance)
      const endpoint = {
        point,
        semanticPair: segment.semanticPair,
        parent: endpoints.length,
        rank: 0,
      }
      endpoints.push(endpoint)
      for (let x = cellX - 1; x <= cellX + 1; x += 1) {
        for (let y = cellY - 1; y <= cellY + 1; y += 1) {
          for (const candidateIndex of grid.get(`${x}|${y}`) ?? []) {
            if (distance(endpoints[candidateIndex].point, point) <= tolerance) {
              unionEndpointGroups(endpoints, candidateIndex, endpoints.length - 1)
            }
          }
        }
      }
      const key = `${cellX}|${cellY}`
      const ids = grid.get(key) ?? []
      ids.push(endpoints.length - 1)
      grid.set(key, ids)
    }
  }
  const groups = new Map()
  endpoints.forEach((endpoint, index) => {
    const root = findEndpointGroup(endpoints, index)
    const group = groups.get(root) ?? {
      point: endpoint.point,
      degree: 0,
      semanticPairs: new Set(),
    }
    group.degree += 1
    group.semanticPairs.add(endpoint.semanticPair)
    groups.set(root, group)
  })
  return [...groups.values()]
}

function findEndpointGroup(endpoints, index) {
  const endpoint = endpoints[index]
  if (endpoint.parent !== index) endpoint.parent = findEndpointGroup(endpoints, endpoint.parent)
  return endpoint.parent
}

function unionEndpointGroups(endpoints, leftIndex, rightIndex) {
  let leftRoot = findEndpointGroup(endpoints, leftIndex)
  let rightRoot = findEndpointGroup(endpoints, rightIndex)
  if (leftRoot === rightRoot) return
  if (endpoints[leftRoot].rank < endpoints[rightRoot].rank) {
    ;[leftRoot, rightRoot] = [rightRoot, leftRoot]
  }
  endpoints[rightRoot].parent = leftRoot
  if (endpoints[leftRoot].rank === endpoints[rightRoot].rank) endpoints[leftRoot].rank += 1
}

function segmentDistanceIndex(segments, tolerance) {
  const index = new Map()
  for (const segment of segments) {
    for (const cell of segmentCells(segment, tolerance)) {
      const values = index.get(cell) ?? []
      values.push(segment)
      index.set(cell, values)
    }
  }
  return index
}

function pointNearSegmentIndex(point, index, tolerance) {
  const cellX = Math.floor(point[0] / GRID_SIZE_PX)
  const cellY = Math.floor(point[1] / GRID_SIZE_PX)
  const candidates = new Set()
  for (let x = cellX - 1; x <= cellX + 1; x += 1) {
    for (let y = cellY - 1; y <= cellY + 1; y += 1) {
      for (const segment of index.get(`${x}|${y}`) ?? []) candidates.add(segment)
    }
  }
  return [...candidates].some(
    (segment) => pointToSegmentDistance(point, segment.start, segment.end) <= tolerance,
  )
}

function pointToSegmentDistance(point, start, end) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy
  if (!lengthSquared) return distance(point, start)
  const projection = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared),
  )
  return distance(point, [start[0] + projection * dx, start[1] + projection * dy])
}

function pointOnTileSeam(point, tolerance) {
  const x = ((point[0] % TILE_SIZE) + TILE_SIZE) % TILE_SIZE
  const y = ((point[1] % TILE_SIZE) + TILE_SIZE) % TILE_SIZE
  return (
    x <= tolerance || TILE_SIZE - x <= tolerance || y <= tolerance || TILE_SIZE - y <= tolerance
  )
}

function tileBoundarySegments(tile, zoom) {
  const segments = []
  for (const [layerName, [minZoom, maxZoom]] of Object.entries(BOUNDARY_LAYER_RANGES)) {
    if (zoom < minZoom || zoom > maxZoom) continue
    const layer = tile.layers[layerName]
    if (!layer) continue
    const scale = TILE_SIZE / layer.extent
    for (let featureIndex = 0; featureIndex < layer.length; featureIndex += 1) {
      const feature = layer.feature(featureIndex)
      if (feature.type !== 2) continue
      if (!boundaryFeatureVisible(layerName, zoom, feature.properties ?? {})) continue
      const properties = feature.properties ?? {}
      const semanticPair = boundarySemanticPair(properties, featureIndex)
      const countryKey = String(properties.country_key ?? properties.left_country_key ?? '').trim()
      for (const line of feature.loadGeometry()) {
        for (let index = 1; index < line.length; index += 1) {
          const start = [line[index - 1].x * scale, line[index - 1].y * scale]
          const end = [line[index].x * scale, line[index].y * scale]
          const clipped = clipSegmentToTile(start, end)
          if (!clipped || distance(clipped[0], clipped[1]) < 1e-6) continue
          segments.push({
            layer: layerName,
            semanticPair,
            countryKey,
            start: clipped[0],
            end: clipped[1],
          })
        }
      }
    }
  }
  return segments
}

function boundarySemanticPair(properties, fallback) {
  const owners = [properties.left_geo_key, properties.right_geo_key]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .sort()
  return owners.length ? owners.join('|~|') : String(fallback)
}

function boundaryFeatureVisible(layerName, zoom, properties) {
  if (
    (layerName === 'preview_country_overview' || layerName === 'preview_country_boundaries') &&
    Number(properties.max_area ?? 0) < (layerName === 'preview_country_overview' ? 150 : 18)
  ) {
    return false
  }
  if (layerName === 'preview_presentation_admin1_boundaries') {
    const starts = {
      adm1_le25: 3.85,
      adm1_26_80: 4.25,
      adm1_81_160: 4.75,
      adm1_gt160: 5.25,
      china: 3.85,
    }
    return zoom >= Number(starts[properties.detail_profile] ?? 99)
  }
  if (layerName === 'preview_presentation_admin2_boundaries') {
    return zoom >= 6
  }
  return true
}

function clipSegmentToTile(start, end) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  let lower = 0
  let upper = 1
  for (const [p, q] of [
    [-dx, start[0]],
    [dx, TILE_SIZE - start[0]],
    [-dy, start[1]],
    [dy, TILE_SIZE - start[1]],
  ]) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null
      continue
    }
    const ratio = q / p
    if (p < 0) lower = Math.max(lower, ratio)
    else upper = Math.min(upper, ratio)
    if (lower > upper) return null
  }
  return [
    [start[0] + lower * dx, start[1] + lower * dy],
    [start[0] + upper * dx, start[1] + upper * dy],
  ]
}

function auditTileSegments(segments) {
  const exact = new Map()
  const grid = new Map()
  const records = []
  const samples = []
  const sampleCounts = { exact: 0, near: 0, cross: 0 }
  let exactDuplicateCount = 0
  let nearDuplicateLikeCount = 0
  let crossLayerOverlapCount = 0

  for (const segment of segments) {
    const exactKey = segmentKey(segment)
    const exactMatch = exact.get(exactKey)
    if (exactMatch && segmentLength(segment) >= MIN_OVERLAP_PX) {
      const compatibleCrossLayer =
        exactMatch.layer !== segment.layer &&
        tileBoundarySegmentsCanRepresentSameLine(segment, exactMatch)
      // Same-layer source arcs already pass an exact ownership gate before
      // tiling. Distinct arcs can quantize onto one pixel at a legal junction;
      // only a simultaneously visible cross-layer duplicate is an ownership
      // violation in the final tile audit.
      if (compatibleCrossLayer) {
        exactDuplicateCount += 1
        crossLayerOverlapCount += 1
        if (sampleCounts.exact < 4) {
          samples.push({
            kind: 'exact',
            layers: [exactMatch.layer, segment.layer],
            semanticPairs: [exactMatch.semanticPair, segment.semanticPair],
            countryKeys: [exactMatch.countryKey, segment.countryKey],
            key: exactKey,
          })
          sampleCounts.exact += 1
        }
      }
    } else {
      exact.set(exactKey, segment)
    }

    const candidateIds = new Set()
    for (const cell of segmentCells(segment, NEAR_TOLERANCE_PX)) {
      for (const id of grid.get(cell) ?? []) candidateIds.add(id)
    }
    for (const id of candidateIds) {
      const candidate = records[id]
      if (!candidate || segmentKey(candidate) === exactKey) continue
      if (candidate.layer === segment.layer) {
        // Every rendered semantic pair has a single source feature. A narrow
        // loop approaching itself is one owned boundary, not a duplicate line.
        continue
      }
      if (!tileBoundarySegmentsCanRepresentSameLine(segment, candidate)) continue
      if (!segmentsAreDuplicateLike(segment, candidate)) continue
      if (segmentsConvergeAtSharedTileEdge(segment, candidate)) continue
      nearDuplicateLikeCount += 1
      if (candidate.layer !== segment.layer) crossLayerOverlapCount += 1
      const sampleKind = candidate.layer !== segment.layer ? 'cross' : 'near'
      if (sampleCounts[sampleKind] < 4) {
        samples.push({
          kind: sampleKind,
          layers: [candidate.layer, segment.layer],
          semanticPairs: [candidate.semanticPair, segment.semanticPair],
          countryKeys: [candidate.countryKey, segment.countryKey],
          key: `${segmentKey(candidate)}~${exactKey}`,
        })
        sampleCounts[sampleKind] += 1
      }
    }
    const id = records.length
    records.push(segment)
    for (const cell of segmentCells(segment, 0)) {
      const ids = grid.get(cell) ?? []
      ids.push(id)
      grid.set(cell, ids)
    }
  }
  return { exactDuplicateCount, nearDuplicateLikeCount, crossLayerOverlapCount, samples }
}

function segmentsConvergeAtSharedTileEdge(left, right) {
  const edgeKeys = (segment) => {
    const keys = new Set()
    for (const point of [segment.start, segment.end]) {
      if (Math.abs(point[0]) <= 1e-6) keys.add('left')
      if (Math.abs(point[0] - TILE_SIZE) <= 1e-6) keys.add('right')
      if (Math.abs(point[1]) <= 1e-6) keys.add('top')
      if (Math.abs(point[1] - TILE_SIZE) <= 1e-6) keys.add('bottom')
    }
    return keys
  }
  const leftEdges = edgeKeys(left)
  const rightEdges = edgeKeys(right)
  return [...leftEdges].some((edge) => rightEdges.has(edge))
}

function tileBoundarySegmentsCanRepresentSameLine(left, right) {
  const countryLayer = (layerName) =>
    layerName === 'preview_country_overview' || layerName === 'preview_country_boundaries'
  const countryRecord = countryLayer(left.layer) ? left : countryLayer(right.layer) ? right : null
  if (countryRecord) {
    const childRecord = countryRecord === left ? right : left
    return boundaryOwnerKeys(countryRecord.semanticPair).includes(childRecord.countryKey)
  }
  return Boolean(left.countryKey && left.countryKey === right.countryKey)
}

function boundaryOwnerKeys(semanticPair) {
  return String(semanticPair ?? '')
    .split('|~|')
    .map((value) => value.trim())
    .filter(Boolean)
}

function segmentLength(segment) {
  return distance(segment.start, segment.end)
}

function segmentsAreDuplicateLike(left, right) {
  const leftVector = vector(left.start, left.end)
  const rightVector = vector(right.start, right.end)
  const leftLength = Math.hypot(...leftVector)
  const rightLength = Math.hypot(...rightVector)
  if (leftLength < MIN_OVERLAP_PX || rightLength < MIN_OVERLAP_PX) return false
  const cosine = Math.min(
    1,
    Math.abs(
      (leftVector[0] * rightVector[0] + leftVector[1] * rightVector[1]) /
        (leftLength * rightLength),
    ),
  )
  const angle = (Math.acos(cosine) * 180) / Math.PI
  if (angle > MAX_ANGLE_DEGREES) return false

  const reference = leftLength >= rightLength ? left : right
  const candidate = reference === left ? right : left
  const referenceVector = vector(reference.start, reference.end)
  const referenceLength = Math.hypot(...referenceVector)
  const unit = [referenceVector[0] / referenceLength, referenceVector[1] / referenceLength]
  const candidateStart = vector(reference.start, candidate.start)
  const candidateEnd = vector(reference.start, candidate.end)
  const startProjection = dot(candidateStart, unit)
  const endProjection = dot(candidateEnd, unit)
  const overlap = Math.max(
    0,
    Math.min(referenceLength, Math.max(startProjection, endProjection)) -
      Math.max(0, Math.min(startProjection, endProjection)),
  )
  if (overlap < MIN_OVERLAP_PX) return false
  if (overlap / Math.min(leftLength, rightLength) < MIN_OVERLAP_RATIO) return false
  const startDistance = Math.abs(cross(candidateStart, unit))
  const endDistance = Math.abs(cross(candidateEnd, unit))
  return Math.max(startDistance, endDistance) <= NEAR_TOLERANCE_PX
}

function segmentCells(segment, padding) {
  const minX = Math.floor((Math.min(segment.start[0], segment.end[0]) - padding) / GRID_SIZE_PX)
  const maxX = Math.floor((Math.max(segment.start[0], segment.end[0]) + padding) / GRID_SIZE_PX)
  const minY = Math.floor((Math.min(segment.start[1], segment.end[1]) - padding) / GRID_SIZE_PX)
  const maxY = Math.floor((Math.max(segment.start[1], segment.end[1]) + padding) / GRID_SIZE_PX)
  const cells = []
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) cells.push(`${x}|${y}`)
  }
  return cells
}

function segmentKey(segment) {
  const left = pointKey(segment.start)
  const right = pointKey(segment.end)
  return left < right ? `${left}>${right}` : `${right}>${left}`
}

function pointKey(point) {
  return `${point[0].toFixed(3)},${point[1].toFixed(3)}`
}

function vector(start, end) {
  return [end[0] - start[0], end[1] - start[1]]
}

function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1]
}

function cross(left, right) {
  return left[0] * right[1] - left[1] * right[0]
}

function distance(left, right) {
  return Math.hypot(right[0] - left[0], right[1] - left[1])
}

class NodeFileSource {
  constructor(path) {
    this.path = path
    this.fd = openSync(path, 'r')
  }

  getKey() {
    return this.path
  }

  async getBytes(offset, length) {
    const bytes = Buffer.allocUnsafe(length)
    const bytesRead = readSync(this.fd, bytes, 0, length, offset)
    const view = bytes.subarray(0, bytesRead)
    return { data: view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) }
  }

  close() {
    closeSync(this.fd)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const archivePath = resolve(process.argv[2] || 'public/tiles/wbe-preview-composite.pmtiles')
  const report = await auditPreviewTileBoundaries(archivePath)
  console.log(JSON.stringify(report, null, 2))
  if (
    report.exactDuplicateCount !== 0 ||
    report.nearDuplicateLikeCount !== 0 ||
    report.crossLayerOverlapCount !== 0 ||
    report.interiorDanglingEndpointCount !== 0 ||
    report.tileSeamDanglingEndpointCount !== 0
  ) {
    process.exitCode = 1
  }
}
