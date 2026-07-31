// Duel wiring test: drives the real vendored duel client (js/duel.js →
// js/rooms.js) against the local shim (scripts/rooms-shim.mjs) as two
// simulated phones racing the same archive board. No network, no Supabase.
//
//   node scripts/test-duel.mjs

import { startShim } from './rooms-shim.mjs';
import { rackForDate } from '../js/engine.js';

const GAME = 'maple-scramble';

/* ------------------------------------------------- two-phone environment */

const stores = new Map();
let current = 'A';
globalThis.localStorage = {
  getItem: (k) => (stores.get(current).has(k) ? stores.get(current).get(k) : null),
  setItem: (k, v) => stores.get(current).set(k, String(v)),
  removeItem: (k) => stores.get(current).delete(k),
};
function device(d) {
  if (!stores.has(d)) stores.set(d, new Map());
  current = d;
}
device('A');
device('B');

let passed = 0;
function t(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`  ok — ${label}`);
}
async function expectCode(promise, code, label) {
  try {
    await promise;
    t(false, `${label} (no error thrown)`);
  } catch (e) {
    t(e && e.code === code, `${label} (got ${e && e.code})`);
  }
}

const shim = await startShim();
globalThis.BTOWN_ROOMS_URL = shim.url;
const { Duel, savedSession } = await import('../js/duel.js');

/* ------------------------------------------------------------ the tests */

const DATE = '2027-03-14';
t(rackForDate(DATE).length === 16, 'archive date deals a 16-tile rack (shared seed sanity)');

device('A');
const host = await Duel.create({ game: GAME, name: 'Ada', payload: { date: DATE } });
t(/^[A-Z2-9]{4}$/.test(host.code) && host.status === 'waiting', 'host opens a race');
t(savedSession(GAME)?.roomId === host.match.roomId, 'host session saved');

device('B');
const guest = await Duel.join({ game: GAME, code: host.code.toLowerCase(), name: 'Bea' });
t(guest.status === 'playing' && guest.payload.date === DATE, 'guest joins, same board date');

device('A');
await host.match._fetch();
t(host.status === 'playing' && host.others()[0].name === 'Bea', 'host sees the race start');

// both submit CONCURRENTLY — the version lock forces one to retry-merge
device('A');
const pushA = host.submitResult({ ms: 61234, points: 36000 - 612 });
device('B');
const pushB = guest.submitResult({ ms: 74560, points: 36000 - 745 });
await Promise.all([pushA, pushB]);
device('A');
await host.match._fetch();
device('B');
await guest.match._fetch();
t(host.isComplete() && guest.isComplete(), 'both results merged despite the race');
t(host.status === 'over' && guest.status === 'over', 'duel marked over');
t(host.others()[0].result.ms === 74560 && guest.others()[0].result.ms === 61234,
  'each phone sees the rival time');
t(host.myResult().ms < host.others()[0].result.ms, 'Ada won on time');

// resubmitting is a write-once no-op
await host.submitResult({ ms: 1, points: 99999 });
device('B');
await guest.match._fetch();
t(guest.others()[0].result.ms === 61234, 'results are write-once');

// rematch deals a fresh archive board to both
device('B');
await guest.rematch({ date: '2027-06-01' });
device('A');
await host.match._fetch();
t(host.payload.date === '2027-06-01' && Object.keys(host.results).length === 0
  && host.status === 'playing', 'rematch: fresh board, empty results');

// racing rematches: both deal, version lock keeps exactly one
device('A');
const dealA = host.rematch({ date: '2027-07-01' });
device('B');
const dealB = guest.rematch({ date: '2027-08-01' });
await Promise.all([dealA, dealB]);
device('A'); await host.match._fetch();
device('B'); await guest.match._fetch();
t(host.payload.date === guest.payload.date, 'racing rematches converge on one board');

// resume after a "refresh"
device('A');
const resumed = await Duel.resume({ game: GAME });
t(resumed.match.roomId === host.match.roomId && resumed.payload.date === host.payload.date,
  'resume reattaches to the race');

// leaving bars the stranded rival's submit and tells them why
await resumed.leave();
t(savedSession(GAME) === null, 'leave clears the session');
device('B');
await guest.match._fetch();
t(guest.others()[0].left === true, 'guest sees the host bailed');
await expectCode(guest.submitResult({ ms: 50000, points: 31000 }), 'opponent_left',
  'submit into an abandoned race says why');

shim.server.close();
console.log(`\nALL DUEL TESTS PASSED (${passed} checks)`);
process.exit(0);
