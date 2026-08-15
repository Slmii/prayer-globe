// The only file that talks to namazvakitleri.diyanet.gov.tr.
//
// Two hard rules, both learned by probing the live site:
//   1. GET only. A POST returns a 385-byte WAF block page.
//   2. No query strings on city pages. `?year=2026` returns the same block.
// The block page comes back with HTTP 200, so it must be detected by content.

export const SITE = 'https://namazvakitleri.diyanet.gov.tr'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36'

/** Politeness gap between requests, per worker. */
const GAP_MS = 1500
/** How long to stand down once the WAF has objected. */
const BACKOFF_MS = 5 * 60 * 1000

export class BlockedError extends Error {
  constructor(path: string) {
    super(`WAF block page for ${path}`)
    this.name = 'BlockedError'
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Real pages run to hundreds of kilobytes, so any response body under 2000
 * bytes from this host is not a real page — length alone is the primary
 * signal. `Response.text()` always decodes as UTF-8 regardless of declared
 * charset, so the title phrase, "İsteğiniz güvenlik kurallarına takılmıştır",
 * is only used to confirm a WAF block for the log message; a differently
 * encoded block page would fail the phrase match but must still be caught by
 * length.
 */
export function isBlockPage(body: string): boolean {
  return body.length < 2000
}

async function request(path: string, attempt = 0): Promise<string> {
  let res: Response
  let body: string
  try {
    res = await fetch(SITE + path, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(30_000),
    })
    body = await res.text()
  } catch (err) {
    if (attempt >= 2) throw err
    await sleep(2000 * (attempt + 1))
    return request(path, attempt + 1)
  }

  if (isBlockPage(body) || res.status === 429 || res.status === 403) {
    if (attempt >= 2) throw new BlockedError(path)
    const confirmed = body.includes('güvenlik kurallarına takılmıştır')
    console.warn(`  blocked on ${path} (${confirmed ? 'confirmed WAF' : 'short body'}), standing down 5 min`)
    await sleep(BACKOFF_MS)
    return request(path, attempt + 1)
  }

  if (!res.ok) {
    if (attempt >= 2) throw new Error(`${path} → HTTP ${res.status}`)
    await sleep(2000 * (attempt + 1))
    return request(path, attempt + 1)
  }

  await sleep(GAP_MS)
  return body
}

export const getText = (path: string): Promise<string> => request(path)

export async function getJson<T>(path: string): Promise<T> {
  return JSON.parse(await getText(path)) as T
}

/**
 * Run `fn` over `items` with at most `limit` in flight, preserving order.
 * Once any `fn` call throws, no worker starts new work — the original error
 * still propagates, but the host does not keep receiving requests from
 * workers that haven't noticed the failure yet.
 */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  let failed = false
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      if (failed) return
      const i = next++
      if (i >= items.length) return
      try {
        out[i] = await fn(items[i], i)
      } catch (err) {
        failed = true
        throw err
      }
    }
  })
  await Promise.all(workers)
  return out
}
