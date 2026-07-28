// Reveal-solver check: sample dates across the shipped range, assert the
// give-up solver finds a full board for each, and report how much of each
// revealed board is everyday words.
//   node scripts/test-reveal.mjs           (every 13th date)
//   node scripts/test-reveal.mjs --all     (every date — slow)

import fs from 'node:fs';
import { rackForDate, isSolved, extractRuns } from '../js/engine.js';
import { makeWordIndex, buildRevealBoard } from '../js/solver.js';

const START = '2026-07-26';
const END = '2028-07-26';
const STEP = process.argv.includes('--all') ? 1 : 13;

const split = (t) => t.split('\n').map((w) => w.trim()).filter(Boolean);
const dictWords = split(fs.readFileSync(new URL('../data/words.txt', import.meta.url), 'utf8'));
const commonWords = split(fs.readFileSync(new URL('../data/common.txt', import.meta.url), 'utf8'));
const common = new Set(commonWords);
const index = makeWordIndex(dictWords, commonWords);

const dayCount = Math.round(
  (Date.parse(`${END}T12:00:00Z`) - Date.parse(`${START}T12:00:00Z`)) / 86400000,
) + 1;

let checked = 0;
let failures = 0;
let totalWords = 0;
let commonHits = 0;
const startedAt = performance.now();
for (let offset = 0; offset < dayCount; offset += STEP) {
  const date = new Date(Date.parse(`${START}T12:00:00Z`) + offset * 86400000)
    .toISOString().slice(0, 10);
  const rack = rackForDate(date);
  const grid = buildRevealBoard(rack, index);
  checked++;
  if (!grid || !isSolved(grid, index.dict)) {
    failures++;
    console.log(`FAIL ${date} ${rack.join('')}`);
    continue;
  }
  const words = extractRuns(grid).map((r) => r.word.toLowerCase());
  totalWords += words.length;
  commonHits += words.filter((w) => common.has(w)).length;
}

const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
const pct = totalWords ? ((commonHits / totalWords) * 100).toFixed(0) : '–';
if (failures) {
  console.error(`\n${failures} of ${checked} sampled racks failed in ${seconds}s.`);
  process.exitCode = 1;
} else {
  console.log(`All ${checked} sampled racks revealed a board in ${seconds}s; ` +
    `${pct}% of revealed words are everyday words.`);
}
