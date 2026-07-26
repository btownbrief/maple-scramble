// Heuristic solvability sweep for MAPLE SCRAMBLE:
//   node scripts/test-solvable.mjs
//
// For each rack, seed a long word and greedily backtrack through legal
// crossing-word attachments. This is intentionally a fast builder, not an
// exhaustive proof: a reported failure means the heuristic did not find a
// board within its search budget.

import fs from 'node:fs';
import { rackForDate, isSolved, key, parseKey, validate } from '../js/engine.js';

const START = '2026-07-26';
const END = '2028-07-26';
const SEARCH_MS = 2000;
const NODE_LIMIT = 200000;
const MOVE_LIMIT = 120;

const dictionaryWords = fs.readFileSync(new URL('../data/words.txt', import.meta.url), 'utf8')
  .split('\n')
  .map((word) => word.trim())
  .filter((word) => /^[a-z]{2,16}$/.test(word));
const dictionary = new Set(dictionaryWords);

// Racks contain at most two of a letter. Bucket words by their distinct-letter
// mask so each date only inspects masks that are subsets of that day's rack.
const wordsByMask = new Map();
for (const lower of dictionaryWords) {
  const word = lower.toUpperCase();
  let mask = 0;
  let doubleMask = 0;
  let usable = true;
  const counts = new Uint8Array(26);
  for (const ch of word) {
    const i = ch.charCodeAt(0) - 65;
    counts[i]++;
    if (counts[i] > 2) { usable = false; break; }
    mask |= 1 << i;
    if (counts[i] === 2) doubleMask |= 1 << i;
  }
  if (!usable) continue;
  const entry = { word, mask, doubleMask };
  if (!wordsByMask.has(mask)) wordsByMask.set(mask, []);
  wordsByMask.get(mask).push(entry);
}

function wordPool(rack) {
  let rackMask = 0;
  let doubleMask = 0;
  const counts = new Uint8Array(26);
  for (const ch of rack) {
    const i = ch.charCodeAt(0) - 65;
    counts[i]++;
    rackMask |= 1 << i;
    if (counts[i] === 2) doubleMask |= 1 << i;
  }
  const pool = [];
  for (let mask = rackMask; mask; mask = (mask - 1) & rackMask) {
    for (const entry of wordsByMask.get(mask) || []) {
      if ((entry.doubleMask & ~doubleMask) === 0) pool.push(entry);
    }
  }
  pool.sort((a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word));
  return pool;
}

function rackCounts(rack) {
  const counts = new Uint8Array(26);
  for (const ch of rack) counts[ch.charCodeAt(0) - 65]++;
  return counts;
}

function seedState(word, rack) {
  const remaining = rackCounts(rack);
  const grid = {};
  for (let i = 0; i < word.length; i++) {
    const letter = word[i];
    remaining[letter.charCodeAt(0) - 65]--;
    grid[key(i, 0)] = letter;
  }
  return { grid, remaining, left: rack.length - word.length };
}

function normalizedSignature(state) {
  const cells = Object.entries(state.grid).map(([k, letter]) => ({ ...parseKey(k), letter }));
  const minX = Math.min(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));
  cells.sort((a, b) => a.y - b.y || a.x - b.x);
  return cells.map((cell) => `${cell.x - minX},${cell.y - minY}:${cell.letter}`).join('|');
}

function tryPlacement(state, word, startX, startY, dx, dy) {
  const before = key(startX - dx, startY - dy);
  const after = key(startX + dx * word.length, startY + dy * word.length);
  if (state.grid[before] !== undefined || state.grid[after] !== undefined) return null;

  const grid = { ...state.grid };
  const remaining = state.remaining.slice();
  let added = 0;
  for (let i = 0; i < word.length; i++) {
    const k = key(startX + dx * i, startY + dy * i);
    const existing = grid[k];
    if (existing !== undefined && existing !== word[i]) return null;
    if (existing === undefined) {
      const letterIndex = word.charCodeAt(i) - 65;
      if (remaining[letterIndex] === 0) return null;
      remaining[letterIndex]--;
      grid[k] = word[i];
      added++;
    }
  }
  if (added === 0 || !validate(grid, dictionary).allValid) return null;
  return { grid, remaining, left: state.left - added, added, wordLength: word.length };
}

function nextMoves(state, byLetter, deadline) {
  const moves = [];
  const seen = new Set();
  for (const [cellKey, letter] of Object.entries(state.grid)) {
    if (performance.now() >= deadline) break;
    const { x, y } = parseKey(cellKey);
    for (const entry of byLetter[letter.charCodeAt(0) - 65]) {
      let at = entry.word.indexOf(letter);
      while (at !== -1) {
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const startX = x - dx * at;
          const startY = y - dy * at;
          const placementKey = `${startX},${startY},${dx},${dy},${entry.word}`;
          if (seen.has(placementKey)) continue;
          seen.add(placementKey);
          const move = tryPlacement(state, entry.word, startX, startY, dx, dy);
          if (move) moves.push(move);
        }
        at = entry.word.indexOf(letter, at + 1);
      }
      if (moves.length >= MOVE_LIMIT * 3 || performance.now() >= deadline) break;
    }
  }
  moves.sort((a, b) => b.added - a.added || b.wordLength - a.wordLength);
  return moves.slice(0, MOVE_LIMIT);
}

function buildBoard(rack) {
  const pool = wordPool(rack);
  const byLetter = Array.from({ length: 26 }, () => []);
  for (const entry of pool) {
    for (let i = 0; i < 26; i++) {
      if (entry.mask & (1 << i)) byLetter[i].push(entry);
    }
  }

  const longest = pool[0]?.word.length || 0;
  const seeds = pool.filter((entry) => entry.word.length >= Math.max(2, longest - 3)).slice(0, 120);
  const deadline = performance.now() + SEARCH_MS;
  const seen = new Set();
  let nodes = 0;

  function search(state) {
    if (state.left === 0) return isSolved(state.grid, dictionary) ? state.grid : null;
    if (++nodes > NODE_LIMIT || performance.now() >= deadline) return null;
    const signature = normalizedSignature(state);
    if (seen.has(signature)) return null;
    seen.add(signature);
    for (const move of nextMoves(state, byLetter, deadline)) {
      const solved = search(move);
      if (solved) return solved;
    }
    return null;
  }

  for (const seed of seeds) {
    const solved = search(seedState(seed.word, rack));
    if (solved) return solved;
    if (nodes > NODE_LIMIT || performance.now() >= deadline) break;
  }
  return null;
}

function isoDateAt(offset) {
  const date = new Date(Date.parse(`${START}T12:00:00Z`) + offset * 86400000);
  return date.toISOString().slice(0, 10);
}

const dayCount = Math.round(
  (Date.parse(`${END}T12:00:00Z`) - Date.parse(`${START}T12:00:00Z`)) / 86400000,
) + 1;
const failures = [];
const startedAt = performance.now();
for (let offset = 0; offset < dayCount; offset++) {
  const date = isoDateAt(offset);
  const rack = rackForDate(date);
  if (!buildBoard(rack)) {
    failures.push(date);
    console.log(`FAIL ${date} ${rack.join('')}`);
  }
}

const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
if (failures.length) {
  console.error(`\n${failures.length} of ${dayCount} dates failed in ${seconds}s.`);
  process.exitCode = 1;
} else {
  console.log(`All ${dayCount} racks produced a connected valid grid in ${seconds}s.`);
}
