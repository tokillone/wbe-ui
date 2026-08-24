import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import { describe, expect, it } from 'vitest'

import {
  buildPreviewBasemapLayers,
  PREVIEW_ADMIN1_LEVEL_END,
  PREVIEW_BOUNDARY_LAYER_IDS,
  PREVIEW_CITY_BOUNDARY_FADE_START,
  PREVIEW_COUNTRY_LEVEL_END,
  PREVIEW_LABEL_LAYER_IDS,
  PREVIEW_MAP_MAX_ZOOM,
  PREVIEW_MAP_MIN_ZOOM,
} from '../utils/previewBasemapStyle'

type TestLayer = {
  id: string
  type?: string
  source?: string
  'source-layer'?: string
  minzoom?: number
  maxzoom?: number
  layout?: Record<string, unknown>
  paint?: Record<string, unknown>
}

function countZoomOperators(value: unknown): number {
  if (!Array.isArray(value)) return 0
  return (
    (value.length === 1 && value[0] === 'zoom' ? 1 : 0) +
    value.reduce((total, item) => total + countZoomOperators(item), 0)
  )
}

const baseLayers = [
  { id: 'background', type: 'background', paint: {} },
  { id: 'earth', type: 'fill', source: 'protomaps', 'source-layer': 'earth', paint: {} },
  { id: 'roads_major', type: 'line', source: 'protomaps', 'source-layer': 'roads', paint: {} },
  { id: 'boundaries_country', type: 'line', source: 'protomaps', paint: {} },
  { id: 'places_country', type: 'symbol', source: 'protomaps', layout: { 'text-field': 'x' } },
]

