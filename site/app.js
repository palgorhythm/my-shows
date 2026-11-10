const TZ = 'America/Los_Angeles';
const STORE_KEY = 'my-shows:v1';
const SWIPE_THRESHOLD = 60;

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of [].concat(children)) {
    if (child != null) node.append(child);
  }
  return node;
};

// ---------- state ----------

function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return { swipes: raw.swipes || {}, muted: !!raw.muted };
  } catch {
    return { swipes: {}, muted: false };
  }
}

const store = loadStore();
function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // private mode or full storage: the app still works for this visit
  }
}

let data = { events: [], sources: [], generatedAt: null };
let byDate = new Map();
let currentDate = todayLA();
let currentIndex = 0;

function todayLA() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

function shiftDate(iso, days) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function prettyDate(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric',
  }).format(d);
  const today = todayLA();
  if (iso === today) return 'Tonight, ' + label;
  if (iso === shiftDate(today, 1)) return 'Tomorrow, ' + label;
  return label;
}

// ---------- sound ----------

let audioCtx = null;
function tone(freq, start, dur, type = 'square', gain = 0.06) {
  const osc = audioCtx.createOscillator();
  const amp = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = audioCtx.currentTime + start;
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

const SOUNDS = {
  save: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.18, 'triangle', 0.09)),
  nope: () => { tone(330, 0, 0.09); tone(220, 0.08, 0.14); },
  undo: () => { tone(440, 0, 0.06, 'sine', 0.08); tone(587, 0.06, 0.08, 'sine', 0.08); },
  click: () => tone(880, 0, 0.03, 'square', 0.03),
};

function play(name) {
  if (store.muted) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    SOUNDS[name]();
  } catch {
    // no audio available: stay silent
  }
}

// ---------- rendering ----------

const isSaved = (ev) => store.swipes[ev.id]?.dir === 'right';

// ---------- ordering by taste ----------
// Shows on a day are ordered by how much they resemble what has been saved before:
// same room, and words from saved titles (mostly artist names; rarer words count more).

const COMMON = new Set(['the', 'and', 'with', 'for', 'from', 'feat', 'featuring', 'presents', 'live', 'show', 'night',
  'set', 'sets', 'early', 'late', 'release', 'album', 'record', 'music', 'los', 'angeles', 'doors', 'tickets', 'this',
  'that', 'will', 'his', 'her', 'their', 'has', 'have', 'are', 'was', 'you', 'your', 'our', 'all', 'ages', 'new']);

function words(text) {
  return String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !COMMON.has(w) && !/^\d+$/.test(w));
}

let taste = null;
function buildTaste() {
  const saved = Object.values(store.swipes).filter((s) => s.dir === 'right' && s.ev).map((s) => s.ev);
  if (!saved.length) { taste = null; return; }

  // how common each word is across everything listed, so rare words (names) weigh more
  const docCount = new Map();
  for (const ev of data.events) {
    for (const w of new Set(words(ev.title + ' ' + ev.description))) docCount.set(w, (docCount.get(w) || 0) + 1);
  }
  const total = Math.max(data.events.length, 1);
  const rarity = (w) => Math.log(1 + total / (1 + (docCount.get(w) || 0)));

  const venues = new Map();
  const liked = new Map();
  for (const ev of saved) {
    venues.set(ev.venue, (venues.get(ev.venue) || 0) + 1);
    for (const w of new Set(words(ev.title))) liked.set(w, (liked.get(w) || 0) + 1);
  }
  taste = { venues, liked, rarity, count: saved.length };
}

function tasteScore(ev) {
  if (!taste) return 0;
  let score = 3 * ((taste.venues.get(ev.venue) || 0) / taste.count);
  const inTitle = new Set(words(ev.title));
  const inDesc = new Set(words(ev.description));
  let wordScore = 0;
  for (const w of inTitle) if (taste.liked.has(w)) wordScore += taste.liked.get(w) * taste.rarity(w);
  // names from saved titles often turn up in another show's personnel list
  for (const w of inDesc) if (!inTitle.has(w) && taste.liked.has(w)) wordScore += 0.5 * taste.liked.get(w) * taste.rarity(w);
  score += wordScore / (taste.count * 4);
  return score;
}

