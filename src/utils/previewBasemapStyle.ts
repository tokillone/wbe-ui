import {
  ADMIN1_LABEL_MAX_SIZE,
  ADMIN1_LABEL_MIN_SIZE,
  CITY_LABEL_MAX_SIZE,
  CITY_LABEL_MIN_SIZE,
  CITY_LABEL_MIN_ZOOM,
  COUNTRY_LABEL_SCALE,
  COUNTRY_LABEL_ZOOM_GROWTH,
} from './mapLabelTypography'

export type PreviewMapLocale = 'zh' | 'en'

type StyleLayer = {
  id: string
  type?: string
  source?: string
  'source-layer'?: string
  minzoom?: number
  maxzoom?: number
  filter?: unknown
  layout?: Record<string, unknown>
  paint?: Record<string, unknown>
  [key: string]: unknown
}

const SOURCE_ID = 'protomaps'
const OCEAN_WATER_COLOR = '#d7e0e4'
const INLAND_WATER_COLOR = '#e8eef0'
const MARINE_WATER_EXPRESSION = [
  'any',
  ['match', ['get', 'kind'], ['ocean', 'sea', 'bay', 'strait'], true, false],
  ['match', ['get', 'kind_detail'], ['ocean', 'sea', 'bay', 'strait'], true, false],
] as const
const WATER_FILL_COLOR_EXPRESSION = [
  'case',
  MARINE_WATER_EXPRESSION,
  OCEAN_WATER_COLOR,
  INLAND_WATER_COLOR,
] as const
const WATER_EDGE_COLOR_EXPRESSION = ['case', MARINE_WATER_EXPRESSION, '#bcc8cd', '#d4dde1'] as const
const ADMIN1_BOUNDARY_COLOR = '#8d9498'
const ADMIN1_BOUNDARY_STOPS = [3.8, 0.7, 5.2, 0.9, 6.5, 1.1, 8, 1.3]
const ADMIN1_BOUNDARY_OPACITY = 0.6
const PRESENTATION_PROFILE_START = {
  adm1_le25: 3.85,
  adm1_26_80: 4.25,
  adm1_81_160: 4.75,
  adm1_gt160: 5.25,
  sparse: 6.35,
  standard: 6.85,
  dense: 7.3,
  veryDense: 7.7,
  china: 0,
} as const
const ADMIN1_LABEL_PROFILES = [
  'adm1_le25',
  'adm1_26_80',
  'adm1_81_160',
  'adm1_gt160',
  'china',
] as const
const ADMIN2_LABEL_PROFILES = ['sparse', 'standard', 'dense', 'veryDense', 'china'] as const

const ADMIN1_PRESENTATION_LABEL_IDS = ADMIN1_LABEL_PROFILES.map(
  (profile) => `presentation-admin1-labels-${profile}`,
)
const ADMIN2_PRESENTATION_LABEL_IDS = ADMIN2_LABEL_PROFILES.map(
  (profile) => `presentation-admin2-labels-${profile}`,
)

export const PREVIEW_MAP_MIN_ZOOM = 1.1
export const PREVIEW_MAP_MAX_ZOOM = 8
export const PREVIEW_COUNTRY_LEVEL_END = 3.85
export const PREVIEW_ADMIN1_LEVEL_END = 6.6
export const PREVIEW_CITY_BOUNDARY_FADE_START = 6.35
export const PREVIEW_COUNTRY_BOUNDARY_FADE_START = 2.55
export const PREVIEW_COUNTRY_BOUNDARY_MAJOR_VISIBLE_ZOOM = 3.45
const PREVIEW_COUNTRY_BOUNDARY_MEDIUM_VISIBLE_ZOOM = 3.85
const PREVIEW_COUNTRY_BOUNDARY_SMALL_FADE_START = 3.35
const PREVIEW_COUNTRY_BOUNDARY_SMALL_VISIBLE_ZOOM = 4.35

export const PREVIEW_BOUNDARY_LAYER_IDS = [
  'presentation-admin2-borders',
  'china-city-borders',
  'presentation-admin1-borders',
  'china-province-borders',
  'country-overview-borders',
  'country-major-borders',
  'country-medium-borders',
  'country-small-borders',
] as const

