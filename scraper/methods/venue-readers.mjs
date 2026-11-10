// Readers for venue sites that are not plain Squarespace / Events Calendar / JSON-LD.

import { DateTime } from 'luxon';
import { fetchText, fetchJson, fetchDom, htmlToText, TZ } from '../lib.mjs';
import { ldToRaw } from './generic.mjs';

const decodeEntities = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** A month and day with no year: pick the next occurrence (allowing a little past). */
export function inferYear(month, day, now = DateTime.now().setZone(TZ)) {
  let dt = DateTime.fromObject({ year: now.year, month, day }, { zone: TZ });
  if (dt < now.minus({ days: 60 })) dt = dt.plus({ years: 1 });
  return dt;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export const monthNum = (name) => MONTHS.indexOf(String(name).trim().slice(0, 3).toLowerCase()) + 1;

/** "8:30 pm" / "8pm" on a given day */
export function withClock(day, clock) {
  const m = String(clock || '').match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!m) return day;
  let hour = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) hour += 12;
  return day.set({ hour, minute: Number(m[2] || 0) });
}

function money(cents) {
  if (cents == null) return undefined;
  return cents === 0 ? 'Free' : '$' + (cents / 100).toFixed(2).replace(/\.00$/, '');
}

/**
 * DICE event list widget. The venue's own page carries a public widget key, which we read
 * at run time (src.page) so nothing needs updating if the venue rotates it.
 */
export async function dice(src) {
  const page = decodeEntities(await fetchText(src.page));
  const key = page.match(/apiKey["']?\s*:\s*["']([\w-]{20,})["']/)?.[1];
  if (!key) throw new Error('DICE widget key not found on ' + src.page);
  const out = [];
  for (const venueName of src.diceVenues) {
    let url =
      'https://partners-endpoint.dice.fm/api/v2/events?page[size]=100&types=linkout,event&filter[venues][]=' +
      encodeURIComponent(venueName);
    for (let page = 0; page < 4 && url; page++) {
      const json = await fetchJson(url, { headers: { 'x-api-key': key } });
      for (const ev of json.data || []) {
        const prices = (ev.ticket_types || []).map((t) => t.price?.total).filter((p) => p != null);
        out.push({
          title: ev.name,
          start: ev.date,
          url: ev.url,
          venue: ev.venue,
          price: prices.length ? money(Math.min(...prices)) : undefined,
          description: ev.raw_description || ev.description || '',
          tags: [...(ev.genre_tags || []), ...(ev.type_tags || [])].join(' '),
        });
      }
      const next = json.links?.next;
      url = next ? next.replace('events-api.dice.fm', 'partners-endpoint.dice.fm') : null;
    }
  }
  return out;
}

/** A venue's public page on dice.fm (for rooms with no site of their own) */
export async function diceVenuePage(src) {
  const html = await fetchText(src.endpoint);
  const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!raw) throw new Error('No page data on ' + src.endpoint);
  const sections = JSON.parse(raw).props?.pageProps?.profile?.sections || [];
  const out = [];
  for (const section of sections) {
    for (const item of section.items || []) {
      const ev = item.event;
      if (!ev?.dates?.event_start_date) continue;
      out.push({
        title: ev.name,
        start: ev.dates.event_start_date,
        url: ev.perm_name ? `https://dice.fm/event/${ev.perm_name}` : src.url,
        price: typeof ev.price?.amount === 'number' ? money(ev.price.amount) : undefined,
        description: ev.about?.description || '',
      });
    }
  }
  return out;
}

/** Wix Events widget: the event list is embedded in the page as JSON */
export async function wixEvents(src) {
  const html = await fetchText(src.endpoint);
  const raw = html.match(/<script type="application\/json" id="wix-warmup-data">([\s\S]*?)<\/script>/)?.[1];
  if (!raw) throw new Error('No Wix data on ' + src.endpoint);
  const apps = JSON.parse(raw).appsWarmupData || {};
  const out = [];
  for (const app of Object.values(apps)) {
    for (const widget of Object.values(app || {})) {
      for (const ev of widget?.events?.events || []) {
        const start = ev.scheduling?.config?.startDate;
        if (!start) continue;
        const low = ev.registration?.ticketing?.lowestPrice;
        out.push({
          title: ev.title,
          start,
          url: `${new URL(src.endpoint).origin}/${src.eventPath}/${ev.slug}`,
          price: low || undefined,
          description: ev.description || ev.about || '',
        });
      }
    }
  }
  return out;
}