// The order for the day on screen is fixed when the day opens, so saving a show
// does not shuffle the list under you.
let ordered = [];
function refreshOrder() {
  buildTaste();
  const list = byDate.get(currentDate) || [];
  ordered = list
    .map((ev, i) => ({ ev, i, score: tasteScore(ev) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.ev);
  $('status-left').textContent = taste ? 'Ordered by your saves' : 'Ordered by time. Save shows to teach it';
}

const showsFor = (date) => (date === currentDate ? ordered : byDate.get(date) || []);

function buildCard(ev) {
  const meta = el('p', { className: 'meta' }, [
    el('b', { textContent: 'When' }), ' ' + (ev.time || 'Time not listed'), el('br'),
    el('b', { textContent: 'Where' }), ' ' + (ev.venue || ev.sourceName || ''),
    ev.neighborhood ? ' (' + ev.neighborhood + ')' : '',
    ev.price ? el('br') : null,
    ev.price ? el('b', { textContent: 'Price' }) : null,
    ev.price ? ' ' + ev.price : null,
  ]);

  const body = el('div', { className: 'window-body' }, [
    el('h2', { textContent: ev.title }),
    meta,
    ev.description ? el('p', { className: 'desc', textContent: ev.description }) : null,
    ev.url ? el('a', { href: ev.url, target: '_blank', rel: 'noopener', textContent: 'Tickets and info' }) : null,
  ]);

  const card = el('article', { className: 'window card' }, [
    el('div', { className: 'title-bar' }, [
      el('div', { className: 'title-bar-text', textContent: ev.venue || ev.sourceName || 'Show' }),
    ]),
    body,
    isSaved(ev) ? el('div', { className: 'stamp save', textContent: 'SAVED' }) : null,
  ]);
  card.dataset.id = ev.id;
  return card;
}

function nextDateWithShows(from) {
  return [...byDate.keys()].sort().find((d) => d > from && showsFor(d).length > 0);
}

function render() {
  const all = showsFor(currentDate);
  currentIndex = Math.max(0, Math.min(currentIndex, all.length - 1));
  const ev = all[currentIndex];

  $('day-name').textContent = prettyDate(currentDate);
  $('day-count').textContent = all.length
    ? `Show ${currentIndex + 1} of ${all.length}`
    : 'No shows listed';
  $('date-picker').value = currentDate;

  const stack = $('stack');
  stack.replaceChildren();
  if (!ev) {
    const next = nextDateWithShows(currentDate);
    stack.append(el('div', { className: 'empty' }, [
      el('p', { textContent: 'Nothing listed for this day yet.' }),
      next ? el('button', { textContent: 'Jump to ' + prettyDate(next), onclick: () => goTo(next) }) : null,
    ]));
  } else {
    stack.append(buildCard(ev));
  }

  $('prev-show').disabled = !ev || currentIndex === 0;
  $('next-show').disabled = !ev || currentIndex >= all.length - 1;
  $('save-btn').disabled = !ev;
  $('save-btn').textContent = ev && isSaved(ev) ? '♥ Saved (undo)' : '♥ Save';
  renderSaved();
}

function renderSaved() {
  const saved = Object.values(store.swipes)
    .filter((s) => s.dir === 'right' && s.ev)
    .map((s) => s.ev)
    .sort((a, b) => (a.start || a.date).localeCompare(b.start || b.date));
  const today = todayLA();
  const upcoming = saved.filter((ev) => ev.date >= today);
  $('saved-count').textContent = upcoming.length;

  const list = $('saved-list');
  list.replaceChildren();
  if (!saved.length) {
    list.append(el('li', { textContent: 'Nothing saved yet. Press Enter or tap Save on a show to keep it here.' }));
    return;
  }
  let lastDate = null;
  for (const ev of [...upcoming, ...saved.filter((e) => e.date < today).reverse()]) {
    if (ev.date !== lastDate) {
      list.append(el('li', { className: 'day-head', textContent: prettyDate(ev.date) }));
      lastDate = ev.date;
    }
    list.append(el('li', { className: ev.date < today ? 'past' : '' }, [
      el('strong', { textContent: ev.title }),
      el('br'),
      `${ev.time || ''} at ${ev.venue || ev.sourceName || ''}`,
      el('div', { className: 'row-actions' }, [
        ev.url ? el('a', { href: ev.url, target: '_blank', rel: 'noopener', textContent: 'Tickets and info' }) : null,
        el('button', {
          textContent: 'Remove',
          onclick: () => { delete store.swipes[ev.id]; persist(); play('undo'); render(); },
        }),
      ]),
    ]));
  }
}

function renderSources() {
  $('sources-updated').textContent = data.generatedAt
    ? 'Last updated ' + new Date(data.generatedAt).toLocaleString()
    : '';
  const list = $('sources-list');
  list.replaceChildren();
  const sorted = [...data.sources].sort((a, b) => a.name.localeCompare(b.name));
  for (const src of sorted) {
    const text = src.ok ? `${src.count} upcoming` : 'could not be read this time';
    list.append(el('li', { className: src.ok ? '' : 'src-bad' }, [
      el('a', { href: src.url, target: '_blank', rel: 'noopener', textContent: src.name }),
      ` (${src.kind}): ${text}`,
    ]));
  }
}

// ---------- moving and saving ----------

function moveShow(step) {
  const all = showsFor(currentDate);
  const next = currentIndex + step;
  if (next < 0 || next >= all.length) return;
  currentIndex = next;
  play('click');
  render();
}

function toggleSave() {
  const ev = showsFor(currentDate)[currentIndex];
  if (!ev) return;
  if (isSaved(ev)) {
    delete store.swipes[ev.id];
    play('undo');
    $('status-right').textContent = 'Removed from saved';
  } else {
    store.swipes[ev.id] = { dir: 'right', at: Date.now(), ev };
    play('save');
    $('status-right').textContent = 'Saved';
  }
  persist();
  render();
}

/** Touch only: swipe sideways to change the day, up and down to move between shows. */
function attachTouch(stack) {
  let startX = 0, startY = 0, dx = 0, dy = 0, active = false;

  stack.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    active = true;
    startX = e.clientX;
    startY = e.clientY;
    dx = dy = 0;
  });

  stack.addEventListener('pointermove', (e) => {
    if (!active) return;
    dx = e.clientX - startX;
    dy = e.clientY - startY;
    const card = stack.querySelector('.card');
    if (!card) return;
    const sideways = Math.abs(dx) > Math.abs(dy);
    card.classList.remove('animating');
    card.style.transform = sideways ? `translateX(${dx}px)` : `translateY(${dy * 0.6}px)`;
  });

  const end = () => {
    if (!active) return;
    active = false;
    const sideways = Math.abs(dx) > Math.abs(dy);
    if (sideways && Math.abs(dx) >= SWIPE_THRESHOLD) {
      goTo(shiftDate(currentDate, dx < 0 ? 1 : -1));
    } else if (!sideways && Math.abs(dy) >= SWIPE_THRESHOLD) {
      const before = currentIndex;
      moveShow(dy < 0 ? 1 : -1);
      if (before === currentIndex) snapBack(stack);
    } else {
      snapBack(stack);
    }
  };
  stack.addEventListener('pointerup', end);
  stack.addEventListener('pointercancel', end);

  // a swipe that ends on the link should not open it
  stack.addEventListener('click', (e) => {
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { e.preventDefault(); dx = dy = 0; }
  }, true);
}