export const PREVIEW_LABEL_LAYER_IDS = [
  'country-priority-labels',
  'country-secondary-labels',
  'country-detail-labels',
  'country-micro-markers',
  ...ADMIN1_PRESENTATION_LABEL_IDS,
  ...ADMIN2_PRESENTATION_LABEL_IDS,
  'country-compact-top-labels',
  'country-undivided-top-labels',
  'country-micro-top-labels',
] as const

export const PREVIEW_LABEL_LAYER_IDS_BY_LEVEL = {
  country: [
    'country-priority-labels',
    'country-secondary-labels',
    'country-detail-labels',
    'country-micro-markers',
    'country-compact-top-labels',
    'country-undivided-top-labels',
    'country-micro-top-labels',
  ],
  admin1: ADMIN1_PRESENTATION_LABEL_IDS,
  city: ADMIN2_PRESENTATION_LABEL_IDS,
} as const

export function buildPreviewBasemapLayers(
  protomapsLayers: unknown[],
  locale: PreviewMapLocale,
): unknown[] {
  const baseLayers = protomapsLayers.flatMap(minimalistLayer)
  const controlledName = controlledNameExpression(locale)

  return [
    ...baseLayers,
    {
      id: 'water-mask-below-boundaries',
      type: 'fill',
      source: SOURCE_ID,
      'source-layer': 'water',
      paint: { 'fill-color': WATER_FILL_COLOR_EXPRESSION, 'fill-opacity': 1 },
    },
    {
      id: 'water-edge-below-boundaries',
      type: 'line',
      source: SOURCE_ID,
      'source-layer': 'water',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': WATER_EDGE_COLOR_EXPRESSION,
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          1,
          ['case', MARINE_WATER_EXPRESSION, 0.62, 0.5],
          5,
          ['case', MARINE_WATER_EXPRESSION, 0.9, 0.62],
          6,
          ['case', MARINE_WATER_EXPRESSION, 1, 0.65],
          8,
          ['case', MARINE_WATER_EXPRESSION, 1.2, 0.65],
        ],
        'line-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          1,
          ['case', MARINE_WATER_EXPRESSION, 0.84, 0.65],
          6,
          ['case', MARINE_WATER_EXPRESSION, 0.84, 0.48],
          8,
          ['case', MARINE_WATER_EXPRESSION, 0.84, 0.28],
        ],
      },
    },
    {
      id: 'presentation-admin2-borders',
      type: 'line',
      source: SOURCE_ID,
      'source-layer': 'preview_presentation_admin2_boundaries',
      minzoom: 6.35,
      filter: ['!=', ['get', 'country_key'], 'china'],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': '#adb7bc',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6.35, 0.35, 7, 0.5, 8, 0.7],
        'line-opacity': 0.56,
      },
    },
    boundaryLayer(
      'china-city-borders',
      'preview_china_city_boundaries',
      PREVIEW_CITY_BOUNDARY_FADE_START,
      '#a8b2b7',
      [6.35, 0.35, 6.6, 0.5, 8, 0.7],
      0.52,
      undefined,
      undefined,
      'round',
    ),
    boundaryLayer(
      'presentation-admin1-borders',
      'preview_presentation_admin1_boundaries',
      3.85,
      ADMIN1_BOUNDARY_COLOR,
      ADMIN1_BOUNDARY_STOPS,
      presentationBoundaryOpacity('adm1', ADMIN1_BOUNDARY_OPACITY),
      ['!=', ['get', 'country_key'], 'china'],
      undefined,
      'butt',
    ),
    boundaryLayer(
      'china-province-borders',
      'preview_china_province_boundaries',
      3.8,
      ADMIN1_BOUNDARY_COLOR,
      ADMIN1_BOUNDARY_STOPS,
      ADMIN1_BOUNDARY_OPACITY,
      undefined,
      undefined,
      'round',
    ),
    boundaryLayer(
      'country-overview-borders',
      'preview_country_overview',
      0,
      '#77848b',
      [1, 0.65, 2.05, 0.8],
      0,
      ['>=', ['get', 'max_area'], 150],
      2.05,
      'butt',
    ),
    boundaryLayer(
      'country-major-borders',
      'preview_country_boundaries',
      2.05,
      '#707d84',
      [2.05, 0.8, 4, 1.05, 6, 1.3, 8, 1.6],
      countryBoundaryFadeOpacity(0.6, PREVIEW_COUNTRY_BOUNDARY_MAJOR_VISIBLE_ZOOM),
      ['>=', ['get', 'max_area'], 150],
      8.01,
      'butt',
    ),
    boundaryLayer(
      'country-medium-borders',
      'preview_country_boundaries',
      2.05,
      '#78858c',
      [2.05, 0.75, 4, 1, 6, 1.28, 8, 1.6],
      countryBoundaryFadeOpacity(0.57, PREVIEW_COUNTRY_BOUNDARY_MEDIUM_VISIBLE_ZOOM),
      ['all', ['>=', ['get', 'max_area'], 18], ['<', ['get', 'max_area'], 150]],
      8.01,
      'butt',
    ),
    boundaryLayer(
      'country-small-borders',
      'preview_country_boundaries',
      3.05,
      '#818d93',
      [3.05, 0.65, 5, 0.95, 6.5, 1.25, 8, 1.6],
      countryBoundaryFadeOpacity(
        0.54,
        PREVIEW_COUNTRY_BOUNDARY_SMALL_VISIBLE_ZOOM,
        PREVIEW_COUNTRY_BOUNDARY_SMALL_FADE_START,
      ),
      ['<', ['get', 'max_area'], 18],
      8.01,
      'butt',
    ),
    controlledLabelLayer(
      'country-priority-labels',
      'country',
      0,
      5.65,
      [1, 12.4, 3, 13.4, 5.25, 15.2],
      '#3f4b54',
      16,
      controlledName,
      {
        worldPriority: true,
        medium: true,
        halo: 1.9,
        letterSpacing: 0.025,
        allowOverlap: false,
        ignorePlacement: false,
      },
    ),
    controlledLabelLayer(
      'country-secondary-labels',
      'country',
      2.05,
      5.65,
      [2.05, 10.8, 3.7, 12.2, 5.25, 13.4],
      '#4d5962',
      14,
      controlledName,
      {
        minArea: 18,
        excludeWorldPriority: true,
        medium: true,
        halo: 1.75,
        letterSpacing: 0.018,
        allowOverlap: false,
        ignorePlacement: false,
      },
    ),
    controlledLabelLayer(
      'country-detail-labels',
      'country',
      3.05,
      5.65,
      [3.05, 9.7, 3.85, 10.4, 5.25, 11.5],
      '#59666e',
      11,
      controlledName,
      {
        minArea: 0.2,
        maxArea: 18,
        excludeWorldPriority: true,
        halo: 1.6,
        ignorePlacement: false,
      },
    ),
    {
      id: 'country-micro-markers',
      type: 'circle',
      source: SOURCE_ID,
      'source-layer': 'preview_country_labels',
      minzoom: 5.85,
      filter: [
        'all',
        ['==', ['get', 'level'], 'country'],
        ['<', ['get', 'area'], 0.2],
        ['!=', ['get', 'suppress_country_label'], true],
      ],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5.85, 1.7, 8, 2.7],
        'circle-color': '#64727a',
        'circle-opacity': 0.86,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 0.85,
      },
    },
    ...presentationLabelLayers('adm1', locale),
    ...presentationLabelLayers('adm2', locale),
    controlledLabelLayer(
      'country-compact-top-labels',
      'country',
      5.05,
      7,
      [5.05, 10.8, 6.5, 11.8, 7, 12.2],
      '#46535c',
      12,
      controlledName,
      {
        minArea: 0.2,
        maxArea: 18,
        hasAdmin1: true,
        medium: true,
        halo: 1.9,
        letterSpacing: 0.012,
        allowOverlap: false,
        ignorePlacement: false,
      },
    ),
    controlledLabelLayer(
      'country-undivided-top-labels',
      'country',
      5.05,
      8.01,
      [5.05, 10.8, 6.5, 11.8, 8, 13.2],
      '#46535c',
      12,
      controlledName,
      {
        minArea: 0.2,
        withoutAdmin1: true,
        medium: true,
        halo: 1.9,
        letterSpacing: 0.012,
        persistToMax: true,
        allowOverlap: false,
        ignorePlacement: false,
      },
    ),
    controlledLabelLayer(
      'country-micro-top-labels',
      'country',
      5.85,
      8.01,
      [5.85, 9.2, 6.8, 10.2, 8, 11.5],
      '#505e67',
      10,
      controlledName,
      {
        maxArea: 0.2,
        halo: 1.8,
        persistToMax: true,
        textOffset: [0, 1.05],
        textAnchor: 'top',
        allowOverlap: false,
        ignorePlacement: false,
      },
    ),
  ]
}