/** pools.events organization page; exact times come from each event's own page */
export async function pools(src) {
  const $ = await fetchDom(src.endpoint);
  const links = [...new Set($("div.ticketCard a[href^='/event/']").map((_, a) => $(a).attr('href')).get())].slice(0, 30);
  const out = [];
  for (const href of links) {
    const url = 'https://pools.events' + href;
    try {
      const $$ = await fetchDom(url);
      $$('script[type="application/ld+json"]').each((_, node) => {
        try {
          const ld = JSON.parse($$(node).contents().text());
          for (const one of [].concat(ld)) {
            if (/Event$/.test(String(one['@type'])) && one.startDate) out.push({ ...ldToRaw(one, src), url });
          }
        } catch {
          // skip a malformed block
        }
      });
    } catch {
      // one bad detail page should not lose the rest
    }
  }
  return out;
}

/** Catalina Jazz Club homepage list: month and day with no year */
export async function catalina(src) {
  const $ = await fetchDom(src.endpoint);
  const out = [];
  $('#tw-responsive div.tw-section').each((_, sec) => {
    const s = $(sec);
    const month = monthNum(s.find('.name-of-month').first().text());
    const day = Number(s.find('.date-of-month').first().text().trim());
    const link = s.find('.tw-name a').first();
    if (!month || !day || !link.text().trim()) return;
    const show = s.find('.tw-event-time').first().text() || s.find('.tw-event-door-time').first().text();
    out.push({
      title: link.text().trim(),
      start: withClock(inferYear(month, day), show),
      url: link.attr('href') || src.url,
      price: s.find('.tw-price').first().text().trim() || undefined,
    });
  });
  return out;
}

/** Rhythm Room LA: Squarespace calendar block, one request per month */
export async function rhythmRoom(src) {
  const now = DateTime.now().setZone(TZ);
  const out = [];
  for (const dt of [now, now.plus({ months: 1 }), now.plus({ months: 2 })]) {
    const url = `${src.endpoint}&month=${dt.toFormat('LLLL-yyyy')}`;
    const items = await fetchJson(url);
    for (const it of Array.isArray(items) ? items : []) {
      out.push({
        title: String(it.title || '').replace(/\s+\d{1,2}(:\d{2})?\s*[AP]M\s*-\s*\d{1,2}(:\d{2})?\s*[AP]M\s*$/i, ''),
        start: it.structuredContent?.startDate ?? it.startDate,
        url: it.fullUrl ? new URL(it.fullUrl, src.url).href : src.url,
        description: it.excerpt || '',
      });
    }
  }
  return out;
}

/** Lodge Room: WordPress "shows" posts with the date in a custom field */
export async function lodgeRoom(src) {
  const out = [];
  for (let page = 1; page <= 6; page++) {
    let posts;
    try {
      posts = await fetchJson(`${src.endpoint}&page=${page}`, { retries: 0 });
    } catch (err) {
      if (page === 1) throw err;
      break; // past the last page
    }
    if (!Array.isArray(posts) || !posts.length) break;
    for (const post of posts) {
      const when = post.acf?.date_and_time_of_show;
      if (!when) continue;
      let dt = DateTime.fromFormat(when.trim(), 'MM/dd/yyyy h:mm a', { zone: TZ });
      if (!dt.isValid) dt = DateTime.fromFormat(when.trim(), 'MM/dd/yyyy', { zone: TZ });
      if (!dt.isValid) continue;
      out.push({
        title: post.title?.rendered,
        start: dt,
        url: post.link,
        description: post.acf?.show_description || '',
        tags: post.acf?.genre ? String(post.acf.genre) : '',
      });
    }
    if (posts.length < 100) break;
  }
  return out;
}

/** The Smell: the Squarespace title is just the date, so the bill comes from the body */
export function smellTitle(raw) {
  const text = htmlToText(raw.description, 600).replace(/\n/g, ' / ');
  const bill = text.split(/\s*\/\s*(?=\d{1,2}(:\d{2})?\s*[ap]m)/i)[0];
  return { ...raw, title: bill || raw.title };
}