function snapBack(stack) {
  const card = stack.querySelector('.card');
  if (!card) return;
  card.classList.add('animating');
  card.style.transform = '';
}

// ---------- navigation and chrome ----------

function goTo(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  currentDate = date;
  currentIndex = 0;
  refreshOrder();
  play('click');
  render();
}

function toggleWindow(id, show) {
  const win = $(id);
  const willShow = show ?? win.classList.contains('hidden');
  for (const other of ['saved-window', 'sources-window', 'help-window']) {
    $(other).classList.add('hidden');
  }
  win.classList.toggle('hidden', !willShow);
  play('click');
}

function updateMute() {
  $('mute-btn').textContent = store.muted ? '\u{1F507}' : '\u{1F50A}';
}

function tick() {
  $('clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function wire() {
  $('prev-day').onclick = () => goTo(shiftDate(currentDate, -1));
  $('next-day').onclick = () => goTo(shiftDate(currentDate, 1));
  $('today-btn').onclick = () => goTo(todayLA());
  $('date-picker').onchange = (e) => goTo(e.target.value);
  $('prev-show').onclick = () => moveShow(-1);
  $('next-show').onclick = () => moveShow(1);
  $('save-btn').onclick = toggleSave;
  attachTouch($('stack'));
  $('tb-saved').onclick = () => toggleWindow('saved-window');
  $('tb-sources').onclick = () => { renderSources(); toggleWindow('sources-window'); };
  $('help-btn').onclick = () => toggleWindow('help-window');
  $('tb-home').onclick = () => toggleWindow('help-window', false);
  $('mute-btn').onclick = () => {
    store.muted = !store.muted;
    persist();
    updateMute();
    play('click');
  };
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.onclick = () => toggleWindow(btn.dataset.close, false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea') || e.metaKey || e.ctrlKey) return;
    if (e.key === 'ArrowLeft') goTo(shiftDate(currentDate, -1));
    else if (e.key === 'ArrowRight') goTo(shiftDate(currentDate, 1));
    else if (e.key === 'ArrowUp') moveShow(-1);
    else if (e.key === 'ArrowDown') moveShow(1);
    else if (e.key === 'Enter' && !e.target.closest('button, a')) toggleSave();
    else return;
    e.preventDefault();
  });
}

async function init() {
  wire();
  updateMute();
  tick();
  setInterval(tick, 20000);
  try {
    const res = await fetch('events.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  } catch (err) {
    $('day-name').textContent = 'Could not load shows';
    $('day-count').textContent = String(err.message || err);
    return;
  }
  byDate = new Map();
  for (const ev of data.events) {
    if (!byDate.has(ev.date)) byDate.set(ev.date, []);
    byDate.get(ev.date).push(ev);
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => (a.start || '').localeCompare(b.start || '') || a.title.localeCompare(b.title));
  }
  $('status-right').textContent = `${data.events.length} shows loaded`;
  refreshOrder();
  render();
}

init();
