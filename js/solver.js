// MAPLE SCRAMBLE — reveal solver. Builds one full valid board for a rack so
// a stuck player can give up and still see how the day was solvable. Same
// seed-a-word-then-backtrack builder as scripts/test-solvable.mjs, but biased
// toward everyday words (data/common.txt, frequency-ordered): a reveal full
// of ENABLE obscurities would read as "this game is unfair" instead of "oh,
// I see". Pure logic — no DOM, no fetch; runs in a worker or under node.

import { isSolved, validate, key, parseKey } from './engine.js';

const NODE_LIMIT = 200000;
const MOVE_LIMIT = 120;

// Precompute once per dictionary load; buildRevealBoard reuses it per rack.
// Words are bucketed by distinct-letter mask (racks hold at most two of a
// letter) so each rack only inspects masks that are subsets of its own.
export function makeWordIndex(dictWords, commonWords) {
  const dict = new Set(dictWords);
  const rank = new Map();
  commonWords.forEach((w, i) => { if (!rank.has(w)) rank.set(w, i); });
  const wordsByMask = new Map();
  for (const lower of dictWords) {
    if (!/^[a-z]{2,16}$/.test(lower)) continue;
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
    const entry = { word, mask, doubleMask, rank: rank.has(lower) ? rank.get(lower) : Infinity };
    if (!wordsByMask.has(mask)) wordsByMask.set(mask, []);
    wordsByMask.get(mask).push(entry);
  }
  return { dict, wordsByMask };
}

function wordPool(rack, index) {
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
    for (const entry of index.wordsByMask.get(mask) || []) {
      if ((entry.doubleMask & ~doubleMask) === 0) pool.push(entry);
    }
  }
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
    remaining[word.charCodeAt(i) - 65]--;
    grid[key(i, 0)] = word[i];
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

function tryPlacement(state, entry, startX, startY, dx, dy, dict) {
  const word = entry.word;
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
  if (added === 0 || !validate(grid, dict).allValid) return null;
  return { grid, remaining, left: state.left - added, added, rank: entry.rank, wordLength: word.length };
}

function nextMoves(state, byLetter, deadline, dict, moveOrder) {
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
          const move = tryPlacement(state, entry, startX, startY, dx, dy, dict);
          if (move) moves.push(move);
        }
        at = entry.word.indexOf(letter, at + 1);
      }
      if (moves.length >= MOVE_LIMIT * 3 || performance.now() >= deadline) break;
    }
  }
  moves.sort(moveOrder);
  return moves.slice(0, MOVE_LIMIT);
}

function buildWith(rack, pool, budgetMs, dict, moveOrder) {
  const byLetter = Array.from({ length: 26 }, () => []);
  for (const entry of pool) {
    for (let i = 0; i < 26; i++) {
      if (entry.mask & (1 << i)) byLetter[i].push(entry);
    }
  }
  const longest = pool[0]?.word.length || 0;
  const seeds = pool.filter((entry) => entry.word.length >= Math.max(2, longest - 3)).slice(0, 120);
  const deadline = performance.now() + budgetMs;
  const seen = new Set();
  let nodes = 0;

  function search(state) {
    if (state.left === 0) return isSolved(state.grid, dict) ? state.grid : null;
    if (++nodes > NODE_LIMIT || performance.now() >= deadline) return null;
    const signature = normalizedSignature(state);
    if (seen.has(signature)) return null;
    seen.add(signature);
    for (const move of nextMoves(state, byLetter, deadline, dict, moveOrder)) {
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

// Three passes, friendliest first: (1) everyday words only, (2) full
// dictionary but everyday words preferred, (3) the exact ordering the
// offline sweep used — every shipped rack is known to fall to pass 3,
// so a null return means the budget was cut, not that no board exists.
export function buildRevealBoard(rack, index, budgetMs = 7000) {
  const pool = wordPool(rack, index);
  const dict = index.dict;

  const commonPool = pool.filter((e) => e.rank !== Infinity)
    .sort((a, b) => b.word.length - a.word.length || a.rank - b.rank);
  const commonFirst = (a, b) => b.added - a.added ||
    (a.rank === Infinity) - (b.rank === Infinity) || b.wordLength - a.wordLength;
  let grid = buildWith(rack, commonPool, budgetMs * 0.4, dict, commonFirst);
  if (grid) return grid;

  const mixedPool = pool.slice().sort((a, b) =>
    (a.rank === Infinity) - (b.rank === Infinity) ||
    b.word.length - a.word.length || a.word.localeCompare(b.word));
  grid = buildWith(rack, mixedPool, budgetMs * 0.3, dict, commonFirst);
  if (grid) return grid;

  const sweepPool = pool.slice().sort((a, b) =>
    b.word.length - a.word.length || a.word.localeCompare(b.word));
  const sweepOrder = (a, b) => b.added - a.added || b.wordLength - a.wordLength;
  return buildWith(rack, sweepPool, budgetMs * 0.3, dict, sweepOrder);
}
