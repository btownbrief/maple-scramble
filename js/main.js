// MAPLE SCRAMBLE — UI layer only. All game rules live in js/engine.js
// (pure, tested by scripts/test-engine.mjs); this file owns the DOM:
// drag-and-drop, the count-up timer, live red-glow validation, the
// auto-fitting board camera, celebration, stats, share, leaderboard.

import {
  rackForDate, RACK_SIZE, key, parseKey, bounds, normalize,
  isConnected, validate, isSolved, timeToPoints, pointsToMs,
  formatTime, dayNumber,
} from './engine.js';
import {
  lbEnabled, getName, submitScore, renamePlayer, fetchTop, monthLabel, playerId,
} from './leaderboard.js';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------ date (America/New_York)
const NY = 'America/New_York';
function nyDateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d); // YYYY-MM-DD
}
function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}
function msToNextNyMidnight() {
  const today = nyDateStr();
  let lo = Date.now(), hi = Date.now() + 26 * 3600000;
  while (hi - lo > 500) {
    const mid = (lo + hi) / 2;
    if (nyDateStr(new Date(mid)) === today) lo = mid; else hi = mid;
  }
  return hi - Date.now();
}

// ?testdate=YYYY-MM-DD plays another day's rack (testing only; skips
// state/stats/leaderboard writes so real progress is never touched)
const TEST_DATE = new URLSearchParams(location.search).get('testdate');
const TODAY = TEST_DATE || nyDateStr();
const DAY_NUM = dayNumber(TODAY);

// ------------------------------------------------------------ state
const CELL = 56;                 // plane units per grid cell
let dict = null;                 // Set of valid words (lowercase)
let tray = [];                   // [{id, letter}] still on the rack
let placed = {};                 // 'x,y' -> {id, letter}
let status = 'playing';          // playing | done
let started = false;             // first tile has been placed
let elapsedMs = 0;
let solveMs = 0;
let lastTick = 0;
let lastDateCheck = 0;
let dayRolledOver = false;

const letterGrid = () =>
  Object.fromEntries(Object.entries(placed).map(([k, t]) => [k, t.letter]));

// ------------------------------------------------------------ boot
async function boot() {
  $('dayBar').textContent = `#${DAY_NUM} · 16 tiles · Burlington, VT`;
  const rack = rackForDate(TODAY).map((letter, i) => ({ id: `t${i}`, letter }));
  tray = rack;
  restore(rack);
  renderTray();
  renderBoardTiles();
  updateFit(true);
  paintValidity();
  renderTimer();
  void retryPendingSubmit();
  await loadDictionary();
}

async function loadDictionary() {
  $('dictErrorOverlay').classList.add('hidden');
  try {
    const res = await fetch('data/words.txt');
    if (!res.ok) throw new Error(`Dictionary request failed: ${res.status}`);
    dict = new Set((await res.text()).split('\n').map((w) => w.trim()).filter(Boolean));
    paintValidity(); // re-check in case a restored board was waiting on the dictionary
    checkWin();
  } catch {
    dict = null;
    paintValidity();
    $('dictErrorOverlay').classList.remove('hidden');
  }
}

// ------------------------------------------------------------ persistence
const STATE_KEY = 'ms-state';
function save() {
  if (TEST_DATE) return;
  const savedPlaced = drag?.source.type === 'board'
    ? { ...placed, [drag.source.k]: drag.tile }
    : placed;
  localStorage.setItem(STATE_KEY, JSON.stringify({
    date: TODAY, placed: savedPlaced, tray, started, elapsedMs, status, solveMs,
  }));
}
function restore(rack) {
  let st = null;
  if (!TEST_DATE) {
    try { st = JSON.parse(localStorage.getItem(STATE_KEY)); } catch { /* corrupt */ }
  }
  if (!st || st.date !== TODAY) {
    if (!TEST_DATE && !localStorage.getItem('ms-seen-help')) {
      localStorage.setItem('ms-seen-help', '1');
      $('helpOverlay').classList.remove('hidden');
    }
    return;
  }
  // Trust the save only if its tiles exactly cover today's rack.
  const savedTiles = [...Object.values(st.placed || {}), ...(st.tray || [])];
  const a = savedTiles.map((t) => t.letter).sort().join('');
  const b = rack.map((t) => t.letter).sort().join('');
  if (savedTiles.length !== RACK_SIZE || a !== b) return;
  placed = st.placed || {};
  tray = st.tray || [];
  started = Boolean(st.started);
  elapsedMs = st.elapsedMs || 0;
  status = st.status === 'done' ? 'done' : 'playing';
  solveMs = st.solveMs || 0;
  if (status === 'done') setTimeout(() => showResults(false), 400);
}

