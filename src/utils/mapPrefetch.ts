let mapExperiencePromise: Promise<unknown> | null = null
let scheduledHandle: number | null = null

type NetworkInformationLike = {
  saveData?: boolean
  effectiveType?: string
}

export function allowsMapExperiencePrefetch(navigatorLike: Navigator = navigator) {
  const connection = (
    navigatorLike as Navigator & { connection?: NetworkInformationLike }
  ).connection
  if (connection?.saveData) return false
  return !['slow-2g', '2g'].includes(String(connection?.effectiveType ?? '').toLowerCase())
}

export function preloadMapExperience() {
  if (!mapExperiencePromise) {
    mapExperiencePromise = Promise.allSettled([
      import('../views/MapVisualizationView.vue'),
      import('maplibre-gl'),
      import('pmtiles'),
      import('@protomaps/basemaps'),
    ])
  }
  return mapExperiencePromise
}

export function scheduleMapExperiencePrefetch() {
  if (!import.meta.env.PROD || scheduledHandle != null || !allowsMapExperiencePrefetch()) return
  const run = () => {
    scheduledHandle = null
    void preloadMapExperience()
  }
  if (typeof window.requestIdleCallback === 'function') {
    scheduledHandle = window.requestIdleCallback(run, { timeout: 2400 })
  } else {
    scheduledHandle = window.setTimeout(run, 1600)
  }
}

export function cancelScheduledMapExperiencePrefetch() {
  if (scheduledHandle == null) return
  if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(scheduledHandle)
  else window.clearTimeout(scheduledHandle)
  scheduledHandle = null
}
