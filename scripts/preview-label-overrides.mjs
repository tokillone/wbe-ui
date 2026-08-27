export const CONTROLLED_LABEL_POINT_OVERRIDES = new Map([
  [
    'country|vietnam',
    {
      coordinates: [107.85, 16],
      method: 'controlled-override',
    },
  ],
  [
    'admin1|china|hebei',
    {
      coordinates: [114.441325, 38.128893],
      method: 'province-capital-region-anchor',
      sourceGeoKey: 'china|hebei|shijiazhuang',
    },
  ],
])

export function applyControlledLabelPointOverrides(collection) {
  const applied = []
  const features = (collection.features ?? []).map((feature) => {
    const level = String(feature.properties?.level ?? '')
    const geoKey = String(feature.properties?.geo_key ?? '')
    const override = CONTROLLED_LABEL_POINT_OVERRIDES.get(`${level}|${geoKey}`)
    if (!override) return feature
    applied.push({
      level,
      geoKey,
      coordinates: [...override.coordinates],
      method: override.method,
      sourceGeoKey: override.sourceGeoKey ?? '',
    })
    return {
      ...feature,
      properties: {
        ...(feature.properties ?? {}),
        label_method: override.method,
        ...(override.sourceGeoKey ? { label_point_source_geo_key: override.sourceGeoKey } : {}),
      },
      geometry: { type: 'Point', coordinates: [...override.coordinates] },
    }
  })
  return {
    collection: { ...collection, features },
    applied,
  }
}
