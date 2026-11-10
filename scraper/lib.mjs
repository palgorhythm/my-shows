import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { DateTime } from 'luxon';

export const TZ = 'America/Los_Angeles';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export async function fetchText(url, { headers = {}, timeoutMs = 25000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

export async function fetchJson(url, opts = {}) {
  const tries = (opts.retries ?? 1) + 1;
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const text = await fetchText(url, { ...opts, retries: 0, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
      return JSON.parse(text);
    } catch (err) {
      // a challenge page instead of JSON is often gone a few seconds later
      lastErr = err;
      if (attempt < tries - 1) await new Promise((r) => setTimeout(r, 4000));
    }
  }
  throw lastErr;
}

export async function fetchDom(url, opts) {
  return cheerio.load(await fetchText(url, opts));
}

export function htmlToText(html, max = 420) {
  if (!html) return '';
  const withBreaks = String(html).replace(/<(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, '\n');
  const text = cheerio.load(`<div>${withBreaks}</div>`)('div').first().text();
  const clean = text
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/\s+\S*$/, '') + '...';
}

export function cleanTitle(s) {
  return htmlToText(s, 200).replace(/\s+/g, ' ').trim();
}

/**
 * Turn whatever a source gives us into a luxon DateTime in LA time.
 * Strings without an offset are read as LA wall-clock time.
 */
export function toLA(value, { zone = TZ } = {}) {
  if (value == null || value === '') return null;
  let dt;
  if (DateTime.isDateTime(value)) dt = value;
  else if (value instanceof Date) dt = DateTime.fromJSDate(value);
  else if (typeof value === 'number') dt = DateTime.fromMillis(value < 1e12 ? value * 1000 : value);
  else {
    const s = String(value).trim();
    dt = DateTime.fromISO(s, { zone, setZone: false });
    if (!dt.isValid) dt = DateTime.fromSQL(s, { zone });
    if (!dt.isValid) dt = DateTime.fromRFC2822(s);
    if (!dt.isValid) {
      const ms = Date.parse(s);
      if (!Number.isNaN(ms)) dt = DateTime.fromMillis(ms);
    }
  }
  return dt && dt.isValid ? dt.setZone(TZ) : null;
}

export function norm(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function eventId(sourceId, date, title) {
  return createHash('sha1').update(`${sourceId}|${date}|${norm(title)}`).digest('hex').slice(0, 12);
}

export function slug(s) {
  return norm(s).replace(/ /g, '-');
}