/** Blue Note LA: month calendar pages, date built from the cell's day number */
export async function blueNote(src) {
  const now = DateTime.now().setZone(TZ);
  const out = [];
  for (const dt of [now, now.plus({ months: 1 }), now.plus({ months: 2 }), now.plus({ months: 3 })]) {
    const $ = await fetchDom(`${src.endpoint}?calendar_view&month=${dt.month}&yr=${dt.year}`);
    $('td div.inner').each((_, cell) => {
      const day = Number($(cell).find('div.day').first().text().trim());
      if (!day) return;
      $(cell).find('div.day-wrap').each((__, wrap) => {
        const link = $(wrap).find('h3 a').first();
        if (!link.text().trim()) return;
        const base = DateTime.fromObject({ year: dt.year, month: dt.month, day }, { zone: TZ });
        const times = $(wrap).find('.showtimes time').map((___, t) => $(t).text().trim()).get();
        out.push({
          title: link.text().trim(),
          start: withClock(base, times[0]),
          url: link.attr('href') || src.url,
          description: [times.length > 1 ? 'Sets at ' + times.join(' and ') : '', $(wrap).find('.venue').text().trim()]
            .filter(Boolean).join('. '),
        });
      });
    });
  }
  return out;
}

/** Boston Court Pasadena music page: "NOV 12, 8PM", no year */
export async function bostonCourt(src) {
  const $ = await fetchDom(src.endpoint);
  const out = [];
  $('div.event-panel').each((_, panel) => {
    const p = $(panel);
    const when = p.find('.event-content h3').first().text().trim();
    const m = when.match(/([A-Za-z]{3,})\.?\s+(\d{1,2})/);
    const title = p.find('.event-content h2').first().text().trim();
    if (!m || !monthNum(m[1]) || !title) return;
    out.push({
      title,
      start: withClock(inferYear(monthNum(m[1]), Number(m[2])), when.split(',').slice(1).join(',')),
      url: p.find('a.d-block').attr('href') || src.url,
      description: p.find('.event-content p').first().html() || '',
    });
  });
  return out;
}

/** CAP UCLA calendar: live performances only; the datetime is local time mislabeled as UTC */
export async function capUcla(src) {
  const $ = await fetchDom(src.endpoint);
  const out = [];
  $("a.views-row[href^='/event/']").each((_, row) => {
    const r = $(row);
    const field = (name) => r.find(`.views-field-field-event-${name} .field-content`).first().text().replace(/\s+/g, ' ').trim();
    if (!/live performance/i.test(field('type'))) return;
    const stamp = r.find('.views-field-field-event-date time[datetime]').attr('datetime');
    if (!stamp) return;
    const hasTime = /\d\s*(am|pm)/i.test(field('date')) && !/T04:00:00/.test(stamp);
    const local = stamp.replace(/Z$/, '');
    const artist = field('artist');
    const work = field('title');
    out.push({
      title: [artist, work].filter(Boolean).join(': '),
      start: hasTime ? local : local.slice(0, 10),
      url: new URL(r.attr('href'), src.endpoint).href,
      venue: field('venue'),
      description: [field('venue'), field('genre')].filter(Boolean).join('. '),
      tags: field('genre'),
    });
  });
  return out;
}

/** REDCAT events: music and mixed-discipline cards; dates are ranges with no year or time */
export async function redcat(src) {
  const $ = await fetchDom(src.endpoint);
  const out = [];
  $('a.event-card-stacked').each((_, card) => {
    const c = $(card);
    const metier = c.find('.metier').first().text().trim();
    if (!/music|multiple/i.test(metier)) return;
    const m = c.find('.field--name-field-dates').first().text().match(/([A-Za-z]{3,})\s+(\d{1,2})/);
    const name = c.find('.title .pl-6').first().text().replace(/\s+/g, ' ').trim();
    const artist = c.find('.artist').first().text().replace(/\s+/g, ' ').trim();
    if (!m || !monthNum(m[1]) || !(name || artist)) return;
    out.push({
      title: [artist, name].filter(Boolean).join(': '),
      start: inferYear(monthNum(m[1]), Number(m[2])),
      url: new URL(c.attr('href'), src.endpoint).href,
      description: `${metier}. ${c.find('.field--name-field-dates').first().text().trim()}`,
      tags: metier,
    });
  });
  return out;
}
