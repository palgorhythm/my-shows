// Every place the feed reads from.
//
// A source:
//   id, name, url     what it is and where a person would look
//   kind              'venue' | 'label' | 'presenter' | 'series'
//   genreFit          'core'  keep everything
//                     'mixed' keep only bills that look like a fit (see FIT_WORDS in index.mjs)
//   laOnly            true for feeds that also list shows outside Los Angeles
//   read(src)         returns raw events; endpoint is whatever that reader needs

import { DateTime } from 'luxon';
import { squarespaceJson, tribeRest } from './methods/generic.mjs';
import {
  stonesThrow, dublab, inSheepsClothing,
  bandcampArtists, squarespaceGallery, linkText,
} from './methods/custom.mjs';
import { VENUES } from './venues.mjs';

const today = DateTime.now().setZone('America/Los_Angeles').toISODate();
const tribe = (origin) => `${origin}/wp-json/tribe/events/v1/events?per_page=50&start_date=${today}`;

const LABELS = [
  {
    id: 'living-earth', name: 'Living Earth', kind: 'presenter', genreFit: 'core',
    url: 'https://www.livingearth.la/gatherings',
    endpoint: 'https://www.livingearth.la/gatherings?format=json', read: squarespaceJson,
  },
  {
    id: 'minaret', name: 'Minaret Records', kind: 'label', genreFit: 'core', laOnly: true,
    url: 'https://www.minaretrecords.com/shows',
    endpoint: 'https://www.minaretrecords.com/shows?format=json', read: squarespaceJson,
  },
  {
    id: 'jazz-is-dead', name: 'Jazz Is Dead', kind: 'label', genreFit: 'core', laOnly: true,
    url: 'https://www.jazzisdead.com/events',
    endpoint: 'https://www.jazzisdead.com/uploadevents?format=json', read: squarespaceJson,
  },
  {
    // the collection slug carries the year and will need updating each January
    id: 'artdontsleep', name: 'ArtDontSleep', kind: 'presenter', genreFit: 'core', laOnly: true,
    url: 'https://www.artdontsleep.com/events',
    endpoint: 'https://www.artdontsleep.com/2026-events?format=json', read: squarespaceJson,
  },
  {
    id: 'intl-anthem', name: 'International Anthem', kind: 'label', genreFit: 'core', laOnly: true,
    url: 'https://www.intlanthem.com/events',
    endpoint: 'https://www.intlanthem.com/events?format=json', read: squarespaceJson,
  },
  {
    id: 'stones-throw', name: 'Stones Throw', kind: 'label', genreFit: 'mixed', laOnly: true,
    url: 'https://www.stonesthrow.com/events',
    endpoint: 'https://www.stonesthrow.com/events', read: stonesThrow,
  },
  {
    id: 'dublab', name: 'dublab', kind: 'presenter', genreFit: 'mixed',
    url: 'https://www.dublab.com/events',
    endpoint: 'https://dublab.wpengine.com/wp-json/lazystate/v1/events', read: dublab,
  },
  {
    id: 'in-sheeps-clothing', name: "In Sheep's Clothing", kind: 'presenter', genreFit: 'mixed',
    url: 'https://insheepsclothinghifi.com/events',
    endpoint: 'https://insheepsclothinghifi.com/events', read: inSheepsClothing,
  },
  {
    id: 'la-jazz-society', name: 'LA Jazz Society', kind: 'presenter', genreFit: 'core',
    url: 'https://lajazz.org/events/',
    endpoint: tribe('https://lajazz.org'), read: tribeRest,
  },
  {
    id: 'angel-city', name: 'Angel City Arts', kind: 'presenter', genreFit: 'core',
    url: 'https://angelcityjazz.com/events/',
    endpoint: tribe('https://angelcityjazz.com'), read: tribeRest,
  },
  {
    id: 'piano-spheres', name: 'Piano Spheres', kind: 'series', genreFit: 'core',
    url: 'https://pianospheres.org/events/',
    endpoint: tribe('https://pianospheres.org'), read: tribeRest,
  },
];

export const SOURCES = [...VENUES, ...LABELS];

// Label rosters: at venues with mixed bookings, a bill with one of these artists on it is kept.
const bandcamp = (label, sub) => ({ label, url: `https://${sub}.bandcamp.com/artists`, read: bandcampArtists });

export const ROSTERS = [
  bandcamp('Leaving Records', 'leavingrecords'),
  bandcamp('Jazz Is Dead', 'jazzisdead'),
  bandcamp('Minaret Records', 'minaretrecords'),
  bandcamp('Brainfeeder', 'brainfeeder'),
  bandcamp('Stones Throw', 'stonesthrow'),
  bandcamp('Alpha Pup', 'alphapup'),
  bandcamp('Black Editions', 'blackeditions'),
  bandcamp('Preference Records', 'preferencerecords'),
  bandcamp('AKP Recordings', 'akprecordings'),
  bandcamp('Not Not Fun', 'notnotfun'),
  bandcamp('Dome of Doom', 'domeofdoom'),
  bandcamp('BIG EGO', 'musicfrombigego'),
  bandcamp("Dragon's Eye", 'dragonseyerecordings'),
  { label: 'International Anthem', url: 'https://www.intlanthem.com/all-artists', read: squarespaceGallery },
  { label: 'Colorfield Records', url: 'https://www.colorfieldrecords.com/artists', read: squarespaceGallery },
  { label: 'Orenda Records', url: 'https://orendarecords.com/artists', read: squarespaceGallery },
  {
    label: 'Sam First Records', url: 'https://samfirstrecords.com/artists/', read: linkText,
    selector: "a[href^='https://samfirstrecords.com/artist/'] h3.elementor-heading-title",
  },
];
