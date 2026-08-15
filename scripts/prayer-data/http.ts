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
const GAP_MS = 500
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
 * The block page is short and titled "İsteğiniz güvenlik kurallarına
 * takılmıştır". Real pages are hundreds of kilobytes, so length alone is a
 * strong signal, but match the title too so a truncated response is not
 * mistaken for a block.
 */
export function isBlockPage(body: string): boolean {
  return body.length < 2000 && body.includes('güvenlik kurallarına takılmıştır')
}

async function request(path: string, attempt = 0): Promise<string> {
  const res = await fetch(SITE + path, { headers: { 'User-Agent': UA } })
  const body = await res.text()

  if (isBlockPage(body) || res.status === 429 || res.status === 403) {
    if (attempt >= 2) throw new BlockedError(path)
    console.warn(`  blocked on ${path}, standing down 5 min`)
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

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}
