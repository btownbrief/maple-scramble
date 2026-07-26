// Engine tests for MAPLE SCRAMBLE. Plain node, no framework:
//   node scripts/test-engine.mjs
// Exits 0 with a summary line on success, throws on the first failure.

import assert from 'node:assert/strict';
import {
  rackForDate, RACK_SIZE, key, isConnected, extractRuns, validate,
  isSolved, timeToPoints, pointsToMs, dayNumber, normalize, bounds,
} from '../js/engine.js';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };

// ------------------------------------------------------------ rack generator
ok('rack for a fixed date is deterministic', () => {
  const a = rackForDate('2026-07-26');
  const b = rackForDate('2026-07-26');
  assert.deepEqual(a, b);
  assert.equal(a.length, RACK_SIZE);
});

ok('different dates give different racks', () => {
  assert.notDeepEqual(rackForDate('2026-07-26'), rackForDate('2026-07-27'));
});

ok('a year of racks all satisfy the constraints', () => {
  const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);
  for (let i = 0; i < 366; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    const rack = rackForDate(d);
    assert.equal(rack.length, RACK_SIZE, d);
    const counts = {};
    for (const ch of rack) {
      assert.match(ch, /^[A-Z]$/, d);
      counts[ch] = (counts[ch] || 0) + 1;
      assert.ok(counts[ch] <= 2, `${d}: more than 2 × ${ch}`);
    }
    const vowels = rack.filter((c) => VOWELS.has(c)).length;
    assert.ok(vowels >= 5, `${d}: only ${vowels} vowels`);
    assert.ok(vowels <= 9, `${d}: ${vowels} vowels`);
    if (rack.includes('Q')) assert.ok(rack.includes('U'), `${d}: Q without U`);
  }
});

// ------------------------------------------------------------ connectivity
//  T A P     one L-shaped connected group
//  E
ok('one connected group is connected', () => {
  const grid = {
    [key(0, 0)]: 'T', [key(1, 0)]: 'A', [key(2, 0)]: 'P', [key(0, 1)]: 'E',
  };
  assert.ok(isConnected(grid));
});

ok('two islands are not connected (diagonals do not count)', () => {
  const grid = {
    [key(0, 0)]: 'T', [key(1, 0)]: 'A',
    [key(2, 1)]: 'S', [key(3, 1)]: 'O',   // touches (1,0) only diagonally
  };
  assert.ok(!isConnected(grid));
});

ok('empty and single-tile grids count as connected', () => {
  assert.ok(isConnected({}));
  assert.ok(isConnected({ [key(5, 5)]: 'A' }));
});

// ------------------------------------------------------------ runs + validation
const DICT = new Set(['tap', 'at', 'sap', 'ta', 'pas']);

//    T A P        rows: TAP     cols: TA (under T), SAP would need more
//    A   A
//        S
ok('extracts every horizontal and vertical run of 2+', () => {
  const grid = {
    [key(0, 0)]: 'T', [key(1, 0)]: 'A', [key(2, 0)]: 'P',
    [key(0, 1)]: 'A', [key(2, 1)]: 'A', [key(2, 2)]: 'S',
  };
  const runs = extractRuns(grid);
  const words = runs.map((r) => r.word).sort();
  assert.deepEqual(words, ['PAS', 'TA', 'TAP']);   // no 1-letter runs
});

ok('validate flags exactly the cells of invalid runs', () => {
  const grid = {
    [key(0, 0)]: 'T', [key(1, 0)]: 'A', [key(2, 0)]: 'P',  // TAP valid
    [key(2, 1)]: 'X',                                       // PX vertical: invalid
  };
  const { runs, badCells, allValid } = validate(grid, DICT);
  assert.equal(allValid, false);
  const bad = runs.find((r) => !r.valid);
  assert.equal(bad.word, 'PX');
  assert.ok(badCells.has(key(2, 0)) && badCells.has(key(2, 1)));
  assert.ok(!badCells.has(key(0, 0)));
});

