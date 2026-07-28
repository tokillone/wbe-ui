export const PMTILES_MAGIC = 'PMTiles'

export type PmtilesRangeProbeResult =
  | { ok: true }
  | {
      ok: false
      reason: 'network' | 'range-unsupported' | 'invalid-content-range' | 'invalid-magic'
    }

export async function probePmtilesRange(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<PmtilesRangeProbeResult> {
  const lastByte = PMTILES_MAGIC.length - 1
  let response: Response

  try {
    response = await fetcher(url, {
      cache: 'no-store',
      headers: { Range: `bytes=0-${lastByte}` },
    })
  } catch {
    return { ok: false, reason: 'network' }
  }

  if (response.status !== 206) {
    await response.body?.cancel()
    return { ok: false, reason: 'range-unsupported' }
  }

  const contentRange = response.headers.get('content-range')?.trim() ?? ''
  const match = /^bytes\s+0-(\d+)\/(\d+|\*)$/i.exec(contentRange)
  if (!match || Number(match[1]) !== lastByte) {
    await response.body?.cancel()
    return { ok: false, reason: 'invalid-content-range' }
  }

  try {
    const bytes = new Uint8Array(await response.arrayBuffer())
    const prefix = new TextDecoder().decode(bytes.slice(0, PMTILES_MAGIC.length))
    return prefix === PMTILES_MAGIC
      ? { ok: true }
      : { ok: false, reason: 'invalid-magic' }
  } catch {
    return { ok: false, reason: 'network' }
  }
}
