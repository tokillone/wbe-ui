export const CONTROLLED_LABEL_POINT_OVERRIDES = new Map([
  ['country|vietnam', [107.85, 16]],
])

export function applyControlledLabelPointOverrides(collection) {
  const applied = []
  const features = (collection.features ?? []).map((feature) => {
    const level = String(feature.properties?.level ?? '')
    const geoKey = String(feature.properties?.geo_key ?? '')
    const override = CONTROLLED_LABEL_POINT_OVERRIDES.get(`${level}|${geoKey}`)
    if (!override) return feature
    applied.push({ level, geoKey, coordinates: [...override] })
    return {
      ...feature,
      properties: {
        ...(feature.properties ?? {}),
        label_method: 'controlled-override',
      },
      geometry: { type: 'Point', coordinates: [...override] },
    }
  })
  return {
    collection: { ...collection, features },
    applied,
  }
}
