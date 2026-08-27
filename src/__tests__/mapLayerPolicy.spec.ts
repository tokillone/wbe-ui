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

  it('keeps each business name paired with its bubble and excludes colliding PMTiles names', () => {
    expect(source).toContain('A business name and its bubble are one visual unit')
    expect(source).toContain('function applyPreviewBusinessLabelExclusions(')
    expect(source).toContain("['!', ['in', ['get', 'geo_key'], ['literal', excluded]]]")
    expect(source).toContain('buildPointCollection(activeMapLevel.value)')
    expect(source).not.toContain('? displayMapRegionRows(activeMapLevel.value)')
    expect(source).not.toContain(
      'setLayerVisibility([...PREVIEW_LABEL_LAYER_IDS_BY_LEVEL[activeMapLevel.value]], false)',
    )
    expect(source).not.toContain("viewLayers.labels && activeMapLevel.value === 'admin1'")
    expect(source).toContain('source: pointSourceId(level)')
    const labelLayer = source.slice(
      source.indexOf('function addPndlLabelLayer('),
      source.indexOf('function addBubbleImages('),
    )
    expect(labelLayer).toContain("'text-allow-overlap': false")
    expect(labelLayer).toContain("'text-ignore-placement': false")
    expect(source).toContain('map.queryRenderedFeatures(')
    expect(source).toContain('runtimeStaticLabelExclusions')
    expect(source).toContain("'text-optional': false")
    expect(source).not.toContain('map-point-labels-')
    expect(source).toContain('Map bubbles omitted because their paired names are missing')
  })

  it('keeps real city bubbles and paired labels through the exclusive Z8 upper bound', () => {
    expect(source).toContain('range.maxzoom = PREVIEW_MAP_MAX_ZOOM + 0.01')
    expect(source).toContain('maxzoom: PREVIEW_MAP_MAX_ZOOM + 0.01')
    expect(source).not.toContain("if (level === 'city' && zoom >= 7.85) return rows")
    expect(source).toContain("'text-size': businessLabelTextSizeExpression(level)")
    expect(source).toContain('labelBaseSize: labelBaseSize(level, boundaryArea)')
    expect(source).toContain('labelCountTier: labelCountTier(level, pointCount)')
    expect(source).toContain('labelScale: labelScaleForPointCount(level, pointCount)')
  })

  it('registers persistent province, city, and special-admin line layers', () => {
    expect(source).toContain("addGeoSource('china-city-boundary-lines')")
    expect(source).toContain("addGeoSource('china-special-admin-boundary-lines')")
    expect(source).not.toContain("'china-active-province-line'")
    expect(source).toContain("'china-city-line'")
    expect(source).toContain("'china-special-admin-line'")
    expect(source).toContain("activeMapLevel.value !== 'country'")
  })

  it('keeps GeoJSON parent boundaries visible at city level', () => {
    const fallbackVisibility = source.slice(
      source.indexOf("setLayerVisibility(['country-line']"),
      source.indexOf('applyHierarchyBoundaryWidths()'),
    )
    expect(fallbackVisibility).toContain(
      "viewLayers.boundaries && activeMapLevel.value !== 'country'",
    )
    const fallbackLayers = source.slice(
      source.indexOf('function addBoundaryLineLayers()'),
      source.indexOf('function addLineLayer('),
    )
    expect(fallbackLayers).not.toContain('CITY_BOUNDARY_MIN_ZOOM,\n  )')
    expect(fallbackLayers.indexOf("'china-city-line'")).toBeLessThan(
      fallbackLayers.indexOf("'china-province-line'"),
    )
    expect(fallbackLayers.indexOf("'china-province-line'")).toBeLessThan(
      fallbackLayers.indexOf("'country-line'"),
    )
  })

  it('removes location search UI while retaining the region index for labels and positioning', () => {
    expect(headerSource).toContain('<PlatformHeader active="map" />')
    expect(headerSource).not.toContain('location-search')
    expect(headerSource).not.toContain('searchQuery')
    expect(headerSource).not.toContain('selectResult')
    expect(headerSource).not.toContain('show-context')
    expect(headerSource).not.toContain('page-title')
    expect(headerSource).not.toContain('context-actions')
    expect(source).toContain('<MapPageHeader />')
    expect(source).not.toContain('@select-result')
    expect(source).not.toContain('isLanguageMenuOpen')
    expect(source).not.toContain('focusSearchResult')
    expect(source).toContain('void ensureRegionIndex().then(() => {')
    expect(source).toContain('Map labels and positioning fall back')
  })

  it('keeps Hong Kong and Macao labels visible at city zoom', () => {
    expect(source).toContain("'text-allow-overlap': id === 'china-special-admin-label'")
    expect(source).toContain("entry.geo_key === 'china|hongkong'")
    expect(source).toContain("entry.geo_key === 'china|aomen'")
    expect(source).toContain("return 'Hong Kong'")
    expect(source).toContain("return 'Macao'")
  })

  it('uses fill-only hover and selection in both vector and GeoJSON modes', () => {
    const selectionOpacity = source.slice(
      source.indexOf('function selectedRegionFillOpacityExpression()'),
      source.indexOf('function regionDataFillColorExpression()'),
    )
    expect(selectionOpacity).toContain('return 0.28')
    expect(source).toContain('fillOpacity: 0.16')
    expect(source).toContain('// Selected is added after hover so it always has visual priority.')
    expect(source).toContain(
      'const REGION_VECTOR_SOURCE_LAYER = PREVIEW_REGION_POLYGON_SOURCE_LAYER',
    )
    expect(source).not.toContain('preview_region_outlines')
    expect(source).not.toContain('preview_region_display_outlines')
    for (const layerId of [
      'region-data-line',
      'region-hover-line',
      'region-selected-line',
      'region-selected-halo',
      'preview-region-hover-line',
      'preview-region-selected-line',
    ]) {
      expect(source).not.toContain(`'${layerId}'`)
    }
  })

  it('uses one animation-frame hover query and continuous guarded world copies', () => {
    expect(source).toContain('renderWorldCopies: true')
    expect(source).toContain('map.setRenderWorldCopies(true)')
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
    expect(source).toContain('PREVIEW_BOUNDARY_LAYER_IDS.find((layerId) => map?.getLayer(layerId))')
    expect(source).not.toContain(
      'layers.find((item) => /^roads_|^pois|^places|^transit|^transport/i.test(item.id))',
    )
    expect(source).toContain('return hasPndl || statHasCoverage(stat) ? 1 : 0')
    expect(source).toContain('scheduleProgressiveFeatureState(entries')
    expect(source).toContain('batchSize: 32')
    expect(source).toContain('budgetMs: 4')
    expect(source).toContain("mapRenderPhase.value = 'preparing-next'")
  })

  it('declutters each bubble, count, and name as one screen-space unit', () => {
    expect(source).toContain('declutterScreenSpacePlacements(')
    expect(source).toContain('progressiveDeclutterGap(level, zoom)')
    expect(source).toContain('businessPointPlacementOptions(')
    expect(source).toContain('mapOverlayReservedBounds()')
    expect(source).toContain("placement: 'bottom'")
    expect(source).toContain("placement: 'top'")
    expect(source).toContain("placement: 'right'")
    expect(source).toContain("placement: 'left'")
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
