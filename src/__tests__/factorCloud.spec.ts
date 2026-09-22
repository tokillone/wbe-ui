import { describe, expect, it } from 'vitest'
import {
  buildFactorOrbit,
  FACTOR_ORBIT_DIRECTION,
  factorOrbitEdgeFade,
  factorOrbitFrontVisibility,
  factorOrbitLimit,
  factorOrbitVelocityStep,
  factorWordSize,
  factorWordSizeProgress,
  packCloudWords,
  prepareCloudWords,
  projectFactorOrbit,
} from '../utils/factorCloud'
const data = Array.from({ length: 64 }, (_, i) => ({
  name: `研究因子${i + 1}`,
  value: 64 - i,
  docs: 64 - i,
  category: 'drug',
  targetLabel: i % 2 ? '抗菌药' : '神经系统药物',
}))
describe('factor cloud evidence and placement', () => {
  it('uses document counts for monotonic font sizes and stable category colors', () => {
    const words = prepareCloudWords(data)
    expect(words[0]?.size).toBe(38)
    expect(words[63]?.size).toBe(19)
    expect(words[0]?.color).toBe(words[2]?.color)
    expect(prepareCloudWords([...data].reverse())[0]).toEqual(words[0])
    expect(prepareCloudWords([])).toEqual([])
    expect(prepareCloudWords([{ name: 'no evidence', value: 0, category: 'drug' }])).toEqual([])
  })
  it('uses a bounded logarithmic scale rather than a linear count-to-size mapping', () => {
    expect(factorWordSize(1, 1, 1000)).toBe(19)
    expect(factorWordSize(1000, 1, 1000)).toBe(38)
    expect(factorWordSize(500, 1, 1000)).toBeGreaterThan(35)
    expect(factorWordSize(10, 10, 10)).toBe(26)
    expect(factorWordSizeProgress(19)).toBe(0)
    expect(factorWordSizeProgress(38)).toBe(1)
    expect(factorWordSize(50, 1, 1000)).toBeLessThan(factorWordSize(500, 1, 1000))
  })
  it('builds deterministic normalized ellipsoid points with responsive limits', () => {
    const words = prepareCloudWords(data)
    const orbit = buildFactorOrbit(words, factorOrbitLimit(1512))

    expect(factorOrbitLimit(1512)).toBe(64)
    expect(factorOrbitLimit(1200)).toBe(64)
    expect(factorOrbitLimit(1100)).toBe(64)
    expect(factorOrbitLimit(900)).toBe(48)
    expect(factorOrbitLimit(390)).toBe(28)
    expect(orbit).toHaveLength(64)
    expect(buildFactorOrbit(words, 64)).toEqual(orbit)
    expect(FACTOR_ORBIT_DIRECTION).toBe(-1)
    expect(orbit[0]?.word.name).toBe(words[0]?.name)
    for (const point of orbit) {
      expect(point.x * point.x + point.y * point.y + point.z * point.z).toBeCloseTo(1, 8)
    }
    expect(buildFactorOrbit(words.slice(0, 1), 32)).toEqual([
      expect.objectContaining({ x: 0, y: 0, z: 1 }),
    ])
  })
  it('keeps depth scaling subtle and fades monotonically near both edges', () => {
    const front = projectFactorOrbit({ x: 0, y: 0, z: 1 }, 0)
    const back = projectFactorOrbit({ x: 0, y: 0, z: -1 }, 0)
    const edge = projectFactorOrbit({ x: 1, y: 0, z: 0 }, 0)

    expect(front.scale).toBe(1.08)
    expect(back.scale).toBe(0.92)
    expect(front.opacity).toBe(1)
    expect(back.opacity).toBe(0)
    expect(back.frontVisibility).toBe(0)
    expect(factorOrbitFrontVisibility(0.44)).toBe(0)
    expect(factorOrbitFrontVisibility(0.5)).toBeGreaterThan(0)
    expect(factorOrbitFrontVisibility(0.5)).toBeLessThan(factorOrbitFrontVisibility(0.6))
    expect(factorOrbitFrontVisibility(0.64)).toBe(1)
    expect(edge.edgeFade).toBe(0)
    expect(factorOrbitEdgeFade(0)).toBe(1)
    expect(factorOrbitEdgeFade(0.72)).toBe(1)
    expect(factorOrbitEdgeFade(0.86)).toBeGreaterThan(0)
    expect(factorOrbitEdgeFade(0.86)).toBeLessThan(1)
    expect(factorOrbitEdgeFade(0.94)).toBeLessThan(factorOrbitEdgeFade(0.86))
    expect(factorOrbitEdgeFade(-0.94)).toBe(factorOrbitEdgeFade(0.94))
    expect(factorOrbitEdgeFade(1)).toBe(0)
  })
  it('eases rotation velocity monotonically when pausing and resuming', () => {
    const slowing = factorOrbitVelocityStep(1, 0, 0.016, 0.26)
    const slower = factorOrbitVelocityStep(slowing, 0, 0.016, 0.26)
    const accelerating = factorOrbitVelocityStep(0, 1, 0.016, 0.42)

    expect(slowing).toBeGreaterThan(0)
    expect(slowing).toBeLessThan(1)
    expect(slower).toBeLessThan(slowing)
    expect(accelerating).toBeGreaterThan(0)
    expect(accelerating).toBeLessThan(1)
  })
  it('keeps desktop and mobile labels inside the field without overlap', () => {
    for (const [width, limit] of [
      [1180, 48],
      [340, 12],
    ]) {
      const slots = packCloudWords(
        prepareCloudWords(data),
        width!,
        390,
        limit!,
        (word) => [...word.name].length * word.size,
      )
      expect(slots.length).toBeGreaterThan(0)
      expect(slots.length).toBeLessThanOrEqual(limit!)
      for (const [index, slot] of slots.entries()) {
        expect(slot.x).toBeGreaterThanOrEqual(0)
        expect(slot.x + slot.width).toBeLessThanOrEqual(width!)
        expect(slot.y + slot.height).toBeLessThanOrEqual(390)
        for (const other of slots.slice(index + 1)) {
          expect(
            slot.x < other.x + other.width &&
              slot.x + slot.width > other.x &&
              slot.y < other.y + other.height &&
              slot.y + slot.height > other.y,
          ).toBe(false)
        }
      }
    }
  })
})
