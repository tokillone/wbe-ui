export const PREVIEW_REGION_POLYGON_SOURCE_LAYER = 'preview_region_polygons'

export const vectorRegionFillColorExpression = [
  'coalesce',
  ['feature-state', 'fillColor'],
  '#eef0f0',
] as const

export const vectorRegionFillOpacityExpression = [
  'case',
  ['boolean', ['feature-state', 'active'], false],
  ['coalesce', ['feature-state', 'fillOpacity'], 0],
  0,
] as const

export type ProgressiveFeatureState = {
  id: string
  state: Record<string, unknown>
}

export type ProgressiveStateOptions = {
  batchSize?: number
  budgetMs?: number
  isCurrent: () => boolean
  apply: (entry: ProgressiveFeatureState) => void
  onComplete?: () => void
}

type IdleDeadlineLike = { timeRemaining: () => number; didTimeout: boolean }

/**
 * Applies tile feature-state in short idle batches. A caller-owned revision
 * predicate cancels obsolete filter/zoom work before it can overwrite new data.
 */
export function scheduleProgressiveFeatureState(
  entries: ProgressiveFeatureState[],
  options: ProgressiveStateOptions,
) {
  const batchSize = options.batchSize ?? 32
  const budgetMs = options.budgetMs ?? 4
  let index = 0
  let cancelled = false
  let handle = 0

  const cancel = () => {
    cancelled = true
    if (typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(handle)
    } else {
      globalThis.cancelAnimationFrame(handle)
    }
  }

  const run = (deadline?: IdleDeadlineLike) => {
    if (cancelled || !options.isCurrent()) return
    const startedAt = performance.now()
    let applied = 0
    while (index < entries.length && applied < batchSize) {
      if (
        applied > 0 &&
        performance.now() - startedAt >= budgetMs &&
        (!deadline || deadline.timeRemaining() <= 0)
      ) {
        break
      }
      const entry = entries[index]
      if (!entry) break
      options.apply(entry)
      index += 1
      applied += 1
    }
    if (index >= entries.length) {
      options.onComplete?.()
      return
    }
    schedule()
  }

  const schedule = () => {
    if (typeof window.requestIdleCallback === 'function') {
      handle = window.requestIdleCallback(run, { timeout: 48 })
    } else {
      handle = globalThis.requestAnimationFrame(() => run())
    }
  }

  schedule()
  return cancel
}