function minimalistLayer(layer: unknown): StyleLayer[] {
  if (!isStyleLayer(layer)) return []
  if (layer.type === 'symbol' || /boundar|border/i.test(layer.id)) return []
  const paint = { ...(layer.paint ?? {}) }
  if (layer.type === 'background') paint['background-color'] = OCEAN_WATER_COLOR
  if (layer.id === 'earth') {
    paint['fill-color'] = '#f7f8f6'
    paint['fill-opacity'] = 0.98
  }
  if (layer.id === 'water') paint['fill-color'] = WATER_FILL_COLOR_EXPRESSION
  if (
    layer.type === 'fill' &&
    /landcover|landuse|park|wood|forest|grass|scrub|urban|sand|beach|glacier|building/i.test(
      layer.id,
    )
  ) {
    paint['fill-color'] = '#f4f5f3'
    paint['fill-opacity'] = 0.54
  }
  if (layer.type === 'line' && /road|highway|street/i.test(layer.id)) {
    paint['line-color'] = '#ffffff'
    paint['line-opacity'] = 0.96
  }
  if (layer.type === 'line' && /transit|rail/i.test(layer.id)) {
    paint['line-color'] = '#e4e9eb'
    paint['line-opacity'] = 0.28
  }
  if (layer.type === 'line' && /water|river|stream/i.test(layer.id)) {
    paint['line-color'] = '#dce5e8'
    paint['line-opacity'] = 0.58
  }
  return [{ ...layer, paint }]
}

