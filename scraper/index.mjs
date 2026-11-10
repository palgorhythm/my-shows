// Reads every source in sources.mjs and writes site/events.json.
//   node scraper/index.mjs               all sources
//   node scraper/index.mjs --only <id>   one source, printed to the terminal

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DateTime } from 'luxon';
import { SOURCES, ROSTERS } from './sources.mjs';
import { TZ, toLA, norm, eventId, cleanTitle, htmlToText } from './lib.mjs';

const OUT = fileURLToPath(new URL('../site/events.json', import.meta.url));
const DAYS_AHEAD = 120;
const CONCURRENCY = 6;

// Words that suggest a bill fits, used only to sort out venues with mixed bookings.
const FIT_WORDS =
  /\b(jazz|improv\w*|experimental|avant\w*|free music|creative music|new music|fusion|quartet|quintet|trio|sextet|septet|octet|nonet|big band|ensemble|orchestra|ambient|drone|modular|synth\w*|electroacoustic|noise|minimalis\w*|composer|saxophon\w*|trumpet\w*|vibraphon\w*|pianist|bassist|drummer|percussion\w*|spiritual|afrobeat|bossa|samba|brazilian|soul jazz|beat scene|sound bath|deep listening|tape music|field recording\w*)\b/i;

const LA_WORDS =
  /\b(los angeles|l\.a\.|hollywood|highland park|echo park|silver ?lake|downtown la|dtla|pasadena|altadena|glendale|burbank|culver city|santa monica|venice|long beach|inglewood|leimert|koreatown|chinatown|boyle heights|frogtown|glassell park|eagle rock|mount washington|atwater|los feliz|studio city|north hollywood|san pedro|topanga|malibu|westwood|el sereno|lincoln heights|cypress park|arts district|west adams|mid-city|sherman oaks|van nuys|sun valley|compton|watts|torrance|el segundo|claremont|pomona|ojai|joshua tree)\b/i;

// Rooms that label feeds mention only in body text or ticket links.
const VENUE_HINTS = [
  [/lodge ?room/i, 'Lodge Room'],
  [/world ?stage/i, 'The World Stage'],
  [/zebulon/i, 'Zebulon'],
  [/2220 ?arts/i, '2220 Arts + Archives'],
  [/sam ?first/i, 'Sam First'],
  [/baked ?potato/i, 'The Baked Potato'],
  [/high ?low/i, 'The High Low'],
  [/masonic lodge/i, 'Masonic Lodge at Hollywood Forever'],
  [/regent/i, 'The Regent'],
  [/etaaa|\beta\b highland/i, 'ETA'],
];

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    }),
  );
  return results;
}

function normalize(raw, src, now) {
  const title = cleanTitle(raw.title);
  if (!title) return null;
  const dt = toLA(raw.start, raw.zone ? { zone: raw.zone } : undefined);
  if (!dt) return null;
  const today = now.startOf('day');
  if (dt < today || dt > today.plus({ days: DAYS_AHEAD })) return null;

  const description = htmlToText(raw.description);
  const whereText = raw.where ? htmlToText(raw.where, 6000) : '';
  const named = whereText.match(/\bVenue:\s*([^\n|]{3,60})/i);
  const hinted = src.kind === 'venue' ? null : VENUE_HINTS.find(([re]) => re.test(whereText));
  const venue = src.kind === 'venue'
    ? (src.useRawVenue && cleanTitle(raw.venue)) || src.name
    : cleanTitle(raw.venue) || (named ? named[1].trim() : '') || (hinted ? hinted[1] : '');

  if (src.laOnly) {
    const where = [raw.city, raw.venue, raw.title, description, whereText].filter(Boolean).join(' | ');
    if (!LA_WORDS.test(where) && !VENUE_HINTS.some(([re]) => re.test(where))) return null;
  }
  if (src.skip && src.skip.test(title)) return null;

  const date = dt.toISODate();
  const noTime = dt.hour === 0 && dt.minute === 0;
  return {
    id: eventId(src.id, date, title),
    title,
    date,
    start: dt.toISO({ suppressMilliseconds: true }),
    time: noTime ? '' : dt.toFormat('h:mm a'),
    venue,
    neighborhood: src.kind === 'venue' ? src.neighborhood || '' : '',
    url: raw.url || src.url,
    price: raw.price ? cleanTitle(String(raw.price)) : '',
    description,
    sourceId: src.id,
    sourceName: src.name,
    sourceKind: src.kind,
    // working fields, removed before the feed is written
    labels: src.kind === 'venue' ? [] : [src.name],
    mixed: src.genreFit === 'mixed',
    tags: raw.tags || '',
    forceFit: !!(src.alwaysFits && src.alwaysFits({ title })),
  };
}

async function runSource(src, now) {
  const started = Date.now();
  try {
    const raws = await src.read(src);
    const seen = new Set();
    const events = [];
    for (const raw of raws) {
      const ev = normalize(raw, src, now);
      if (!ev || seen.has(ev.id)) continue;
      seen.add(ev.id);
      events.push(ev);
    }
    console.log(`ok    ${src.id.padEnd(28)} ${String(events.length).padStart(3)} of ${raws.length} raw  (${Date.now() - started}ms)`);
    return { src, ok: true, events, rawCount: raws.length };
  } catch (err) {
    console.log(`FAIL  ${src.id.padEnd(28)} ${err.message}`);
    return { src, ok: false, events: [], error: String(err.message || err) };
  }
}