ok('isSolved: all tiles placed + connected + every run valid', () => {
  //  T A P
  //  A
  const grid = {
    [key(0, 0)]: 'T', [key(1, 0)]: 'A', [key(2, 0)]: 'P', [key(0, 1)]: 'A',
  };
  assert.ok(isSolved(grid, DICT, 4));
  assert.ok(!isSolved(grid, DICT, 16));                       // tiles left in rack
  const islands = { ...grid };
  delete islands[key(1, 0)];
  islands[key(5, 5)] = 'A';
  assert.ok(!isSolved(islands, DICT, 4));                     // disconnected
  const badWord = { ...grid, [key(0, 1)]: 'X' };              // TX not a word
  assert.ok(!isSolved(badWord, DICT, 4));
});

// ------------------------------------------------------------ misc
ok('normalize shifts negative coordinates to a 0,0 origin', () => {
  const grid = { [key(-2, -1)]: 'A', [key(-1, -1)]: 'T' };
  const norm = normalize(grid);
  assert.deepEqual(norm, { [key(0, 0)]: 'A', [key(1, 0)]: 'T' });
  assert.deepEqual(bounds(norm), { minX: 0, minY: 0, maxX: 1, maxY: 0 });
});

ok('time → leaderboard points: 36000 − deciseconds, floored at 0', () => {
  assert.equal(timeToPoints(0), 36000);
  assert.equal(timeToPoints(123400), 34766);        // 2:03.4 → 1234 ds
  assert.equal(timeToPoints(3600000), 0);           // exactly an hour
  assert.equal(timeToPoints(99999999), 0);          // floor at 0
  assert.equal(pointsToMs(34766), 123400);          // round-trips for display
});

ok('day numbering starts at #1 on the epoch', () => {
  assert.equal(dayNumber('2026-07-26'), 1);
  assert.equal(dayNumber('2026-08-01'), 7);
});

ok('civil-date arithmetic matches the former Date.parse algorithm from 2026–2036', () => {
  const oldDayNumber = (date, epoch = '2026-07-26') =>
    Math.round(
      (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${epoch}T12:00:00Z`)) / 86400000,
    ) + 1;
  for (let year = 2026; year <= 2036; year++) {
    for (const monthDay of ['01-01', '02-28', '03-01', '07-26', '12-31']) {
      const date = `${year}-${monthDay}`;
      assert.equal(dayNumber(date), oldDayNumber(date), date);
    }
  }
  assert.equal(dayNumber('2028-02-29'), oldDayNumber('2028-02-29'));
  assert.equal(dayNumber('2032-02-29'), oldDayNumber('2032-02-29'));
  assert.equal(dayNumber('2036-02-29'), oldDayNumber('2036-02-29'));
});

ok('sample rack outputs are unchanged', () => {
  const expected = {
    '2026-07-26': ['A', 'A', 'C', 'E', 'L', 'L', 'M', 'O', 'P', 'R', 'R', 'T', 'U', 'V', 'W', 'Z'],
    '2026-12-31': ['A', 'B', 'D', 'E', 'F', 'F', 'I', 'I', 'J', 'K', 'N', 'O', 'O', 'V', 'Y', 'Y'],
    '2027-01-01': ['A', 'A', 'D', 'E', 'E', 'F', 'H', 'H', 'I', 'I', 'N', 'N', 'O', 'S', 'S', 'U'],
    '2028-02-29': ['B', 'D', 'E', 'E', 'H', 'K', 'L', 'N', 'O', 'O', 'Q', 'R', 'S', 'S', 'U', 'U'],
    '2030-06-15': ['A', 'D', 'E', 'F', 'F', 'I', 'J', 'N', 'O', 'O', 'P', 'R', 'R', 'T', 'T', 'U'],
    '2036-12-31': ['A', 'C', 'E', 'E', 'G', 'I', 'I', 'L', 'N', 'O', 'O', 'P', 'S', 'T', 'U', 'U'],
  };
  for (const [date, rack] of Object.entries(expected)) {
    assert.deepEqual(rackForDate(date), rack, date);
  }
});

console.log(`\nAll ${n} engine tests passed.`);