function presentationBoundaryOpacity(level: 'adm1' | 'adm2', opacity: number) {
  const profiles =
    level === 'adm1'
      ? (['adm1_le25', 'adm1_26_80', 'adm1_81_160', 'adm1_gt160'] as const)
      : (['sparse', 'standard', 'dense', 'veryDense'] as const)
  return profileZoomOpacity(
    profiles.map((profile) => [profile, PRESENTATION_PROFILE_START[profile]]),
    opacity,
  )
}

function presentationLabelLayers(level: 'adm1' | 'adm2', locale: PreviewMapLocale): StyleLayer[] {
  const isAdmin1 = level === 'adm1'
  const profiles = isAdmin1 ? ADMIN1_LABEL_PROFILES : ADMIN2_LABEL_PROFILES
  return profiles.map((profile) => {
    const boundaryStart =
      profile === 'china'
        ? isAdmin1
          ? 3.85
          : PREVIEW_CITY_BOUNDARY_FADE_START
        : PRESENTATION_PROFILE_START[profile]
    const minzoom = Number(Math.min(8, boundaryStart + 0.2).toFixed(2))
    return {
      id: `presentation-${isAdmin1 ? 'admin1' : 'admin2'}-labels-${profile}`,
      type: 'symbol',
      source: SOURCE_ID,
      'source-layer': `preview_presentation_${isAdmin1 ? 'admin1' : 'admin2'}_labels`,
      minzoom,
      maxzoom: 8.01,
      filter: [
        'all',
        ['==', ['get', 'presentation_level'], level],
        ['==', ['get', 'detail_profile'], profile],
        [
          'any',
          ['!=', ['coalesce', ['get', 'display_name_zh'], ''], ''],
          ['!=', ['coalesce', ['get', 'display_name_local'], ''], ''],
          ['!=', ['coalesce', ['get', 'display_name_en'], ''], ''],
        ],
      ],
      layout: {
        'text-field':
          locale === 'en'
            ? [
                'case',
                ['!=', ['coalesce', ['get', 'display_name_en'], ''], ''],
                ['get', 'display_name_en'],
                ['coalesce', ['get', 'display_name_local'], ''],
              ]
            : [
                'case',
                [
                  'all',
                  ['==', ['get', 'name_zh_verified'], true],
                  ['!=', ['coalesce', ['get', 'display_name_zh'], ''], ''],
                ],
                ['get', 'display_name_zh'],
                [
                  'case',
                  ['!=', ['coalesce', ['get', 'display_name_local'], ''], ''],
                  ['get', 'display_name_local'],
                  ['coalesce', ['get', 'display_name_en'], ''],
                ],
              ],
        'text-font': ['Noto Sans Medium'],
        'text-size': presentationStaticTextSizeExpression(level),
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-padding': isAdmin1 ? 10 : 14,
        'symbol-sort-key': ['coalesce', ['get', 'priority'], 0],
        'text-max-width': 9,
        'text-line-height': 1.1,
      },
      paint: {
        'text-color': isAdmin1 ? '#65727a' : '#77848c',
        'text-halo-color': 'rgba(255,255,255,.98)',
        'text-halo-width': 1.8,
        'text-opacity': 0.92,
      },
    }
  })
}