const STOP = new Set(['the', 'and', 'with', 'at', 'in', 'of', 'a', 'presents', 'present', 'live', 'feat', 'featuring', 'ft', 'show', 'night', 'la', 'los', 'angeles', 'early', 'late', 'set', 'pm', 'residency']);
function tokens(s) {
  return new Set(norm(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t)));
}

function sameShow(a, b) {
  if (a.date !== b.date) return false;
  const na = norm(a.title), nb = norm(b.title);
  if (!na || !nb) return false;
  const va = norm(a.venue), vb = norm(b.venue);
  const venuesKnown = va && vb;
  const venueMatch = venuesKnown && (va.includes(vb) || vb.includes(va));
  if (venuesKnown && !venueMatch) return false;
  if (na === nb) return true;
  const ta = tokens(a.title), tb = tokens(b.title);
  if (!ta.size || !tb.size) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const overlap = shared / Math.min(ta.size, tb.size);
  // same room and same night needs less agreement than an unknown room
  return venueMatch ? overlap >= 0.6 && shared >= 1 : overlap >= 0.8 && shared >= 2;
}

/** Fold the same show seen in several sources into one, preferring the venue's own listing. */
function dedupe(events) {
  const rank = (ev) => (ev.sourceKind === 'venue' ? 0 : 1);
  const sorted = [...events].sort((a, b) => rank(a) - rank(b));
  const kept = [];
  const byDate = new Map();
  for (const ev of sorted) {
    const sameDay = byDate.get(ev.date) || [];
    const dupe = sameDay.find((k) => k.sourceId !== ev.sourceId && sameShow(k, ev));
    if (dupe) {
      dupe.labels = [...new Set([...dupe.labels, ...ev.labels])];
      if (!dupe.description && ev.description) dupe.description = ev.description;
      if (!dupe.price && ev.price) dupe.price = ev.price;
      if (!dupe.time && ev.time) { dupe.time = ev.time; dupe.start = ev.start; }
      continue;
    }
    kept.push(ev);
    sameDay.push(ev);
    byDate.set(ev.date, sameDay);
  }
  return kept;
}

async function loadRosters() {
  const results = await pool(ROSTERS, CONCURRENCY, async (r) => {
    try {
      const names = (await r.read(r)).map((n) => cleanTitle(n)).filter(Boolean);
      console.log(`ok    roster:${r.label.padEnd(21)} ${String(names.length).padStart(3)} artists`);
      return { label: r.label, names };
    } catch (err) {
      console.log(`FAIL  roster:${r.label.padEnd(21)} ${err.message}`);
      return { label: r.label, names: [], error: String(err.message || err) };
    }
  });
  return results;
}

function badgeFromRosters(events, rosters) {
  const matchers = [];
  for (const { label, names } of rosters) {
    for (const name of names) {
      const n = norm(name);
      // very short or one-word names match too many unrelated titles
      if (n.length < 5) continue;
      const oneWord = !n.includes(' ');
      if (oneWord && n.length < 7) continue;
      matchers.push({ label, re: new RegExp(`(^| )${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`), titleOnly: oneWord });
    }
  }
  for (const ev of events) {
    const title = norm(ev.title);
    const full = title + ' ' + norm(ev.description);
    for (const m of matchers) {
      if (ev.labels.includes(m.label)) continue;
      if (m.re.test(m.titleOnly ? title : full)) ev.labels.push(m.label);
    }
  }
}

async function main() {
  const onlyIdx = process.argv.indexOf('--only');
  const only = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null;
  const now = DateTime.now().setZone(TZ);
  const sources = only ? SOURCES.filter((s) => s.id === only) : SOURCES;
  if (!sources.length) throw new Error(`No source with id "${only}"`);

  const results = await pool(sources, CONCURRENCY, (src) => runSource(src, now));

  if (only) {
    for (const ev of results[0].events) {
      console.log(`${ev.date} ${ev.time.padStart(8)}  ${ev.title}  @ ${ev.venue}  ${ev.price}`);
    }
    if (results[0].error) process.exitCode = 1;
    return;
  }

  let events = dedupe(results.flatMap((r) => r.events));
  const rosters = await loadRosters();
  badgeFromRosters(events, rosters);

  // Venues with mixed bookings only keep bills that look like a fit.
  const before = events.length;
  events = events.filter((ev) => {
    // a label artist on the bill counts as a fit, as does any jazz-type wording
    const onLabel = ev.labels.some((l) => l !== ev.sourceName);
    const fits = !ev.mixed || ev.forceFit || onLabel || FIT_WORDS.test(`${ev.title} ${ev.description} ${ev.tags}`);
    delete ev.mixed;
    delete ev.tags;
    delete ev.forceFit;
    delete ev.labels;
    return fits;
  });
  events.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));

  const out = {
    generatedAt: new Date().toISOString(),
    sources: results.map((r) => ({
      id: r.src.id,
      name: r.src.name,
      kind: r.src.kind,
      url: r.src.url,
      ok: r.ok,
      count: events.filter((e) => e.sourceId === r.src.id).length,
    })),
    events,
  };
  await writeFile(OUT, JSON.stringify(out));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${events.length} events written (${before - events.length} dropped from mixed venues), ${failed.length} of ${results.length} sources failed`);
  if (!events.length) {
    console.error('No events at all: refusing to publish an empty feed.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
