// Readers for sites that need their own handling.

import { fetchDom, fetchJson, htmlToText } from '../lib.mjs';

/** stonesthrow.com/events: worldwide tour dates grouped per artist */
export async function stonesThrow(src) {
  const $ = await fetchDom(src.endpoint);
  const out = [];
  $('div.tours__item').each((_, item) => {
    const artist = $(item).find('h2').first().text().trim();
    $(item).find('div.tours__item__row').not('.tours__item__heads').each((__, row) => {
      const cols = $(row).find('div.tours__item__row--col');
      const date = cols.eq(0).text().trim();
      const city = cols.eq(1).text().trim();
      const venue = cols.eq(2).text().trim();
      const href = cols.eq(3).find('a[href]').attr('href');
      if (!artist || !date) return;
      out.push({ title: artist, start: date, city, venue, url: href || src.url });
    });
  });
  return out;
}

/** dublab.com is a JS app; its events come from this JSON document keyed by site path */
export async function dublab(src) {
  const json = await fetchJson(src.endpoint);
  const paths = json['/events']?.featured || [];
  const out = [];
  for (const path of paths) {
    const ev = json[path];
    if (!ev?.event_start_date) continue;
    out.push({
      title: ev.title,
      start: `${ev.event_start_date}T${ev.event_start_time || '00:00:00'}`,
      url: 'https://www.dublab.com' + path,
      venue: ev.location_name,
      city: [ev.location_address1, ev.location_city].filter(Boolean).join(', '),
      description: ev.meta?.description || ev.content || '',
      image: ev.meta?.image,
    });
  }
  return out;
}

/** insheepsclothinghifi.com/events: upcoming and past share one markup, dates only */
export async function inSheepsClothing(src) {
  const $ = await fetchDom(src.endpoint);
  const out = [];
  const seen = new Set();
  $('article.type-event').each((_, art) => {
    const id = $(art).attr('id');
    if (seen.has(id)) return;
    seen.add(id);
    const link = $(art).find('h2 a').first();
    const date = $(art).find('time[datetime]').first().attr('datetime');
    const address = $(art).find('div.grid-row div.item-s-6 span').first().text().trim();
    if (!date || !link.text().trim()) return;
    out.push({
      title: link.text().trim(),
      start: date,
      url: link.attr('href') || src.url,
      venue: 'In Sheep\'s Clothing',
      image: $(art).find('img').first().attr('data-src') || $(art).find('img').first().attr('src'),
      city: address,
      description: address,
    });
  });
  return out;
}

// ---------- roster readers: each returns a list of artist names ----------

export async function bandcampArtists(r) {
  const $ = await fetchDom(r.url);
  return $('li.artists-grid-item .artists-grid-name').map((_, n) => $(n).text().trim()).get();
}

export async function squarespaceGallery(r) {
  const $ = await fetchDom(r.url);
  return $('img.thumb-image[alt]')
    .map((_, n) => htmlToText($(n).attr('alt'), 200))
    .get()
    .filter((name) => name && name.length < 60);
}

export async function linkText(r) {
  const $ = await fetchDom(r.url);
  return [...new Set($(r.selector).map((_, n) => $(n).text().trim()).get())];
}
