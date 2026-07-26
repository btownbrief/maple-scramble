// MAPLE SCRAMBLE — pure game logic. No DOM, no Date.now(): the current
// date arrives as a 'YYYY-MM-DD' string and everything here is a plain
// function over JSON-serializable values, so the whole day's board can be
// saved to localStorage and replayed. Tested by scripts/test-engine.mjs.

// ------------------------------------------------------------ seeded RNG
// xmur3 string hash → mulberry32 PRNG. Same date string in, same rack out,
// on every device — that's what makes the daily puzzle shared.
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------ letter bag
// Standard Scrabble distribution (98 tiles, no blanks).
export const LETTER_DIST = {
  E: 12, A: 9, I: 9, O: 8, N: 6, R: 6, T: 6, L: 4, S: 4, U: 4, D: 4,
  G: 3, B: 2, C: 2, M: 2, P: 2, F: 2, H: 2, V: 2, W: 2, Y: 2,
  K: 1, J: 1, X: 1, Q: 1, Z: 1,
};
export const RACK_SIZE = 16;
const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

function fullBag() {
  const bag = [];
  for (const [ch, n] of Object.entries(LETTER_DIST)) {
    for (let i = 0; i < n; i++) bag.push(ch);
  }
  return bag;
}

// Deterministic 16-tile rack for a date. Constraints keep every day humanly
// solvable: at least 5 vowels (but not a vowel flood — at most 9), no more
// than 2 copies of any letter, and a Q never shows up without a U (ENABLE
// has no "qi", so a U-less Q can strand the rack). Draws that break a rule
// are redrawn with the attempt number folded into the seed, so the result
// is still a pure function of the date string.
export function rackForDate(dateStr) {
  for (let attempt = 0; ; attempt++) {
    const rand = mulberry32(xmur3(`maple-scramble:${dateStr}:${attempt}`)());
    const bag = fullBag();
    for (let i = bag.length - 1; i > 0; i--) {          // Fisher–Yates
      const j = Math.floor(rand() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    const rack = [];
    const count = {};
    for (const ch of bag) {
      if ((count[ch] || 0) >= 2) continue;              // max 2 copies
      count[ch] = (count[ch] || 0) + 1;
      rack.push(ch);
      if (rack.length === RACK_SIZE) break;
    }
    const vowels = rack.filter((ch) => VOWELS.has(ch)).length;
    if (vowels < 5 || vowels > 9) continue;
    if (rack.includes('Q') && !rack.includes('U')) continue;
    return rack.sort();
  }
}

// ------------------------------------------------------------ day number
// #1 = launch day; used for the share text, wordle-style.
export const EPOCH = '2026-07-26';
export function dayNumber(dateStr, epoch = EPOCH) {
  return Math.round(
    (Date.parse(dateStr + 'T12:00:00Z') - Date.parse(epoch + 'T12:00:00Z')) / 86400000,
  ) + 1;
}

// ------------------------------------------------------------ grid model
// A grid is a plain object mapping 'x,y' → 'A'. Coordinates may go
// negative while playing; normalize() shifts everything to start at 0,0.
export const key = (x, y) => `${x},${y}`;
export function parseKey(k) {
  const [x, y] = k.split(',').map(Number);
  return { x, y };
}
export function bounds(grid) {
  const ks = Object.keys(grid);
  if (ks.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const k of ks) {
    const { x, y } = parseKey(k);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}
export function normalize(grid) {
  const b = bounds(grid);
  if (!b) return {};
  const out = {};
  for (const [k, ch] of Object.entries(grid)) {
    const { x, y } = parseKey(k);
    out[key(x - b.minX, y - b.minY)] = ch;
  }
  return out;
}

// True when every placed tile is reachable from every other through
// side-by-side neighbors — i.e. the board is ONE crossword, not islands.
export function isConnected(grid) {
  const ks = Object.keys(grid);
  if (ks.length <= 1) return true;
  const seen = new Set([ks[0]]);
  const queue = [ks[0]];
  while (queue.length) {
    const { x, y } = parseKey(queue.pop());
    for (const k of [key(x + 1, y), key(x - 1, y), key(x, y + 1), key(x, y - 1)]) {
      if (grid[k] !== undefined && !seen.has(k)) { seen.add(k); queue.push(k); }
    }
  }
  return seen.size === ks.length;
}

// Every maximal horizontal and vertical run of 2+ letters, reading
// left→right and top→bottom: [{ word, dir, cells: ['x,y', ...] }].
export function extractRuns(grid) {
  const runs = [];
  for (const k of Object.keys(grid)) {
    const { x, y } = parseKey(k);
    if (grid[key(x - 1, y)] === undefined && grid[key(x + 1, y)] !== undefined) {
      let cx = x; let word = ''; const cells = [];
      while (grid[key(cx, y)] !== undefined) { word += grid[key(cx, y)]; cells.push(key(cx, y)); cx++; }
      runs.push({ word, dir: 'h', cells });
    }
    if (grid[key(x, y - 1)] === undefined && grid[key(x, y + 1)] !== undefined) {
      let cy = y; let word = ''; const cells = [];
      while (grid[key(x, cy)] !== undefined) { word += grid[key(x, cy)]; cells.push(key(x, cy)); cy++; }
      runs.push({ word, dir: 'v', cells });
    }
  }
  return runs;
}

// Live check the UI paints from: which runs are words, which cells glow red.
export function validate(grid, dict) {
  const runs = extractRuns(grid).map((r) => ({
    ...r, valid: dict.has(r.word.toLowerCase()),
  }));
  const badCells = new Set();
  for (const r of runs) if (!r.valid) for (const c of r.cells) badCells.add(c);
  return { runs, badCells, allValid: runs.every((r) => r.valid) };
}

// The win check: all tiles down, one connected crossword, every run a word.
// (With 2+ connected tiles, every tile is automatically part of some run.)
export function isSolved(grid, dict, rackSize = RACK_SIZE) {
  if (Object.keys(grid).length !== rackSize) return false;
  if (!isConnected(grid)) return false;
  return validate(grid, dict).allValid;
}

// ------------------------------------------------------------ leaderboard score
// The shared Btown backend ranks higher-is-better, so a fast time becomes
// points: 36000 minus elapsed deciseconds (an hour-long solve scores 0 and
// isn't submitted). pointsToMs reverses it for display.
export function timeToPoints(elapsedMs) {
  return Math.max(0, 36000 - Math.floor(elapsedMs / 100));
}
export function pointsToMs(points) {
  return (36000 - points) * 100;
}
export function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