function profileZoomOpacity(
  profileStarts: ReadonlyArray<readonly [string, number]>,
  opacity: number,
) {
  const fadeDuration = 0.2
  const stopZooms = [
    ...new Set(
      profileStarts.flatMap(([, start]) => [
        Number(start.toFixed(2)),
        Number(Math.min(8, start + fadeDuration).toFixed(2)),
      ]),
    ),
  ].sort((left, right) => left - right)
  if ((stopZooms[stopZooms.length - 1] ?? 0) < 8) stopZooms.push(8)
  const stops = stopZooms.flatMap((zoom) => {
    const visibleProfiles = profileStarts
      .filter(([, start]) => zoom + 1e-9 >= Math.min(8, start + fadeDuration))
      .map(([profile]) => profile)
    return [
      zoom,
      ['case', ['in', ['get', 'detail_profile'], ['literal', visibleProfiles]], opacity, 0],
    ]
  })
  return ['interpolate', ['linear'], ['zoom'], ...stops]
}

function boundaryLayer(
  id: string,
  sourceLayer: string,
  minzoom: number,
  color: string,
  stops: number[],
  opacity: unknown,
  filter?: unknown,
  maxzoom?: number,
  lineCap = 'round',
): StyleLayer {
  return {
    id,
    type: 'line',
    source: SOURCE_ID,
    'source-layer': sourceLayer,
    minzoom,
    ...(maxzoom != null ? { maxzoom } : {}),
    ...(filter ? { filter } : {}),
    layout: { 'line-cap': lineCap, 'line-join': 'round' },
    paint: {
      'line-color': color,
      'line-width': ['interpolate', ['linear'], ['zoom'], ...stops],
      'line-opacity': opacity,
    },
  }
}

function countryBoundaryFadeOpacity(
  opacity: number,
  visibleZoom: number,
  fadeStart = PREVIEW_COUNTRY_BOUNDARY_FADE_START,
) {
  return ['interpolate', ['linear'], ['zoom'], fadeStart, 0, visibleZoom, opacity]
}

type LabelOptions = {
  worldPriority?: boolean
  excludeWorldPriority?: boolean
  minArea?: number
  maxArea?: number
  minParentCountryArea?: number
  maxParentCountryArea?: number
  countryKeys?: string[]
  hasAdmin1?: boolean
  withoutAdmin1?: boolean
  avoidCompactCountryAnchor?: boolean
  medium?: boolean
  halo?: number
  letterSpacing?: number
  allowOverlap?: boolean
  ignorePlacement?: boolean
  textOffset?: number[]
  textAnchor?: string
  persistToMax?: boolean
}

