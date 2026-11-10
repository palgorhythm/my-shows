// Venue calendars. See sources.mjs for what each field means.

import { DateTime } from 'luxon';
import { squarespaceJson, tribeRest, ics, jsonld } from './methods/generic.mjs';
import {
  dice, diceVenuePage, wixEvents, pools, catalina, rhythmRoom, lodgeRoom, smellTitle,
  blueNote, bostonCourt, capUcla, redcat,
} from './methods/venue-readers.mjs';

const now = DateTime.now().setZone('America/Los_Angeles');
const today = now.toISODate();
const horizon = now.plus({ days: 120 }).toISODate();
const tribe = (origin) =>
  `${origin}/wp-json/tribe/events/v1/events?per_page=50&start_date=${today}&end_date=${horizon}`;

const venue = (v) => ({ kind: 'venue', ...v });

export const VENUES = [
  // ----- rooms where nearly every night fits -----
  venue({
    id: 'sam-first', name: 'Sam First', neighborhood: 'Westchester', genreFit: 'core',
    url: 'https://www.samfirstbar.com/',
    endpoint: 'https://www.samfirstbar.com/', eventPath: 'events', read: wixEvents,
  }),
  venue({
    id: 'world-stage', name: 'The World Stage', neighborhood: 'Leimert Park', genreFit: 'core',
    url: 'https://www.theworldstage.org/events.html',
    endpoint: 'https://tockify.com/api/feeds/ics/the.world.stage', read: ics, ownVenue: true,
    skip: /workshop|\bclass(es)?\b/i,
  }),
  venue({
    id: '2220-arts', name: '2220 Arts + Archives', neighborhood: 'Historic Filipinotown', genreFit: 'core',
    url: 'https://www.2220arts.org/events',
    page: 'https://www.2220arts.org/events', diceVenues: ['2220 Arts + Archives'], read: dice,
  }),
  venue({
    id: 'coaxial', name: 'Coaxial Arts', neighborhood: 'Downtown', genreFit: 'core',
    url: 'https://pools.events/o/coaxial_arts/',
    endpoint: 'https://pools.events/o/coaxial_arts/', read: pools, ownVenue: true,
  }),
  venue({
    id: 'oracle-egg', name: 'Oracle Egg', neighborhood: 'Downtown', genreFit: 'core',
    url: 'https://www.oracleegg.com/calendar',
    endpoint: 'https://www.oracleegg.com/calendar?format=json', read: squarespaceJson, ownVenue: true,
  }),
  venue({
    id: 'baked-potato', name: 'The Baked Potato', neighborhood: 'Studio City', genreFit: 'core',
    url: 'https://www.thebakedpotato.com/events-calendar/',
    endpoint: 'https://thebakedpotato.thundertix.com/', read: jsonld, ownVenue: true,
  }),
  venue({
    id: 'birds-of-a-feather', name: 'Birds of a Feather Jazz Lounge', neighborhood: 'Downtown', genreFit: 'core',
    url: 'https://www.birdsofafeatherjazzlounge.com/',
    endpoint: 'https://www.birdsofafeatherjazzlounge.com/', eventPath: 'event-details', read: wixEvents,
  }),

  // ----- rooms with mixed bookings: only bills that look like a fit are kept -----
  venue({
    id: 'high-low', name: 'The High Low', neighborhood: 'Atwater Village', genreFit: 'mixed',
    url: 'https://thehighlowbar.com/events/',
    endpoint: tribe('https://thehighlowbar.com'), read: tribeRest, ownVenue: true,
    skip: /karaoke|trivia|bingo/i,
    // Monday is the jazz night here, whatever the title says
    alwaysFits: (ev) => /^music mondays/i.test(ev.title),
  }),
  venue({
    id: 'human-resources', name: 'Human Resources', neighborhood: 'Chinatown', genreFit: 'mixed',
    url: 'https://www.h-r.la/',
    endpoint: tribe('https://www.h-r.la'), read: tribeRest, ownVenue: true,
  }),
  venue({
    id: 'alvas', name: 'Alvas Showroom', neighborhood: 'San Pedro', genreFit: 'mixed',
    url: 'https://alvasshowroom.com/',
    endpoint: tribe('https://alvasshowroom.com'), read: tribeRest, ownVenue: true,
  }),
  venue({
    id: 'zebulon', name: 'Zebulon', neighborhood: 'Frogtown', genreFit: 'mixed',
    url: 'https://zebulon.la/',
    page: 'https://zebulon.la/', diceVenues: ['Zebulon'], read: dice,
  }),
  venue({
    id: 'goldfish', name: 'The Goldfish', neighborhood: 'Highland Park', genreFit: 'mixed',
    url: 'https://www.thegoldfishla.com/events',
    page: 'https://www.thegoldfishla.com/events', diceVenues: ['The Goldfish'], read: dice,
  }),
  venue({
    id: 'scribble', name: 'Scribble', neighborhood: 'Highland Park', genreFit: 'mixed',
    url: 'https://dice.fm/venue/scribble-8qrv',
    endpoint: 'https://dice.fm/venue/scribble-8qrv', read: diceVenuePage,
  }),
  venue({
    id: 'lodge-room', name: 'Lodge Room', neighborhood: 'Highland Park', genreFit: 'mixed',
    url: 'https://www.lodgeroomhlp.com/',
    endpoint:
      'https://www.lodgeroomhlp.com/wp-json/wp/v2/shows?per_page=100&_fields=id,title,link,acf.date_and_time_of_show,acf.genre,acf.show_description,acf.show_image.url,acf.show_image.sizes.large',
    read: lodgeRoom,
  }),
  venue({
    id: 'catalina', name: 'Catalina Jazz Club', neighborhood: 'Hollywood', genreFit: 'core',
    url: 'https://catalinajazzclub.com/calendar/',
    endpoint: 'https://catalinajazzclub.com/', read: catalina,
  }),
  venue({
    id: 'vibrato', name: 'Vibrato Grill Jazz', neighborhood: 'Bel Air', genreFit: 'core',
    url: 'https://www.vibratogrilljazz.com/music',
    endpoint: 'https://www.vibratogrilljazz.com/music?format=json', read: squarespaceJson, ownVenue: true,
  }),
  venue({
    id: 'rhythm-room', name: 'Rhythm Room LA', neighborhood: 'Downtown', genreFit: 'mixed',
    url: 'https://www.rhythmroomla.com/musiccalendar',
    endpoint: 'https://www.rhythmroomla.com/api/open/GetItemsByMonth?collectionId=5c6e6cde652deaa4dc19f56f',
    read: rhythmRoom, skip: /^closed/i,
  }),
  venue({
    id: 'the-smell', name: 'The Smell', neighborhood: 'Downtown', genreFit: 'mixed',
    url: 'https://www.thesmell.org/events',
    endpoint: 'https://www.thesmell.org/events?format=json',
    read: async (src) => (await squarespaceJson(src)).map(smellTitle), ownVenue: true,
  }),
  venue({
    id: 'healing-force', name: 'Healing Force of the Universe', neighborhood: 'Pasadena', genreFit: 'core',
    url: 'https://healingforcerecords.com/events',
    endpoint: 'https://healingforcerecords.com/events?format=json', read: squarespaceJson,
  }),

  // ----- bigger or broader rooms -----
  venue({
    id: 'blue-note', name: 'Blue Note Los Angeles', neighborhood: 'Hollywood', genreFit: 'core',
    url: 'https://www.bluenotejazz.com/la/shows/',
    endpoint: 'https://www.bluenotejazz.com/la/shows/', read: blueNote,
  }),
  venue({
    id: 'boston-court', name: 'Boston Court Pasadena', neighborhood: 'Pasadena', genreFit: 'core',
    url: 'https://bostoncourtpasadena.org/music/',
    endpoint: 'https://bostoncourtpasadena.org/music/', read: bostonCourt,
  }),
  venue({
    id: 'cap-ucla', name: 'CAP UCLA', neighborhood: 'Westwood', genreFit: 'core',
    url: 'https://cap.ucla.edu/calendar',
    endpoint: 'https://cap.ucla.edu/calendar', read: capUcla, useRawVenue: true,
  }),
  venue({
    id: 'redcat', name: 'REDCAT', neighborhood: 'Downtown', genreFit: 'core',
    url: 'https://www.redcat.org/events',
    endpoint: 'https://www.redcat.org/events', read: redcat,
  }),
];
