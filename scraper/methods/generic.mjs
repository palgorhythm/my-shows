// Generic calendar readers. Each returns an array of raw events:
// { title, start, url, venue, city, price, description }
// `start` can be anything lib.toLA understands.

import ical from 'node-ical';
import { fetchJson, fetchText, fetchDom } from '../lib.mjs';

/** Squarespace events collection: <collection url>?format=json */
export async function squarespaceJson(src) {
  const base = new URL(src.endpoint);
  const out = [];
  const seen = new Set();
  let url = src.endpoint;
  for (let page = 0; page < 6 && url; page++) {
    const json = await fetchJson(url);
    const items = [...(json.upcoming || []), ...(json.items || [])];
    for (const it of items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      const loc = it.location || {};
      out.push({
        title: it.title,
        start: it.startDate,
        url: it.fullUrl ? new URL(it.fullUrl, base.origin).href : src.url,
        venue: loc.addressTitle || undefined,
        city: loc.addressLine2 || undefined,
        description: it.excerpt || it.body || '',
        // full text, used only to decide whether a touring show is in LA
        where: [it.title, it.excerpt, it.body, ...String(it.body || '').matchAll(/href="([^"]+)"/g)].map((x) => (Array.isArray(x) ? x[1] : x)).filter(Boolean).join(' '),
      });
    }
    const next = json.pagination?.nextPage && json.pagination?.nextPageUrl;
    url = next ? new URL(json.pagination.nextPageUrl + '&format=json', base.origin).href : null;
  }
  return out;
}

/** iCalendar feed */
export async function ics(src) {
  const text = await fetchText(src.endpoint);
  const parsed = ical.sync.parseICS(text);
  const out = [];
  for (const item of Object.values(parsed)) {
    if (item.type !== 'VEVENT' || !item.start) continue;
    out.push({
      title: typeof item.summary === 'object' ? item.summary.val : item.summary,
      start: item.start,
      url: (typeof item.url === 'object' ? item.url.val : item.url) || src.url,
      venue: typeof item.location === 'string' ? item.location.split(',')[0] : undefined,
      city: typeof item.location === 'string' ? item.location : undefined,
      description: typeof item.description === 'object' ? item.description.val : item.description,
    });
  }
  return out;
}

function collectLdEvents(node, out) {
  if (!node) return;
  if (Array.isArray(node)) return node.forEach((n) => collectLdEvents(n, out));
  if (typeof node !== 'object') return;
  const types = [].concat(node['@type'] || []);
  if (types.some((t) => /Event$/.test(String(t))) && node.startDate) out.push(node);
  if (node['@graph']) collectLdEvents(node['@graph'], out);
  if (node.itemListElement) collectLdEvents(node.itemListElement, out);
  if (node.item) collectLdEvents(node.item, out);
  if (node.event) collectLdEvents(node.event, out);
  if (node.events) collectLdEvents(node.events, out);
}

export function ldToRaw(ld, src) {
  const loc = [].concat(ld.location || [])[0] || {};
  const addr = typeof loc.address === 'object' ? loc.address : {};
  const offer = [].concat(ld.offers || [])[0] || {};
  let price;
  if (offer.price != null && offer.price !== '') {
    price = Number(offer.price) === 0 ? 'Free' : `$${String(offer.price).replace(/\.00$/, '')}`;
  }
  return {
    title: ld.name,
    start: ld.startDate,
    url: ld.url || offer.url || src.url,
    venue: loc.name,
    city: addr.addressLocality || (typeof loc.address === 'string' ? loc.address : undefined),
    price,
    description: ld.description || '',
  };
}

/** schema.org Event blocks embedded in a page as JSON-LD */
export async function jsonld(src) {
  const urls = [].concat(src.endpoint);
  const out = [];
  for (const url of urls) {
    const $ = await fetchDom(url);
    const found = [];
    $('script[type="application/ld+json"]').each((_, node) => {
      try {
        collectLdEvents(JSON.parse($(node).contents().text()), found);
      } catch {
        // malformed block: skip it
      }
    });
    for (const ld of found) out.push(ldToRaw(ld, src));
  }
  return out;
}

/** WordPress "The Events Calendar" REST API */
export async function tribeRest(src) {
  const out = [];
  let url = src.endpoint;
  for (let page = 0; page < 8 && url; page++) {
    const json = await fetchJson(url);
    for (const ev of json.events || []) {
      const venue = Array.isArray(ev.venue) ? ev.venue[0] : ev.venue;
      out.push({
        title: ev.title,
        // start_date is wall-clock time in the site's own zone
        start: ev.start_date,
        zone: ev.timezone,
        url: ev.url,
        venue: venue?.venue,
        city: venue?.city,
        price: ev.cost || undefined,
        description: ev.excerpt || ev.description || '',
      });
    }
    url = json.next_rest_url || null;
  }
  return out;
}