// ------------------------------------------------------------ timer
setInterval(() => {
  const now = Date.now();
  if (!TEST_DATE && now - lastDateCheck >= 1000) {
    lastDateCheck = now;
    if (nyDateStr(new Date(now)) !== TODAY) showDayRollover();
  }
  if (dayRolledOver) return;
  if (status !== 'playing' || !started) return;
  if (document.visibilityState === 'visible' && lastTick) {
    // cap the step so a throttled background tab can't dump hidden time
    // into the clock — the timer only counts while you're looking at it
    elapsedMs += Math.min(now - lastTick, 400);
  }
  lastTick = now;
  renderTimer();
  if (Math.floor(elapsedMs / 3000) !== Math.floor((elapsedMs - 200) / 3000)) save();
}, 100);
document.addEventListener('visibilitychange', () => { lastTick = Date.now(); });

function showDayRollover() {
  if (dayRolledOver) return;
  dayRolledOver = true;
  if (drag) onDragCancel();
  save();
  lastTick = 0;
  $('dayOverlay').classList.remove('hidden');
}

function renderTimer() {
  $('timer').textContent = formatTime(status === 'done' ? solveMs : elapsedMs);
}
function fmtPrecise(ms) {
  return `${formatTime(ms)}.${Math.floor(ms / 100) % 10}`;
}

// ------------------------------------------------------------ board camera
// The board always shows the whole crossword: fit the occupied bounding
// box (plus breathing room) into the viewport and center it. Tiles keep
// absolute plane coordinates; only this transform changes as it grows.
let view = { scale: 1, tx: 0, ty: 0 };
function updateFit(instant = false) {
  const rect = $('boardView').getBoundingClientRect();
  const b = bounds(placed) || { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  const M = 1.6; // empty cells of margin — room to drop the next tile
  const px = {
    x: (b.minX - M) * CELL, y: (b.minY - M) * CELL,
    w: (b.maxX - b.minX + 1 + 2 * M) * CELL, h: (b.maxY - b.minY + 1 + 2 * M) * CELL,
  };
  const scale = Math.min(rect.width / px.w, rect.height / px.h, 1.05);
  view = {
    scale,
    tx: (rect.width - px.w * scale) / 2 - px.x * scale,
    ty: (rect.height - px.h * scale) / 2 - px.y * scale,
  };
  const plane = $('plane');
  plane.classList.toggle('no-anim', instant);
  plane.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
  const gl = $('gridlines');
  gl.style.left = `${px.x}px`;
  gl.style.top = `${px.y}px`;
  gl.style.width = `${px.w}px`;
  gl.style.height = `${px.h}px`;
  gl.style.backgroundSize = `${CELL}px ${CELL}px`;
  $('firstHint').classList.toggle(
    'hidden',
    Object.keys(placed).length > 0 || status === 'done' || tray.length === 0,
  );
}
window.addEventListener('resize', () => updateFit());

function cellAt(clientX, clientY) {
  const rect = $('boardView').getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return null;
  }
  return {
    x: Math.floor((clientX - rect.left - view.tx) / view.scale / CELL),
    y: Math.floor((clientY - rect.top - view.ty) / view.scale / CELL),
  };
}

// ------------------------------------------------------------ rendering
function renderTray() {
  const trayEl = $('tray');
  trayEl.innerHTML = '';
  for (const t of tray) {
    const el = document.createElement('div');
    el.className = 'tile';
    el.textContent = t.letter;
    el.dataset.id = t.id;
    el.addEventListener('pointerdown', (e) => startDrag(e, el, { type: 'tray', id: t.id }));
    trayEl.appendChild(el);
  }
  trayEl.classList.toggle('empty', tray.length === 0);
}

function renderBoardTiles() {
  $('plane').querySelectorAll('.tile').forEach((el) => el.remove());
  for (const [k, t] of Object.entries(placed)) {
    const { x, y } = parseKey(k);
    const el = document.createElement('div');
    el.className = 'tile';
    el.textContent = t.letter;
    el.dataset.k = k;
    el.style.left = `${x * CELL + 3}px`;
    el.style.top = `${y * CELL + 3}px`;
    el.style.width = `${CELL - 6}px`;
    el.style.height = `${CELL - 6}px`;
    el.style.fontSize = '27px';
    if (status !== 'done') {
      el.addEventListener('pointerdown', (e) => startDrag(e, el, { type: 'board', k }));
    }
    $('plane').appendChild(el);
  }
}