function controlledLabelLayer(
  id: string,
  level: 'country' | 'admin1' | 'city',
  minzoom: number,
  maxzoom: number,
  sizeStops: number[],
  color: string,
  padding: number,
  textField: unknown,
  options: LabelOptions = {},
): StyleLayer {
  const filters: unknown[] = [
    ['==', ['get', 'level'], level],
    ['!=', ['get', 'is_special'], true],
  ]
  if (level === 'country') filters.push(['!=', ['get', 'suppress_country_label'], true])
  if (options.worldPriority) filters.push(['==', ['get', 'world_priority'], true])
  if (options.excludeWorldPriority) filters.push(['!=', ['get', 'world_priority'], true])
  if (options.minArea != null) filters.push(['>=', ['get', 'area'], options.minArea])
  if (options.maxArea != null) filters.push(['<', ['get', 'area'], options.maxArea])
  if (options.minParentCountryArea != null) {
    filters.push(['>=', ['get', 'parent_country_area'], options.minParentCountryArea])
  }
  if (options.maxParentCountryArea != null) {
    filters.push(['<', ['get', 'parent_country_area'], options.maxParentCountryArea])
  }
  if (options.countryKeys) {
    filters.push(['in', ['get', 'country_key'], ['literal', options.countryKeys]])
  }
  if (options.hasAdmin1) filters.push(['==', ['get', 'has_admin1'], true])
  if (options.withoutAdmin1) filters.push(['!=', ['get', 'has_admin1'], true])
  if (options.avoidCompactCountryAnchor) {
    filters.push(['!=', ['get', 'near_compact_country_label'], true])
  }
  return {
    id,
    type: 'symbol',
    source: SOURCE_ID,
    'source-layer': controlledLabelSourceLayer(level),
    minzoom,
    maxzoom,
    filter: ['all', ...filters],
    layout: {
      'text-field': textField,
      'text-font': ['Noto Sans Medium'],
      'text-size':
        level === 'country'
          ? countryStaticTextSizeExpression()
          : ['interpolate', ['linear'], ['zoom'], ...scaledTextStops(sizeStops)],
      'text-allow-overlap': options.allowOverlap ?? false,
      'text-ignore-placement': options.ignorePlacement ?? false,
      'text-padding': padding,
      'symbol-sort-key': ['get', 'priority'],
      'text-letter-spacing': options.letterSpacing ?? 0,
      ...(options.textOffset ? { 'text-offset': options.textOffset } : {}),
      ...(options.textAnchor ? { 'text-anchor': options.textAnchor } : {}),
      'text-max-width': ['case', ['==', ['get', 'is_cjk'], true], 8, 12],
      'text-line-height': 1.1,
    },
    paint: {
      'text-color': color,
      'text-halo-color': 'rgba(255,255,255,.97)',
      'text-halo-width': 1.8,
      'text-opacity': smoothLabelOpacity(minzoom, maxzoom, options.persistToMax),
    },
  }
}

function controlledLabelSourceLayer(level: 'country' | 'admin1' | 'city') {
  if (level === 'country') return 'preview_country_labels'
  if (level === 'admin1') return 'preview_admin1_labels'
  return 'preview_city_labels'
}

function admin2LabelLayer(
  id: string,
  minzoom: number,
  filter: unknown,
  sizeStops: number[],
  padding: number,
  opacity: number,
  locale: PreviewMapLocale,
): StyleLayer {
  return {
    id,
    type: 'symbol',
    source: SOURCE_ID,
    'source-layer': 'admin2_labels',
    minzoom,
    maxzoom: 8.01,
    filter,
    layout: {
      'text-field':
        locale === 'en'
          ? ['coalesce', ['get', 'source_name'], ['get', 'display_name'], '']
          : ['coalesce', ['get', 'display_name'], ['get', 'source_name'], ''],
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], ...scaledTextStops(sizeStops)],
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-padding': padding,
      'symbol-sort-key': ['coalesce', ['get', 'priority'], 0],
      'text-max-width': 8,
      'text-line-height': 1.08,
    },
    paint: {
      'text-color': '#7a878f',
      'text-halo-color': 'rgba(255,255,255,.98)',
      'text-halo-width': 1.45,
      'text-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        minzoom,
        0,
        Math.min(8, minzoom + 0.3),
        opacity,
        8,
        opacity,
      ],
    },
  }
}

