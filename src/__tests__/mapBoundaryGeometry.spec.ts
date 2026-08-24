import { describe, expect, it } from 'vitest'

import {
  boundaryCollectionForParents,
  polygonBoundariesToLines,
  visibleParentGeoKeys,
  type BoundaryFeatureCollection,
} from '../utils/mapBoundaryGeometry'

const polygonCollection: BoundaryFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { geo_key: 'china|jiangsu', parent_geo_key: 'china' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [118, 30],
            [121, 30],
            [121, 33],
            [118, 33],
            [118, 30],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { geo_key: 'china|zhejiang', parent_geo_key: 'china' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [118, 27],
              [122, 27],
              [122, 30],
              [118, 30],
              [118, 27],
            ],
          ],
        ],
      },
    },
  ],
}

describe('map boundary line geometry', () => {
  it('converts every polygon feature to a true line geometry before MapLibre tiling', () => {
    const result = polygonBoundariesToLines(polygonCollection)

    expect(result.features).toHaveLength(2)
    expect(result.features.every((feature) => /LineString$/.test(String((feature.geometry as any).type))))
      .toBe(true)
    expect(result.features.some((feature) => /Polygon/.test(String((feature.geometry as any).type))))
      .toBe(false)
  })

  it('removes duplicate consecutive coordinates without inventing tile-edge segments', () => {
    const collection: BoundaryFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { geo_key: 'taiwan-regression' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [120, 22],
                [120, 22],
                [121, 23],
                [120, 22],
              ],
            ],
          },
        },
      ],
    }

    const line = polygonBoundariesToLines(collection).features[0]!.geometry as any
    expect(line.type).toBe('LineString')
    expect(line.coordinates).toEqual([
      [120, 22],
      [121, 23],
      [120, 22],
    ])
  })

  it('splits antimeridian rings instead of drawing a line across the world', () => {
    const collection: BoundaryFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { geo_key: 'antimeridian-regression' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [179, 50],
                [179.5, 51],
                [-179.5, 51],
                [-179, 50],
                [179, 50],
              ],
            ],
          },
        },
      ],
    }

    const geometry = polygonBoundariesToLines(collection).features[0]!.geometry as any
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates
    const maxJump = Math.max(
      ...lines.flatMap((line: number[][]) =>
        line.slice(1).map((point, index) => Math.abs(point[0]! - line[index]![0]!)),
      ),
    )
    expect(maxJump).toBeLessThan(180)
  })

  it('updates city parents only when provinces intersect the viewport', () => {
    expect(visibleParentGeoKeys(polygonCollection, [117.9, 30.4, 121.1, 32.8], 0)).toEqual([
      'china|jiangsu',
    ])
  })

  it('filters city collections by the active province cache key', () => {
    const cities: BoundaryFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          ...polygonCollection.features[0]!,
          properties: { parent_geo_key: 'china|jiangsu' },
        },
        {
          ...polygonCollection.features[1]!,
          properties: { parent_geo_key: 'china|zhejiang' },
        },
      ],
    }

    const scoped = boundaryCollectionForParents(cities, ['china|zhejiang'])
    expect(scoped.features).toHaveLength(1)
    expect(scoped.features[0]!.properties.parent_geo_key).toBe('china|zhejiang')
  })
})