// Live validation paint: red-glow tiles in invalid runs, status message,
// sap bucket level (valid, settled tiles fill the bucket).
function paintValidity() {
  const grid = letterGrid();
  const count = Object.keys(grid).length;
  const msg = $('statusMsg');
  msg.className = 'status-msg';
  if (!dict) {
    msg.textContent = 'Boiling up the word list…';
    return;
  }
  const { runs, badCells } = validate(grid, dict);
  $('plane').querySelectorAll('.tile').forEach((el) => {
    el.classList.toggle('bad', badCells.has(el.dataset.k));
  });
  const connected = isConnected(grid);
  const goodTiles = count - badCells.size;
  setBucket(status === 'done' ? 1 : (goodTiles / RACK_SIZE) * (connected ? 1 : 0.85));
  if (status === 'done') {
    msg.textContent = `Tapped in ${fmtPrecise(solveMs)} — see you at midnight 🍁`;
    return;
  }
  if (!started) {
    msg.textContent = 'Drag a tile anywhere to start the clock';
    return;
  }
  if (badCells.size > 0) {
    const bad = runs.find((r) => !r.valid);
    msg.classList.add('bad');
    msg.textContent = `“${bad.word}” isn't a word — rearrange!`;
  } else if (count >= 2 && !connected) {
    msg.classList.add('warn');
    msg.textContent = 'No islands — join everything into one crossword';
  } else if (tray.length > 0) {
    msg.textContent = `Looking good — ${tray.length} tile${tray.length === 1 ? '' : 's'} to go`;
  }
}

function setBucket(frac) {
  const h = 30 * Math.max(0, Math.min(1, frac));
  const sap = $('sap');
  sap.setAttribute('y', String(44 - h));
  sap.setAttribute('height', String(h));
}

// ------------------------------------------------------------ drag & drop
// One pointer, one tile. The dragged tile becomes a fixed-position ghost
// under the finger (lifted above it on touch so your thumb never hides
// it); a dashed cursor previews the snap cell; drop on a free cell to
// place, drop anywhere else to send the tile back to the rack.
let drag = null;

function startDrag(e, el, source) {
  if (status === 'done' || dayRolledOver || drag) return;
  e.preventDefault();
  const lift = e.pointerType === 'touch' ? 54 : 8;
  const ghost = el.cloneNode(true);
  ghost.className = 'tile drag-ghost';
  const size = 48;
  ghost.style.width = `${size}px`;
  ghost.style.height = `${size}px`;
  ghost.style.fontSize = '26px';
  document.body.appendChild(ghost);
  drag = {
    source, ghost, lift, size, moved: false,
    startX: e.clientX, startY: e.clientY,
  };
  // The source element must stay in the DOM until the drop — removing it
  // would release pointer capture and kill the drag mid-flight. It just
  // goes translucent; every path out of the drag re-renders from state.
  el.classList.add('ghosted');
  if (source.type === 'board') {
    drag.tile = placed[source.k];
    delete placed[source.k];   // lifted off the board — validation updates live
    paintValidity();
  } else {
    drag.tile = tray.find((t) => t.id === source.id);
  }
  try { el.setPointerCapture(e.pointerId); } catch { /* stale pointer id — drag still tracks via element events */ }
  el.addEventListener('pointermove', onDragMove);
  el.addEventListener('pointerup', onDragEnd);
  el.addEventListener('pointercancel', onDragCancel);
  moveGhost(e);
}

function moveGhost(e) {
  const { ghost, lift, size } = drag;
  ghost.style.left = `${e.clientX - size / 2}px`;
  ghost.style.top = `${e.clientY - size / 2 - lift}px`;
  const cell = cellAt(e.clientX, e.clientY - lift);
  const cursor = $('dropCursor');
  if (cell) {
    const k = key(cell.x, cell.y);
    cursor.classList.remove('hidden');
    cursor.classList.toggle('blocked', placed[k] !== undefined);
    cursor.style.left = `${cell.x * CELL + 2}px`;
    cursor.style.top = `${cell.y * CELL + 2}px`;
    cursor.style.width = `${CELL - 4}px`;
    cursor.style.height = `${CELL - 4}px`;
    drag.cell = placed[k] === undefined ? cell : null;
  } else {
    cursor.classList.add('hidden');
    drag.cell = null;
  }
}

