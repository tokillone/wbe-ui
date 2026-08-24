import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/views/MapVisualizationView.vue'), 'utf8')
const headerSource = readFileSync(
  resolve(process.cwd(), 'src/components/map/MapPageHeader.vue'),
  'utf8',
)
describe('map rendering layer policy', () => {
  it('uses the preview composite as the only visual PMTiles and keeps GeoJSON interaction data', () => {
    expect(source).toContain('const USE_LOCAL_PM_TILES_BASEMAP = true')
    expect(source).toContain("'/tiles/wbe-preview-composite.pmtiles'")
    expect(source).not.toContain('VITE_REGION_PM_TILES_URL')
    expect(source).not.toContain("'/tiles/wbe-regions.pmtiles'")
    expect(source).toContain('layers: basemapConfig.layers')
    expect(source).toContain('buildPreviewBasemapLayers(layers, locale.value)')
    expect(source).toContain("countries: '/geo/render/world-countries.geojson'")
    expect(source).toContain("admin1: '/geo/render/world-admin1.geojson'")
    expect(source).toContain("chinaCities: '/geo/render/china-cities.geojson'")
    expect(source).toContain("const FLAT_BACKGROUND_COLOR = '#d7e0e4'")
    expect(source).toContain("addBaseFillLayer('country-land', 'country-boundaries', 0, 1)")
    expect(source).toContain("if (basemapMode === 'geojson') addBoundaryLineLayers()")
  })

  it('anchors country and China province bubbles to cartographic label points', () => {
    const representativeCoordinates = source.slice(
      source.indexOf('function representativeCoordinates('),
      source.indexOf('function representativeBoundaryCenter('),
    )
    expect(
      representativeCoordinates.indexOf("if (row.level === 'country' && feature)"),
    ).toBeGreaterThan(-1)
    expect(representativeCoordinates).toContain(
      "if (row.level === 'admin1' && countryGroupKey(row) === 'china' && feature)",
    )
    expect(representativeCoordinates).toContain(
      'const provinceAnchor = [indexedLabelPoint, geometryLabelPoint, indexedCenter]',
    )
    expect(representativeCoordinates.indexOf('indexedLabelPoint')).toBeLessThan(
      representativeCoordinates.indexOf('suppliedPoint.every'),
    )
    expect(source).toContain("'icon-size': bubbleVisualScaleExpression()")
    expect(source).toContain('function isDenseEuropeBubblePoint(')
    expect(source).toContain('bubbleTextScaleForVisualScale(bubbleScale)')
  })

  it('moves every bubble visual above its administrative label', () => {
    expect(source).toContain('const BUBBLE_LABEL_CLEARANCE_PX = 10')
    expect(source).toContain('bubblePresentationProperties(')
    expect(source).toContain("'icon-offset': bubbleIconOffsetExpression()")
    expect(source).toContain("'text-offset': bubbleTextOffsetExpression()")
    expect(source).toContain('bubbleOffsetKey: bubbleOffsetKey(')
    expect(source).not.toContain('bubbleIconOffset: [')
    expect(source).not.toContain('bubbleTextOffset: [')
    expect(source).toContain("'icon-image': ['get', 'bubbleRingImage']")
    expect(source).toContain("'icon-image': ['get', 'bubbleHeatImage']")
    expect(source).not.toContain("pndlLayerId(level, 'bubbles')")
  })

  it('shows composite boundaries while suppressing ordinary GeoJSON outlines', () => {
    expect(source).toContain('setLayerVisibility([...PREVIEW_BOUNDARY_LAYER_IDS]')
    expect(source).toContain('setLayerVisibility([...BOUNDARY_LAYER_IDS], false)')
    expect(source).toContain("setLayerVisibility(['boundaries_country', 'boundaries'], false)")
  })

  it('keeps each business name paired with its bubble and excludes only matching PMTiles names', () => {
    expect(source).toContain('A business name and its bubble are one visual unit')
    expect(source).toContain('function applyPreviewBusinessLabelExclusions(')
    expect(source).toContain("['!', ['in', ['get', 'geo_key'], ['literal', excluded]]]")
    expect(source).toContain('buildPointCollection(activeMapLevel.value).features')
    expect(source).not.toContain('? displayMapRegionRows(activeMapLevel.value)')
    expect(source).not.toContain(
      'setLayerVisibility([...PREVIEW_LABEL_LAYER_IDS_BY_LEVEL[activeMapLevel.value]], false)',
    )
    expect(source).not.toContain('viewLayers.labels && activeMapLevel.value === \'admin1\'')
    expect(source).toContain('source: pointSourceId(level)')
    expect(source).toContain("'text-allow-overlap': true")
    expect(source).toContain("'text-ignore-placement': true")
    expect(source).toContain("'text-optional': false")
    expect(source).not.toContain('map-point-labels-')
    expect(source).toContain('Map bubbles omitted because their paired names are missing')
  })

  it('keeps real city bubbles and paired labels through the exclusive Z8 upper bound', () => {
    expect(source).toContain('range.maxzoom = PREVIEW_MAP_MAX_ZOOM + 0.01')
    expect(source).toContain('maxzoom: PREVIEW_MAP_MAX_ZOOM + 0.01')
    expect(source).toContain("if (level === 'city' && zoom >= 7.85) return rows")
    expect(source).toContain("'text-size': businessLabelTextSizeExpression(level)")
    expect(source).toContain('labelBaseSize: labelBaseSize(level, boundaryArea)')
    expect(source).toContain('labelCountTier: labelCountTier(level, pointCount)')
    expect(source).toContain('labelScale: labelScaleForPointCount(level, pointCount)')
  })

  it('registers persistent province, city, and special-admin line layers', () => {
    expect(source).toContain("addGeoSource('china-city-boundary-lines')")
    expect(source).toContain("addGeoSource('china-active-province-boundary-lines')")
    expect(source).toContain("addGeoSource('china-special-admin-boundary-lines')")
    expect(source).toContain("'china-active-province-line'")
    expect(source).toContain("'china-city-line'")
    expect(source).toContain("'china-special-admin-line'")
  })

  it('keeps search result clicks out of the map canvas and does not open details', () => {
    expect(headerSource).toContain('@mousedown.prevent')
    expect(headerSource).toContain('@click.stop="emit(\'selectResult\', result)"')
    expect(source).toContain('@select-result="focusSearchResult"')
    const focusSource = source.slice(
      source.indexOf('function focusSearchResult('),
      source.indexOf('function searchZoomForLevel('),
    )
    expect(focusSource).toContain('setSelectedRegion(feature')
    expect(focusSource).not.toContain('openFeatureDetail')
    expect(focusSource).toContain('searchZoomForLevel(result.level, result.geoKey)')
  })

  it('keeps Hong Kong and Macao labels visible at city zoom', () => {
    expect(source).toContain("'text-allow-overlap': id === 'china-special-admin-label'")
    expect(source).toContain('if (SPECIAL_ADMIN_GEO_KEYS.has(geoKey)) return Math.min(7.4')
    expect(source).toContain("'china|hongkong': ['香港', 'Hong Kong', 'HongKong']")
    expect(source).toContain("'china|aomen': ['澳门', 'Macao', 'Macau', 'Aomen']")
  })

  it('keeps the original outline-only GeoJSON selection style', () => {
    const selectionOpacity = source.slice(
      source.indexOf('function selectedRegionFillOpacityExpression()'),
      source.indexOf('function regionDataLineOpacityExpression()'),
    )
    expect(selectionOpacity).toContain('return 0')
  })

  it('draws hover and selection outlines from the display-only composite layer', () => {
    expect(source).toContain(
      "const PREVIEW_REGION_OUTLINE_SOURCE_LAYER = 'preview_region_display_outlines'",
    )
    expect(source).toContain("id: 'preview-region-hover-line'")
    expect(source).toContain("id: 'preview-region-selected-line'")
    expect(source).toContain("id: 'preview-region-selected-halo'")
    expect(source).toContain("source: 'protomaps'")
    expect(source).toContain("[PREVIEW_REGION_OUTLINE_SOURCE_LAYER]: 'region_id'")
    expect(source).toContain("['feature-state', 'selected']")
    expect(source).toContain("['feature-state', 'hover']")
    expect(source).toContain('updatePreviewRegionOutlineLevelFilters()')
    expect(source).not.toContain('setPreviewRegionOutlineFilter(')
    expect(source).toContain("basemapMode === 'geojson' && viewLayers.boundaries")
  })

  it('uses one animation-frame hover query and continuous guarded world copies', () => {
    expect(source).toContain('renderWorldCopies: true')
    expect(source).toContain('map.setRenderWorldCopies(flat)')
    expect(source).toContain('wrappedWorldMinZoom(width, FLAT_MIN_ZOOM)')
    expect(source).toContain('nearestWorldCopyCoordinate(targetCenter, map.getCenter().lng)')
    expect(source).toContain('function unifiedInteractiveFeaturesAtPoint(')
    expect(source).toContain('function sampleUnifiedHover(')
    expect(source).toContain('cameraInteractionActive() || unifiedHoverFrame != null')
    expect(source).toContain('map.project(map.unproject(pendingCursorPixel))')
    expect(source).toContain('scheduleUnifiedHoverAtCursor()')
    expect(source).not.toContain("map?.on('mousemove', layerId")
    expect(source).not.toContain('function handlePointMouseMove(')
  })

  it('uses composite polygon tiles and chunked feature state for business fills', () => {
    expect(source).toContain("const REGION_VECTOR_SOURCE_ID = 'protomaps'")
    expect(source).toContain('PREVIEW_REGION_POLYGON_SOURCE_LAYER')
    expect(source).toContain('scheduleProgressiveFeatureState(entries')
    expect(source).toContain('batchSize: 32')
    expect(source).toContain('budgetMs: 4')
    expect(source).toContain("mapRenderPhase.value = 'preparing-next'")
  })

  it('declutters each bubble, count, and name as one screen-space unit', () => {
    expect(source).toContain('declutterScreenSpaceCandidates(')
    expect(source).toContain('progressiveDeclutterGap(level, zoom)')
    expect(source).toContain('approximateBusinessLabelWidth(')
    expect(source).toContain('businessLabelSizeAtZoom(')
    expect(source).toContain('forceVisible: Boolean(')
    expect(source).toContain(
      "console.warn('Map bubbles omitted because their paired names are missing.'",
    )
  })

  it('removes only the Hong Kong business selection ring', () => {
    expect(source).toContain("filter: ['!=', ['get', 'geoKey'], 'china|hongkong']")
    expect(source).toContain("id: 'pndl-special-admin-point-labels'")
    expect(source).toContain("id: 'pndl-special-admin-bubble-icons'")
  })

  it('uses only the cleaned country polygon as the land fill', () => {
    const setup = source.slice(
      source.indexOf('function addMapSourcesAndLayers()'),
      source.indexOf('function addGeoSource('),
    )
    expect(setup).toContain("if (basemapMode === 'geojson')")
    expect(setup).not.toContain("addGeoSource('admin1-boundaries')")
    expect(setup).not.toContain("addGeoSource('china-province-boundaries')")
    expect(setup).not.toContain("addGeoSource('china-city-boundaries')")
    expect(setup).not.toContain("addGeoSource('china-detailed-land')")
    expect(setup).toContain("addBaseFillLayer('country-land', 'country-boundaries'")
  })
})
