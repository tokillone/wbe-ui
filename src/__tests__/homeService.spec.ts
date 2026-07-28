import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearHomeOverviewRequestsForTest,
  fetchHomeOverview,
} from '../services/home'

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response
}

describe('home overview service', () => {
  beforeEach(() => {
    clearHomeOverviewRequestsForTest()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('uses the same-origin api path and merges duplicate in-flight requests', async () => {
    let resolveFetch: ((response: Response) => void) | undefined
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const first = fetchHomeOverview({ targetCategory: 'all' })
    const duplicate = fetchHomeOverview({ targetCategory: 'all' })

    expect(duplicate).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/home/overview?targetCategory=all',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )

    resolveFetch?.(jsonResponse({ code: 200, data: { biomarkerFrequencies: [{ name: 'A' }] } }))
    await expect(first).resolves.toEqual({ biomarkerFrequencies: [{ name: 'A' }] })
  })

  it('classifies an unauthorized response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ code: 401, message: '请先登录' }, 401)),
    )

    await expect(fetchHomeOverview()).rejects.toMatchObject({
      kind: 'unauthorized',
      status: 401,
      message: '请先登录',
    })
  })

  it('aborts and classifies a timed-out response', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        })
      }),
    )

    const rejection = fetchHomeOverview({}, 25).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(25)

    await expect(rejection).resolves.toMatchObject({ kind: 'timeout' })
  })
})
