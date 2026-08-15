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

/** What a given path is expected to return, which decides how a block is spotted. */
export type Expect = 'html' | 'json'

/**
 * The WAF answers with a ~490-byte HTML page and HTTP 200, so a block has to be
 * recognised by content. `Response.text()` always decodes as UTF-8 regardless
 * of declared charset, so the title phrase alone is not enough — a differently
 * encoded block page would slip past it. Hence a second, shape-based signal,
 * which necessarily differs by endpoint:
 *
 *   html — city pages run to hundreds of kilobytes, so anything under 2000
 *          bytes is not a real page.
 *   json — GetRegList legitimately returns payloads as small as 90 bytes, so
 *          length says nothing. What gives a block away is HTML where JSON was
 *          expected.
 *
 * Applying the html rule to json is what silently broke the first discovery
 * run: every small-but-valid district list was read as a block and earned a
 * five-minute stand-down.
 */
export function isBlockPage(body: string, expect: Expect = 'html'): boolean {
  if (body.includes('güvenlik kurallarına takılmıştır')) return true
  return expect === 'html' ? body.length < 2000 : /^\s*</.test(body)
}

async function request(path: string, expect: Expect = 'html', attempt = 0): Promise<string> {
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
    return request(path, expect, attempt + 1)
  }

  if (isBlockPage(body, expect) || res.status === 429 || res.status === 403) {
    if (attempt >= 2) throw new BlockedError(path)
    const confirmed = body.includes('güvenlik kurallarına takılmıştır')
    console.warn(`  blocked on ${path} (${confirmed ? 'confirmed WAF' : 'short body'}), standing down 5 min`)
    await sleep(BACKOFF_MS)
    return request(path, expect, attempt + 1)
  }

  if (!res.ok) {
    if (attempt >= 2) throw new Error(`${path} → HTTP ${res.status}`)
    await sleep(2000 * (attempt + 1))
    return request(path, expect, attempt + 1)
  }

  await sleep(GAP_MS)
  return body
}

export const getText = (path: string): Promise<string> => request(path, 'html')

export async function getJson<T>(path: string): Promise<T> {
  return JSON.parse(await request(path, 'json')) as T
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