function onDragMove(e) {
  if (!drag) return;
  if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6) {
    drag.moved = true;
  }
  moveGhost(e);
}

function endDragCleanup() {
  drag.ghost.remove();
  $('dropCursor').classList.add('hidden');
  drag = null;
}

function onDragCancel() {
  if (!drag) return;
  // put the tile back where it came from
  if (drag.source.type === 'board') placed[drag.source.k] = drag.tile;
  endDragCleanup();
  renderTray(); renderBoardTiles(); paintValidity(); updateFit();
}

function onDragEnd(e) {
  if (!drag) return;
  const { source, tile, cell, moved } = drag;
  if (!moved) {
    if (source.type === 'board') placed[source.k] = tile;
    endDragCleanup();
    renderTray();
    renderBoardTiles();
    updateFit();
    paintValidity();
    save();
    return;
  }
  endDragCleanup();
  if (cell) {
    // place on the board
    if (source.type === 'tray') tray = tray.filter((t) => t.id !== tile.id);
    placed[key(cell.x, cell.y)] = tile;
    if (!started) { started = true; lastTick = Date.now(); }
  } else if (source.type === 'board') {
    tray.push(tile);            // dragged off the board → back to the rack
  }
  // (tray→tray drop: nothing changed)
  renderTray();
  renderBoardTiles();
  updateFit();
  paintValidity();
  checkWin();
  save();
}

// ------------------------------------------------------------ win
function checkWin() {
  if (status !== 'playing' || !dict) return;
  if (!isSolved(letterGrid(), dict)) return;
  status = 'done';
  solveMs = elapsedMs;
  renderTimer();
  paintValidity();   // swap the status line to the tapped message
  save();
  recordStats();
  celebrate();
  setTimeout(() => showResults(true), 1900);
}

function celebrate() {
  setBucket(1);
  $('drip').classList.remove('hidden');
  const banner = $('tapped');
  banner.classList.remove('hidden');
  banner.classList.add('show');
  // tile wave
  const tiles = [...$('plane').querySelectorAll('.tile')];
  tiles.sort((p, q) => parseFloat(p.style.left) - parseFloat(q.style.left));
  tiles.forEach((el, i) => setTimeout(() => el.classList.add('wave'), i * 45));
  // falling leaves
  for (let i = 0; i < 36; i++) {
    const leaf = document.createElement('div');
    leaf.className = 'leaf';
    leaf.textContent = ['🍁', '🍂', '🍁'][i % 3];
    leaf.style.left = `${Math.random() * 100}vw`;
    leaf.style.fontSize = `${16 + Math.random() * 22}px`;
    leaf.style.animationDuration = `${1.8 + Math.random() * 2}s`;
    leaf.style.animationDelay = `${Math.random() * 0.9}s`;
    document.body.appendChild(leaf);
    setTimeout(() => leaf.remove(), 5200);
  }
}

// ------------------------------------------------------------ stats + streak
const STATS_KEY = 'ms-stats';
function loadStats() {
  try {
    return JSON.parse(localStorage.getItem(STATS_KEY)) ||
      { solved: 0, best: 0, cur: 0, max: 0, lastSolve: '' };
  } catch {
    return { solved: 0, best: 0, cur: 0, max: 0, lastSolve: '' };
  }
}
function recordStats() {
  if (TEST_DATE) return;
  const s = loadStats();
  if (s.lastSolve === TODAY) return; // guard double-count
  s.solved++;
  s.best = s.best ? Math.min(s.best, solveMs) : solveMs;
  s.cur = (s.lastSolve && daysBetween(s.lastSolve, TODAY) === 1) ? s.cur + 1 : 1;
  s.max = Math.max(s.max, s.cur);
  s.lastSolve = TODAY;
  localStorage.setItem(STATS_KEY, JSON.stringify(s));
}
function renderStats() {
  const s = loadStats();
  $('stSolved').textContent = s.solved;
  $('stBest').textContent = s.best ? fmtPrecise(s.best) : '–';
  $('stCur').textContent = s.cur;
  $('stMax').textContent = s.max;
}

