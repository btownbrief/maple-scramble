// Runs the reveal solver off the main thread so the spinner keeps spinning.
// Fetches its own word lists (both come out of the HTTP cache after the
// game has loaded once) and posts back { grid } or { grid: null }.

import { makeWordIndex, buildRevealBoard } from './solver.js';

self.onmessage = async ({ data }) => {
  try {
    const [dictText, commonText] = await Promise.all([
      fetch(new URL('../data/words.txt', import.meta.url))
        .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.text(); }),
      fetch(new URL('../data/common.txt', import.meta.url))
        .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.text(); }),
    ]);
    const split = (t) => t.split('\n').map((w) => w.trim()).filter(Boolean);
    const index = makeWordIndex(split(dictText), split(commonText));
    const grid = buildRevealBoard(data.rack, index, 8000);
    self.postMessage({ grid });
  } catch {
    self.postMessage({ grid: null });
  }
};
