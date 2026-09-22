export interface FactorKeyword {
  name: string
  value: number
  docs?: number
  rows?: number
  category: string
  targetLabel?: string
  subcategories?: string[]
}

export type FactorCloudState = 'loading' | 'incompatible' | 'error' | 'empty' | 'ready'

export interface CloudWord extends FactorKeyword {
  size: number
  color: string
}
export interface CloudSlot {
  word: CloudWord
  x: number
  y: number
  width: number
  height: number
}

export interface FactorOrbitPoint {
  word: CloudWord
  x: number
  y: number
  z: number
  longitude: number
}

export interface FactorOrbitProjection {
  x: number
  y: number
  depth: number
  scale: number
  edgeFade: number
  frontVisibility: number
  opacity: number
}
const COLORS = [
  '#18578a',
  '#25766c',
  '#82528b',
  '#97652e',
  '#526698',
  '#2a7b8e',
  '#806040',
  '#576e3b',
]
export const FACTOR_WORD_MIN_SIZE = 19
export const FACTOR_WORD_MAX_SIZE = 38
export const FACTOR_WORD_SINGLE_SIZE = 26
export const FACTOR_ORBIT_WIDE_LIMIT = 64
export const FACTOR_ORBIT_DESKTOP_LIMIT = 64
export const FACTOR_ORBIT_TABLET_LIMIT = 48
export const FACTOR_ORBIT_MOBILE_LIMIT = 28
export const FACTOR_ORBIT_WIDE_BREAKPOINT = 1180
export const FACTOR_ORBIT_DIRECTION = -1
export const FACTOR_ORBIT_MIN_SCALE = 0.92
export const FACTOR_ORBIT_MAX_SCALE = 1.08
export const FACTOR_ORBIT_EDGE_FADE_START = 0.72

const FACTOR_ORBIT_GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

