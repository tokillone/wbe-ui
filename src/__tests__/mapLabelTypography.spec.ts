import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import { describe, expect, it } from 'vitest'

import {
  approximateMapLabelWidth,
  businessLabelSizeAtZoom,
  businessLabelTextSizeExpression,
  CITY_LABEL_MAX_SIZE,
  countryLabelStyleForArea,
  labelCountTier,
  labelDataEmphasisAtZoom,
  labelScaleForPointCount,
  staticLabelSizeAtZoom,
} from '../utils/mapLabelTypography'

describe('map label typography', () => {
  it('keeps the established country area classes', () => {
    expect(countryLabelStyleForArea(180)).toEqual({ size: 13, sort: 0 })
    expect(countryLabelStyleForArea(45)).toEqual({ size: 12, sort: 1 })
    expect(countryLabelStyleForArea(8)).toEqual({ size: 10.5, sort: 2 })
    expect(countryLabelStyleForArea(7.99)).toEqual({ size: 9, sort: 3 })
  })

  it('uses the bubble thresholds for five monotonic label tiers capped at twelve percent', () => {
    expect([1, 20, 80, 300, 1000].map((count) => labelCountTier('country', count))).toEqual([
      0, 1, 2, 3, 4,
    ])
    expect([1, 20, 80, 300, 1000].map((count) => labelScaleForPointCount('country', count))).toEqual(
      [1, 1.03, 1.06, 1.09, 1.12],
    )
    expect(labelScaleForPointCount('country', Number.POSITIVE_INFINITY)).toBe(1)
  })

  it('returns to the static baseline at hierarchy hand-offs', () => {
    for (const [level, zoom, area] of [
      ['country', 3.85, 954.9],
      ['admin1', 3.85, 0],
      ['admin1', 6.6, 0],
      ['city', 6.45, 0],
    ] as const) {
      expect(businessLabelSizeAtZoom(level, zoom, 10_000, area)).toBeCloseTo(
        staticLabelSizeAtZoom(level, zoom, area),
        6,
      )
      expect(labelDataEmphasisAtZoom(level, zoom)).toBe(0)
    }
  })

  it('enlarges maximum-zoom city labels and preserves the count emphasis', () => {
    expect(staticLabelSizeAtZoom('city', 8)).toBe(CITY_LABEL_MAX_SIZE)
    expect(businessLabelSizeAtZoom('city', 8, 100)).toBeCloseTo(CITY_LABEL_MAX_SIZE * 1.12, 6)
    expect(businessLabelSizeAtZoom('city', 8, 49)).toBeGreaterThan(
      businessLabelSizeAtZoom('city', 8, 3),
    )
  })

  it('uses the rendered size when reserving label width', () => {
    expect(approximateMapLabelWidth('兰州市', 14)).toBeGreaterThan(
      approximateMapLabelWidth('兰州市', 10),
    )
    expect(approximateMapLabelWidth('Lanzhou', 14)).toBeGreaterThan(
      approximateMapLabelWidth('Lanzhou', 10),
    )
  })

  it('emits MapLibre-valid top-level zoom expressions for every business level', () => {
    for (const level of ['country', 'admin1', 'city'] as const) {
      const errors = validateStyleMin({
        version: 8,
        glyphs: '/fonts/{fontstack}/{range}.pbf',
        sources: {
          points: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        },
        layers: [
          {
            id: `business-${level}`,
            type: 'symbol',
            source: 'points',
            layout: {
              'text-field': ['get', 'displayName'],
              'text-size': businessLabelTextSizeExpression(level),
            },
          },
        ],
      } as any)
      expect(errors.map((error) => error.message), level).toEqual([])
    }
  })
})