describe('preview composite basemap style', () => {
  it('matches the preview zoom contract', () => {
    expect(PREVIEW_MAP_MIN_ZOOM).toBe(1.1)
    expect(PREVIEW_MAP_MAX_ZOOM).toBe(8)
    expect(PREVIEW_COUNTRY_LEVEL_END).toBe(3.85)
    expect(PREVIEW_ADMIN1_LEVEL_END).toBe(6.6)
    expect(PREVIEW_CITY_BOUNDARY_FADE_START).toBe(6.1)
  })

  it('removes built-in labels and boundaries and uses one vector source', () => {
    const layers = buildPreviewBasemapLayers(baseLayers, 'zh') as TestLayer[]
    expect(layers.some((layer) => layer.id === 'places_country')).toBe(false)
    expect(layers.some((layer) => layer.id === 'boundaries_country')).toBe(false)
    expect(
      layers.filter((layer) => layer.source).every((layer) => layer.source === 'protomaps'),
    ).toBe(true)
    expect(layers.find((layer) => layer.id === 'roads_major')?.paint?.['line-color']).toBe(
      '#ffffff',
    )
  })

  it('renders inland water lighter than oceans using water metadata', () => {
    const layers = buildPreviewBasemapLayers(baseLayers, 'zh') as TestLayer[]
    const background = layers.find((layer) => layer.id === 'background')
    const water = layers.find((layer) => layer.id === 'water-mask-below-boundaries')
    const waterEdge = layers.find((layer) => layer.id === 'water-edge-below-boundaries')
    expect(background?.paint?.['background-color']).toBe('#d7e0e4')
    const fillExpression = JSON.stringify(water?.paint?.['fill-color'])
    expect(fillExpression).toContain('#d7e0e4')
    expect(fillExpression).toContain('#e8eef0')
    expect(fillExpression).toContain('kind_detail')
    expect(fillExpression).toContain('strait')
    expect(JSON.stringify(waterEdge?.paint?.['line-color'])).toContain('#d4dde1')
    expect(JSON.stringify(waterEdge?.paint?.['line-opacity'])).toContain('0.28')
    expect(JSON.stringify(waterEdge?.paint?.['line-width'])).toContain('0.65')
  })

  it('keeps the reference boundary ordering and administrative labels', () => {
    const zhLayers = buildPreviewBasemapLayers(baseLayers, 'zh') as TestLayer[]
    const enLayers = buildPreviewBasemapLayers(baseLayers, 'en') as TestLayer[]
    const firstLabel = zhLayers.findIndex((layer) => layer.id === PREVIEW_LABEL_LAYER_IDS[0])
    const lastBoundary = zhLayers.findIndex(
      (layer) => layer.id === PREVIEW_BOUNDARY_LAYER_IDS[PREVIEW_BOUNDARY_LAYER_IDS.length - 1],
    )
    expect(firstLabel).toBeGreaterThan(lastBoundary)
    expect(zhLayers.find((layer) => layer.id === 'country-priority-labels')?.['source-layer']).toBe(
      'preview_country_labels',
    )
    expect(
      zhLayers.find((layer) => layer.id === 'presentation-admin1-labels-adm1_le25')?.[
        'source-layer'
      ],
    ).toBe('preview_presentation_admin1_labels')
    expect(
      zhLayers.find((layer) => layer.id === 'presentation-admin2-labels-standard')?.[
        'source-layer'
      ],
    ).toBe('preview_presentation_admin2_labels')
    expect(
      zhLayers.find((layer) => layer.id === 'presentation-admin2-borders')?.['source-layer'],
    ).toBe('preview_presentation_admin2_boundaries')
    expect(zhLayers.some((layer) => layer.id === 'global-city-labels')).toBe(false)
    expect(zhLayers.some((layer) => layer.id === 'localized-global-city-labels')).toBe(false)
    expect(
      zhLayers.some((layer) => layer['source-layer'] === 'places' && layer.type === 'symbol'),
    ).toBe(false)
    const englishCityText = JSON.stringify(
      enLayers.find((layer) => layer.id === 'presentation-admin2-labels-standard')?.layout?.[
        'text-field'
      ],
    )
    expect(englishCityText).toContain('display_name_en')
    const chineseAdminText = JSON.stringify(
      zhLayers.find((layer) => layer.id === 'presentation-admin1-labels-adm1_le25')?.layout?.[
        'text-field'
      ],
    )
    expect(chineseAdminText).toContain('name_zh_verified')
    expect(chineseAdminText).toContain('display_name_local')
  })

  it('keeps China province borders above city borders while switching global meshes', () => {
    const layers = buildPreviewBasemapLayers(baseLayers, 'zh') as TestLayer[]
    const presentationAdmin1 = layers.find((layer) => layer.id === 'presentation-admin1-borders')
    expect(presentationAdmin1?.maxzoom).toBeUndefined()
    expect(presentationAdmin1?.['source-layer']).toBe('preview_presentation_admin1_boundaries')
    expect(JSON.stringify(presentationAdmin1?.paint?.['line-opacity'])).toContain('adm1_26_80')
    expect(JSON.stringify(presentationAdmin1?.paint?.['line-opacity'])).toContain('4.25')
    const chinaProvince = layers.find((layer) => layer.id === 'china-province-borders')
    const chinaCity = layers.find((layer) => layer.id === 'china-city-borders')
    expect(layers.some((layer) => layer.id.includes('border-bridge'))).toBe(false)
    expect(chinaProvince?.maxzoom).toBeUndefined()
    expect(chinaProvince?.layout?.['line-cap']).toBe('round')
    expect(chinaProvince?.paint?.['line-color']).toBe('#8d9498')
    expect(chinaProvince?.paint?.['line-opacity']).toBe(0.6)
    expect(chinaProvince?.paint?.['line-width']).toEqual([
      'interpolate',
      ['linear'],
      ['zoom'],
      3.8,
      0.7,
      5.2,
      0.9,
      6.5,
      1.1,
      8,
      1.3,
    ])
    expect(layers.find((layer) => layer.id === 'presentation-admin2-borders')?.minzoom).toBe(6.35)
    expect(
      JSON.stringify(
        layers.find((layer) => layer.id === 'presentation-admin2-borders')?.paint?.['line-opacity'],
      ),
    ).toContain('veryDense')
    expect(chinaCity?.minzoom).toBe(PREVIEW_CITY_BOUNDARY_FADE_START)
    expect(JSON.stringify(chinaCity?.paint?.['line-opacity'])).toContain('6.6')
    expect(layers.indexOf(chinaProvince!)).toBeGreaterThan(layers.indexOf(chinaCity!))
    expect(layers.findIndex((layer) => layer.id === 'country-major-borders')).toBeGreaterThan(
      layers.indexOf(chinaProvince!),
    )
    expect(layers.some((layer) => layer.id === 'country-compact-labels')).toBe(false)
    expect(layers.some((layer) => layer.id === 'country-undivided-labels')).toBe(false)
    expect(layers.some((layer) => layer.id === 'country-micro-labels')).toBe(false)
    expect(new Set(layers.map((layer) => layer.id)).size).toBe(layers.length)
  })

  it('gives every profile a real minzoom without invisible collision labels', () => {
    const layers = buildPreviewBasemapLayers(baseLayers, 'zh') as TestLayer[]
    const adaptiveBoundaryExpressions = [
      layers.find((layer) => layer.id === 'presentation-admin1-borders')?.paint?.['line-opacity'],
      layers.find((layer) => layer.id === 'presentation-admin2-borders')?.paint?.['line-opacity'],
    ]
    expect(
      adaptiveBoundaryExpressions.every((expression) => countZoomOperators(expression) === 1),
    ).toBe(true)
    const expectedMinzooms = new Map([
      ['presentation-admin1-labels-adm1_le25', 4.05],
      ['presentation-admin1-labels-adm1_26_80', 4.45],
      ['presentation-admin1-labels-adm1_81_160', 4.95],
      ['presentation-admin1-labels-adm1_gt160', 5.45],
      ['presentation-admin1-labels-china', 4.05],
      ['presentation-admin2-labels-sparse', 6.55],
      ['presentation-admin2-labels-standard', 7.05],
      ['presentation-admin2-labels-dense', 7.5],
      ['presentation-admin2-labels-veryDense', 7.9],
      ['presentation-admin2-labels-china', 6.3],
    ])
    for (const [id, minzoom] of expectedMinzooms) {
      const layer = layers.find((candidate) => candidate.id === id)
      expect(layer?.minzoom).toBe(minzoom)
      expect(layer?.maxzoom).toBe(8.01)
      expect(layer?.paint?.['text-opacity']).toBe(0.92)
      expect(countZoomOperators(layer?.paint?.['text-opacity'])).toBe(0)
    }
  })

  it('uses continuous shared administrative typography through maximum zoom', () => {
    const layers = buildPreviewBasemapLayers(baseLayers, 'zh') as TestLayer[]
    const countrySizes = [
      'country-priority-labels',
      'country-secondary-labels',
      'country-detail-labels',
    ].map((id) => layers.find((layer) => layer.id === id)?.layout?.['text-size'])
    expect(new Set(countrySizes.map((size) => JSON.stringify(size))).size).toBe(1)
    expect(JSON.stringify(countrySizes[0])).toContain('13')
    const admin1 = layers.find((layer) => layer.id === 'presentation-admin1-labels-china')
    const admin2 = layers.find((layer) => layer.id === 'presentation-admin2-labels-china')
    expect(admin1?.layout?.['text-font']).toEqual(['Noto Sans Medium'])
    expect(admin2?.layout?.['text-font']).toEqual(['Noto Sans Medium'])
    expect(JSON.stringify(admin1?.layout?.['text-size'])).toContain('13.4')
    expect(JSON.stringify(admin2?.layout?.['text-size'])).toContain('12.6')
    expect(admin2?.layout?.['text-padding']).toBe(14)
    expect(admin2?.paint?.['text-halo-width']).toBe(1.8)
  })

  it('keeps at least one administrative name layer active at every transition fixture', () => {
    const layers = buildPreviewBasemapLayers(baseLayers, 'zh') as TestLayer[]
    const labels = layers.filter(
      (layer) => layer.type === 'symbol' && PREVIEW_LABEL_LAYER_IDS.includes(layer.id as never),
    )
    for (const zoom of [3.8, 4.1, 6.3, 6.6, 7.3, 7.7, 8]) {
      const active = labels.filter(
        (layer) =>
          (layer.minzoom == null || zoom >= layer.minzoom) &&
          (layer.maxzoom == null || zoom < layer.maxzoom),
      )
      expect(active.length, `expected labels at Z${zoom}`).toBeGreaterThan(0)
      expect(active.every((layer) => layer.paint?.['text-opacity'] !== 0)).toBe(true)
    }
  })

  it('emits a MapLibre-valid composite style without nested zoom expressions', () => {
    const layers = buildPreviewBasemapLayers(baseLayers, 'zh') as TestLayer[]
    const errors = validateStyleMin({
      version: 8,
      glyphs: '/fonts/{fontstack}/{range}.pbf',
      sources: { protomaps: { type: 'vector', url: 'pmtiles:///tiles/test.pmtiles' } },
      layers,
    } as any)
    expect(errors.map((error) => error.message)).toEqual([])
  })
})