// ------------------------------------------------------------ results modal
let countdownTimer;
function showResults(fresh) {
  renderStats();
  if (status === 'done') {
    $('resultCard').classList.remove('hidden');
    $('resultHead').textContent = `TAPPED in ${fmtPrecise(solveMs)}! 🍁`;
    const s = loadStats();
    $('resultSub').textContent =
      s.best && solveMs === s.best && s.solved > 1 ? 'A new personal best!' :
      `Personal best: ${s.best ? fmtPrecise(s.best) : '–'}`;
    $('finishedRow').classList.remove('hidden');
    clearInterval(countdownTimer);
    const tick = () => {
      const ms = msToNextNyMidnight();
      const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
      $('countdown').textContent =
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }
  $('statsOverlay').classList.remove('hidden');
  void retryPendingSubmit();
  updateLeaderboard(fresh);
}

// ------------------------------------------------------------ share
$('shareBtn').addEventListener('click', async () => {
  const grid = normalize(letterGrid());
  const b = bounds(grid);
  let rows = '';
  if (b && b.maxX <= 13) {
    for (let y = 0; y <= b.maxY; y++) {
      let row = '';
      for (let x = 0; x <= b.maxX; x++) row += grid[key(x, y)] !== undefined ? '🟧' : '⬛';
      rows += row + '\n';
    }
  }
  const streak = loadStats().cur;
  const text = `Maple Scramble #${DAY_NUM} — TAPPED in ${fmtPrecise(solveMs)} 🍁\n\n` +
    rows + (streak >= 2 ? `\n🔥 ${streak} days running\n` : '') +
    '\nhttps://play.btownbrief.com/maple-scramble/';
  try {
    if (navigator.share && /Mobi|Android|iPhone|iPad/.test(navigator.userAgent)) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
  } catch { /* user cancelled */ }
});

let toastTimer;
function toast(msg, ms = 1400) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

// ------------------------------------------------------------ modals
$('helpBtn').addEventListener('click', () => $('helpOverlay').classList.remove('hidden'));
$('statsBtn').addEventListener('click', () => showResults(false));
document.querySelectorAll('.overlay').forEach((ov) => {
  ov.addEventListener('click', (e) => {
    if (e.target === ov && ov.dataset.static === undefined) ov.classList.add('hidden');
  });
  ov.querySelector('[data-close]')?.addEventListener('click', () => ov.classList.add('hidden'));
});
$('dictRetryBtn').addEventListener('click', () => { void loadDictionary(); });
$('reloadBtn').addEventListener('click', () => location.reload());

// help-modal example: a tiny valid crossword
(() => {
  const rows = ['MAPLE', '⬚T⬚⬚⬚'];
  const ex = $('exGrid');
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'row';
    for (const ch of r) {
      const cell = document.createElement('div');
      if (ch === '⬚') { cell.className = 'cell'; } else { cell.className = 'tile'; cell.textContent = ch; }
      row.appendChild(cell);
    }
    ex.appendChild(row);
  }
})();

// ------------------------------------------------------------ leaderboard (monthly fastest tap)
// The shared backend keeps each player's highest score per month, so the
// submitted score is 36000 − deciseconds (engine.timeToPoints): faster
// solve → higher score, and the UI turns scores back into times.
const lbBox = $('lb'), lbList = $('lbList'), lbStatus = $('lbStatus');
const lbForm = $('lbForm'), lbNameInput = $('lbNameInput');
const lbThisBtn = $('lbThisBtn'), lbLastBtn = $('lbLastBtn'), lbRenameBtn = $('lbRenameBtn');
let lbMonthOffset = 0;

if (lbEnabled()) {
  lbBox.classList.remove('hidden');
  lbThisBtn.textContent = monthLabel(0);
  lbLastBtn.textContent = monthLabel(-1);
}

const SUBMIT_KEY = 'ms-lb-submitted';
const PENDING_SUBMIT_KEY = 'ms-pending-submit';
let pendingRetry = null;

function storePendingSubmit(points) {
  localStorage.setItem(PENDING_SUBMIT_KEY, JSON.stringify({ date: TODAY, points }));
}

function readPendingSubmit() {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_SUBMIT_KEY));
    if (!pending || typeof pending.date !== 'string' || !Number.isFinite(pending.points)) {
      localStorage.removeItem(PENDING_SUBMIT_KEY);
      return null;
    }
    return pending;
  } catch {
    localStorage.removeItem(PENDING_SUBMIT_KEY);
    return null;
  }
}

