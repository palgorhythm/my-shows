# My Shows

A day-by-day feed of small jazz, creative and experimental shows in Los Angeles, read straight from venue and label websites.

It is a static page with no server. A GitHub Action runs a few times a day, reads each calendar, and publishes one `events.json` next to the page.

## Using it

- Left and right arrows change the day; up and down move between that day's shows; Enter saves one.
- On a phone, swipe sideways for days and up and down for shows, and tap Save.
- Saved shows live in your browser only. Shows on each day are ordered by how much they resemble what you have saved.

## Running it locally

```
npm install
npm run scrape        # writes site/events.json
npm run serve         # http://localhost:4173
```

Test one source with `node scraper/index.mjs --only <id>`.

## Adding a source

Venues are in `scraper/venues.mjs`; labels, presenters and label rosters are in `scraper/sources.mjs`. Each entry names a reader from `scraper/methods/`. Sources marked `mixed` only keep bills that look like a fit.