function globalAdmin2FallbackLabelLayer(locale: PreviewMapLocale): StyleLayer {
  return {
    id: 'international-admin2-fallback-labels',
    type: 'symbol',
    source: SOURCE_ID,
    'source-layer': 'preview_global_admin2_fallback_labels',
    minzoom: 6.45,
    maxzoom: 8.01,
    layout: {
      'text-field':
        locale === 'en'
          ? ['coalesce', ['get', 'display_name_en'], ['get', 'display_name'], '']
          : ['coalesce', ['get', 'display_name_zh'], ['get', 'display_name'], ''],
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], ...scaledTextStops([6.45, 8.2, 8, 9.7])],
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-padding': 24,
      'symbol-sort-key': ['coalesce', ['get', 'priority'], 0],
      'text-max-width': 8,
      'text-line-height': 1.08,
    },
    paint: {
      'text-color': '#7a878f',
      'text-halo-color': 'rgba(255,255,255,.98)',
      'text-halo-width': 1.45,
      'text-opacity': ['interpolate', ['linear'], ['zoom'], 6.45, 0, 6.75, 0.72, 8, 0.72],
    },
  }
}

function controlledNameExpression(locale: PreviewMapLocale) {
  return locale === 'en'
    ? [
        'match',
        ['get', 'geo_key'],
        'china|hongkong',
        'Hong Kong',
        'china|aomen',
        'Macao',
        ['coalesce', ['get', 'display_name_en'], ['get', 'display_name'], ''],
      ]
    : [
        'coalesce',
        ['get', 'display_name'],
        ['get', 'display_name_zh'],
        ['get', 'display_name_en'],
        '',
      ]
}

function countryStaticTextSizeExpression() {
  const areaBaseSize = [
    'step',
    ['to-number', ['coalesce', ['get', 'area'], 0]],
    9 * COUNTRY_LABEL_SCALE,
    8,
    10.5 * COUNTRY_LABEL_SCALE,
    45,
    12 * COUNTRY_LABEL_SCALE,
    180,
    13 * COUNTRY_LABEL_SCALE,
  ]
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    PREVIEW_MAP_MIN_ZOOM,
    areaBaseSize,
    PREVIEW_COUNTRY_LEVEL_END,
    ['+', areaBaseSize, COUNTRY_LABEL_ZOOM_GROWTH],
  ]
}

function presentationStaticTextSizeExpression(level: 'adm1' | 'adm2') {
  return level === 'adm1'
    ? [
        'interpolate',
        ['linear'],
        ['zoom'],
        PREVIEW_COUNTRY_LEVEL_END,
        ADMIN1_LABEL_MIN_SIZE,
        PREVIEW_MAP_MAX_ZOOM,
        ADMIN1_LABEL_MAX_SIZE,
      ]
    : [
        'interpolate',
        ['linear'],
        ['zoom'],
        CITY_LABEL_MIN_ZOOM,
        CITY_LABEL_MIN_SIZE,
        PREVIEW_MAP_MAX_ZOOM,
        CITY_LABEL_MAX_SIZE,
      ]
}

function scaledTextStops(stops: number[]) {
  return stops.map((value, index) =>
    index % 2 ? Number((value * COUNTRY_LABEL_SCALE).toFixed(3)) : value,
  )
}

function smoothLabelOpacity(minzoom: number, maxzoom: number, persistToMax = false) {
  const fadeInEnd = Math.min(maxzoom - 0.01, minzoom + 0.28)
  if (persistToMax) {
    return ['interpolate', ['linear'], ['zoom'], minzoom, 0, fadeInEnd, 0.95, maxzoom, 0.95]
  }
  const fadeOutStart = Math.max(fadeInEnd, maxzoom - 0.35)
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    minzoom,
    0,
    fadeInEnd,
    0.95,
    fadeOutStart,
    0.95,
    maxzoom,
    0,
  ]
}

function isStyleLayer(layer: unknown): layer is StyleLayer {
  return typeof layer === 'object' && layer !== null && 'id' in layer
}