async function submitForCurrentPage(points) {
  if (nyDateStr() !== TODAY) {
    showDayRollover();
    return false;
  }
  await submitScore(points);
  return true;
}

function retryPendingSubmit() {
  if (pendingRetry) return pendingRetry;
  pendingRetry = (async () => {
    const pending = readPendingSubmit();
    if (!pending) return;
    const currentDate = nyDateStr();
    if (pending.date.slice(0, 7) !== currentDate.slice(0, 7)) {
      localStorage.removeItem(PENDING_SUBMIT_KEY);
      return;
    }
    if (TEST_DATE || !lbEnabled() || !getName() || currentDate !== TODAY) {
      if (!TEST_DATE && currentDate !== TODAY) showDayRollover();
      return;
    }
    try {
      if (await submitForCurrentPage(pending.points)) {
        localStorage.setItem(SUBMIT_KEY, pending.date);
        localStorage.removeItem(PENDING_SUBMIT_KEY);
      }
    } catch { /* stay queued until the next retry trigger */ }
  })().finally(() => { pendingRetry = null; });
  return pendingRetry;
}

async function updateLeaderboard(fresh) {
  if (!lbEnabled()) return;
  const points = timeToPoints(solveMs);
  const shouldSubmit = !TEST_DATE && fresh && status === 'done' && points > 0 &&
    localStorage.getItem(SUBMIT_KEY) !== TODAY;
  if (shouldSubmit && !getName()) {
    lbForm.classList.remove('hidden');
    lbRenameBtn.classList.add('hidden');
    lbStatus.textContent = 'Pick a name to join the monthly leaderboard!';
    lbList.innerHTML = '';
    lbForm.dataset.pendingScore = String(points);
    return;
  }
  if (shouldSubmit) {
    try {
      if (await submitForCurrentPage(points)) localStorage.setItem(SUBMIT_KEY, TODAY);
    } catch {
      storePendingSubmit(points);
    }
  }
  renderBoard();
}

async function renderBoard() {
  lbForm.classList.add('hidden');
  lbRenameBtn.classList.remove('hidden');
  lbStatus.textContent = 'Loading…';
  try {
    const rows = await fetchTop(lbMonthOffset);
    const me = playerId();
    lbList.innerHTML = '';
    rows.slice(0, 10).forEach((r, i) => {
      const li = document.createElement('li');
      if (r.player_id === me) li.className = 'me';
      const medal = ['🥇', '🥈', '🥉'][i];
      li.innerHTML = `<span class="rank">${medal || i + 1}</span><span class="nm"></span><span class="sc"></span>`;
      li.querySelector('.nm').textContent = r.name;
      li.querySelector('.sc').textContent = fmtPrecise(pointsToMs(r.score));
      lbList.appendChild(li);
    });
    const myRank = rows.findIndex((r) => r.player_id === me);
    lbStatus.textContent = rows.length === 0
      ? 'No taps yet this month — be the first!'
      : myRank >= 0 ? `You're #${myRank + 1} of ${rows.length} this month` : '';
  } catch {
    lbStatus.textContent = 'Leaderboard unavailable (offline?)';
  }
}

$('lbSaveBtn').addEventListener('click', async () => {
  const name = lbNameInput.value.trim();
  if (!name) { lbNameInput.focus(); return; }
  const pending = Number(lbForm.dataset.pendingScore || 0);
  lbForm.dataset.pendingScore = '';
  try {
    await renamePlayer(name);
    if (pending > 0) {
      if (await submitForCurrentPage(pending)) localStorage.setItem(SUBMIT_KEY, TODAY);
    }
  } catch {
    if (pending > 0) storePendingSubmit(pending);
  }
  renderBoard();
});
lbNameInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') $('lbSaveBtn').click();
});
lbRenameBtn.addEventListener('click', () => {
  lbNameInput.value = getName();
  lbForm.classList.remove('hidden');
  lbRenameBtn.classList.add('hidden');
  lbNameInput.focus();
});
lbThisBtn.addEventListener('click', () => {
  lbMonthOffset = 0;
  lbThisBtn.classList.add('sel');
  lbLastBtn.classList.remove('sel');
  renderBoard();
});
lbLastBtn.addEventListener('click', () => {
  lbMonthOffset = -1;
  lbLastBtn.classList.add('sel');
  lbThisBtn.classList.remove('sel');
  renderBoard();
});

window.addEventListener('online', () => { void retryPendingSubmit(); });

boot();
