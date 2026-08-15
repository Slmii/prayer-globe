// CI entry point for the coverage gate. Exits non-zero so a workflow fails
// rather than deploying a globe that would fall back to the solar model.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkCoverage } from './coverage.ts'
import { CITIES } from '../../src/lib/cities.ts'
import type { SnapshotFile } from './fetch-times.ts'

const OUT = 'public/times'

// Compare against the selected-cities list, not the files that happen to
// exist — a deleted snapshot must fail the gate, not simply be skipped.
const missingSnapshots: string[] = []
const files: SnapshotFile[] = []

for (const city of CITIES) {
  const path = join(OUT, `${city.ilceID}.json`)
  if (!existsSync(path)) {
    missingSnapshots.push(`${city.n} (${city.ilceID})`)
    continue
  }
  files.push(JSON.parse(readFileSync(path, 'utf8')) as SnapshotFile)
}

let indexProblem: string | null = null
let index: Record<string, unknown> = {}
const indexPath = join(OUT, 'index.json')
if (!existsSync(indexPath)) {
  indexProblem = 'index.json is missing'
} else {
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf8')) as Record<string, unknown>
  } catch (err) {
    indexProblem = `index.json is unparseable: ${String(err)}`
  }
}

const missingIndexEntries: string[] = []
if (!indexProblem) {
  for (const city of CITIES) {
    if (!(city.n in index)) missingIndexEntries.push(`${city.n} (${city.ilceID})`)
  }
}

if (!files.length) {
  console.error('no snapshot files in public/times')
  process.exit(1)
}

const today = new Date().toISOString().slice(0, 10)
const problems = checkCoverage(files, today)

console.log(`checked ${files.length}/${CITIES.length} selected cities for ${today}`)

if (missingSnapshots.length) {
  console.error(`\n${missingSnapshots.length} selected cities have no snapshot file:`)
  for (const m of missingSnapshots.slice(0, 30)) console.error(`  ${m}`)
}

if (indexProblem) {
  console.error(`\n${indexProblem}`)
}

if (missingIndexEntries.length) {
  console.error(`\n${missingIndexEntries.length} selected cities are missing from index.json:`)
  for (const m of missingIndexEntries.slice(0, 30)) console.error(`  ${m}`)
}

if (problems.length) {
  console.error(`\n${problems.length} cities fail coverage:`)
  for (const p of problems.slice(0, 30)) console.error(`  ${p.name} (${p.ilceID}): ${p.reason}`)
}

const failed =
  missingSnapshots.length > 0 || indexProblem !== null || missingIndexEntries.length > 0 || problems.length > 0

if (failed) process.exit(1)
console.log('coverage OK')
