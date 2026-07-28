import type { Icd11SankeyPath } from '../types/icd11Sankey'

const COLOR_START_HUE = 212
const GOLDEN_ANGLE = 137.508
const SATURATION_SEQUENCE = [40, 46, 36]
const LIGHTNESS_SEQUENCE = [50, 56, 45]

export const SANKEY_LEVEL2_FALLBACK_COLOR = '#7E8A98'

export function sankeyLevel2ColorKey(level1: string, level2: string) {
  return `${level1}::${level2}`
}

export function dynamicLevel2Color(index: number) {
  const normalizedIndex = Math.max(0, Math.floor(index))
  const hue = (COLOR_START_HUE + normalizedIndex * GOLDEN_ANGLE) % 360
  const toneIndex = normalizedIndex % SATURATION_SEQUENCE.length
  return hslToHex(hue, SATURATION_SEQUENCE[toneIndex] ?? 40, LIGHTNESS_SEQUENCE[toneIndex] ?? 50)
}

export function buildDynamicLevel2ColorMap(paths: Icd11SankeyPath[], primaryLevel1: string) {
  const groups = new Map<string, Map<string, number>>()
  for (const path of paths) {
    const level2Weights = groups.get(path.level1) ?? new Map<string, number>()
    level2Weights.set(path.level2, (level2Weights.get(path.level2) ?? 0) + Number(path.weight || 0))
    groups.set(path.level1, level2Weights)
  }

  const level1Weights = (level1: string) =>
    [...(groups.get(level1)?.values() ?? [])].reduce((sum, weight) => sum + weight, 0)
  const orderedLevel1 = [...groups.keys()].sort((a, b) => {
    if (a === primaryLevel1) return -1
    if (b === primaryLevel1) return 1
    return level1Weights(b) - level1Weights(a) || a.localeCompare(b, 'zh-Hans-CN')
  })

  const colors = new Map<string, string>()
  let colorIndex = 0
  for (const level1 of orderedLevel1) {
    const level2Entries = [...(groups.get(level1)?.entries() ?? [])].sort(
      ([nameA, weightA], [nameB, weightB]) =>
        weightB - weightA || nameA.localeCompare(nameB, 'zh-Hans-CN'),
    )
    for (const [level2] of level2Entries) {
      colors.set(sankeyLevel2ColorKey(level1, level2), dynamicLevel2Color(colorIndex))
      colorIndex += 1
    }
  }
  return colors
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const s = saturation / 100
  const l = lightness / 100
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const hueSection = hue / 60
  const x = chroma * (1 - Math.abs((hueSection % 2) - 1))
  const offset = l - chroma / 2
  let red = 0
  let green = 0
  let blue = 0

  if (hueSection < 1) [red, green] = [chroma, x]
  else if (hueSection < 2) [red, green] = [x, chroma]
  else if (hueSection < 3) [green, blue] = [chroma, x]
  else if (hueSection < 4) [green, blue] = [x, chroma]
  else if (hueSection < 5) [red, blue] = [x, chroma]
  else [red, blue] = [chroma, x]

  return `#${[red, green, blue]
    .map((value) =>
      Math.round((value + offset) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`.toUpperCase()
}