export function factorHash(value: string) {
  return [...value].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0)
}
export function factorWordSize(value: number, min: number, max: number) {
  if (max <= min) return FACTOR_WORD_SINGLE_SIZE
  const logMin = Math.log1p(Math.max(0, min))
  const logRange = Math.log1p(Math.max(0, max)) - logMin
  const normalized = logRange > 0 ? (Math.log1p(Math.max(0, value)) - logMin) / logRange : 0.5
  const eased = Math.pow(Math.max(0, Math.min(1, normalized)), 1.25)
  return FACTOR_WORD_MIN_SIZE + eased * (FACTOR_WORD_MAX_SIZE - FACTOR_WORD_MIN_SIZE)
}
export function factorWordSizeProgress(size: number) {
  const range = FACTOR_WORD_MAX_SIZE - FACTOR_WORD_MIN_SIZE
  return Math.max(0, Math.min(1, (size - FACTOR_WORD_MIN_SIZE) / range))
}
export function prepareCloudWords(items: FactorKeyword[]): CloudWord[] {
  const unique = [
    ...new Map(
      items
        .filter(
          (item) =>
            item.name?.trim() &&
            Number.isFinite(item.docs ?? item.value) &&
            (item.docs ?? item.value) > 0,
        )
        .map((item) => [item.name, item]),
    ).values(),
  ]
    .sort(
      (a, b) => (b.docs ?? b.value) - (a.docs ?? a.value) || a.name.localeCompare(b.name, 'zh-CN'),
    )
    .slice(0, 64)
  const values = unique.map((item) => item.docs ?? item.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  return unique.map((item) => ({
    ...item,
    size: factorWordSize(item.docs ?? item.value, min, max),
    color: COLORS[factorHash(item.targetLabel || item.category) % COLORS.length]!,
  }))
}

export function factorOrbitLimit(viewportWidth: number) {
  if (viewportWidth < 720) return FACTOR_ORBIT_MOBILE_LIMIT
  if (viewportWidth < 1024) return FACTOR_ORBIT_TABLET_LIMIT
  if (viewportWidth >= FACTOR_ORBIT_WIDE_BREAKPOINT) return FACTOR_ORBIT_WIDE_LIMIT
  return FACTOR_ORBIT_DESKTOP_LIMIT
}

export function buildFactorOrbit(words: CloudWord[], limit: number): FactorOrbitPoint[] {
  const selectedWords = words.slice(0, Math.max(0, limit))
  const count = selectedWords.length
  if (!count) return []
  if (count === 1) {
    return [{ word: selectedWords[0]!, x: 0, y: 0, z: 1, longitude: Math.PI / 2 }]
  }

  const points = Array.from({ length: count }, (_, index) => {
    const y = 1 - (2 * (index + 0.5)) / count
    const radius = Math.sqrt(Math.max(0, 1 - y * y))
    const phase = ((factorHash(selectedWords[index]!.name) % 997) / 997 - 0.5) * 0.16
    const longitude = index * FACTOR_ORBIT_GOLDEN_ANGLE + phase
    return {
      x: Math.cos(longitude) * radius,
      y,
      z: Math.sin(longitude) * radius,
      longitude,
    }
  }).sort((a, b) => Math.abs(a.y) - Math.abs(b.y) || b.z - a.z)

  return selectedWords.map((word, index) => ({ word, ...points[index]! }))
}

export function factorOrbitEdgeFade(normalizedX: number) {
  const edgeProgress = Math.max(
    0,
    Math.min(
      1,
      (Math.abs(normalizedX) - FACTOR_ORBIT_EDGE_FADE_START) / (1 - FACTOR_ORBIT_EDGE_FADE_START),
    ),
  )
  const smoothProgress = edgeProgress * edgeProgress * (3 - 2 * edgeProgress)
  return 1 - smoothProgress
}

export function factorOrbitFrontVisibility(depth: number) {
  const frontProgress = Math.max(0, Math.min(1, (depth - 0.44) / 0.2))
  return frontProgress * frontProgress * (3 - 2 * frontProgress)
}

export function factorOrbitVelocityStep(
  currentVelocity: number,
  targetVelocity: number,
  deltaSeconds: number,
  responseSeconds: number,
) {
  if (deltaSeconds <= 0 || responseSeconds <= 0) return currentVelocity
  const response = 1 - Math.exp(-deltaSeconds / responseSeconds)
  return currentVelocity + (targetVelocity - currentVelocity) * response
}

export function projectFactorOrbit(
  point: Pick<FactorOrbitPoint, 'x' | 'y' | 'z'>,
  rotation: number,
): FactorOrbitProjection {
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)
  const x = point.x * cosine + point.z * sine
  const z = -point.x * sine + point.z * cosine
  const depth = Math.max(0, Math.min(1, (z + 1) / 2))
  const scale = FACTOR_ORBIT_MIN_SCALE + depth * (FACTOR_ORBIT_MAX_SCALE - FACTOR_ORBIT_MIN_SCALE)
  const edgeFade = factorOrbitEdgeFade(x)
  const frontVisibility = factorOrbitFrontVisibility(depth)
  const depthOpacity = 0.62 + depth * 0.38
  return {
    x,
    y: point.y,
    depth,
    scale,
    edgeFade,
    frontVisibility,
    opacity: depthOpacity * edgeFade * frontVisibility,
  }
}
export function packCloudWords(
  words: CloudWord[],
  width: number,
  height: number,
  limit: number,
  measure: (word: CloudWord) => number,
): CloudSlot[] {
  const placed: CloudSlot[] = []
  if (width < 30) return placed
  for (const word of words) {
    if (placed.length >= limit) break
    const w = Math.ceil(measure(word)) + 18
    const h = Math.ceil(word.size * 1.3) + 14
    if (w > width - 20) continue
    const candidates: Array<{ x: number; y: number; score: number }> = []
    const offset = factorHash(word.name) % 29
    for (let y = 12; y + h < height - 10; y += 12) {
      for (let x = 10; x + w < width - 10; x += 12) {
        const dx = (x + w / 2 - width / 2) / width
        const dy = (y + h / 2 - height / 2) / height
        candidates.push({
          x,
          y,
          score: dx * dx + dy * dy * 0.7 + ((x * 7 + y * 11 + offset) % 41) * 0.0003,
        })
      }
    }
    candidates.sort((a, b) => a.score - b.score)
    const position = candidates.find(
      ({ x, y }) =>
        !placed.some(
          (slot) =>
            x < slot.x + slot.width + 8 &&
            x + w + 8 > slot.x &&
            y < slot.y + slot.height + 6 &&
            y + h + 6 > slot.y,
        ),
    )
    if (position) placed.push({ word, x: position.x, y: position.y, width: w, height: h })
  }
  return placed
}
