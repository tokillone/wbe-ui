import { describe, expect, it } from 'vitest'

import {
  nearestWorldCopyLongitude,
  nextMapDisplayLevel,
  wrappedWorldMinZoom,
} from '../utils/mapRuntime'

describe('map runtime hierarchy and wrapping', () => {
  it('keeps the city level inside the down-zoom hysteresis band', () => {
    expect(nextMapDisplayLevel('admin1', 6.59)).toBe('admin1')
    expect(nextMapDisplayLevel('admin1', 6.6)).toBe('city')
    expect(nextMapDisplayLevel('city', 6.5)).toBe('city')
    expect(nextMapDisplayLevel('city', 6.45)).toBe('admin1')
  })

  it('guards a 2048px viewport against simultaneous world copies', () => {
    expect(wrappedWorldMinZoom(2048)).toBeCloseTo(Math.log2((2048 + 320) / 512), 6)
    expect(wrappedWorldMinZoom(320)).toBe(1.1)
  })

  it('chooses the nearest longitude copy around the antimeridian', () => {
    expect(nearestWorldCopyLongitude(-170, 175)).toBe(190)
    expect(nearestWorldCopyLongitude(170, -175)).toBe(-190)
    expect(nearestWorldCopyLongitude(104, 110)).toBe(104)
  })
})
