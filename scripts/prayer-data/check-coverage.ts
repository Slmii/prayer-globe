// CI entry point for the coverage gate. Exits non-zero so a workflow fails
// rather than deploying a globe that would fall back to the solar model.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkCoverage } from './coverage.ts'

const OUT = 'public/times'

const files = readdirSync(OUT)
  .filter((f) => f.endsWith('.json') && f !== 'index.json')
  .map((f) => JSON.parse(readFileSync(join(OUT, f), 'utf8')))

if (!files.length) {
  console.error('no snapshot files in public/times')
  process.exit(1)
}

const today = new Date().toISOString().slice(0, 10)
const problems = checkCoverage(files, today)

console.log(`checked ${files.length} cities for ${today}`)
if (problems.length) {
  console.error(`\n${problems.length} cities fail coverage:`)
  for (const p of problems.slice(0, 30)) console.error(`  ${p.name} (${p.ilceID}): ${p.reason}`)
  process.exit(1)
}
console.log('coverage OK')
