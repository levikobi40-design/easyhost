/**
 * ROOMS by Fattal — branch hierarchy (matches backend rooms_branches + seed).
 * assetFolder is under /assets/images/
 */

function wsGallery(folder) {
  return [`/assets/images/${folder}/main.jpg`, `/assets/images/${folder}/lounge.jpg`];
}

export const ROOMS_BRANCH_PINS = [
  {
    id: 'rooms-branch-sky-tower',
    slug: 'sky-tower',
    name: 'ROOMS Sky Tower',
    city: 'Tel Aviv',
    assetFolder: 'workspaces/sky-tower',
    description:
      'Coworking (ROOMS by Fattal) — ~2000 m². Mini-cinema (~50), lounge, bar, hot desks, private offices. Offices ~4–10k ₪; meeting rooms ~250–300 ₪/hr; daily desk ~150 ₪.',
    gallery: wsGallery('workspaces/sky-tower'),
  },
  {
    id: 'rooms-branch-acro-tlv',
    slug: 'acro-tlv',
    name: 'ROOMS Acro',
    city: 'Tel Aviv',
    assetFolder: 'workspaces/acro-tlv',
    description: 'ROOMS Acro — Tel Aviv. Hot desks, private offices, meeting rooms; hourly, daily, and monthly rental.',
    gallery: wsGallery('workspaces/acro-tlv'),
  },
  {
    id: 'rooms-branch-beit-rubinstein',
    slug: 'beit-rubinstein',
    name: 'ROOMS Beit Rubinstein',
    city: 'Tel Aviv',
    assetFolder: 'workspaces/beit-rubinstein',
    description: 'ROOMS Beit Rubinstein — boutique workspace in Tel Aviv.',
    gallery: wsGallery('workspaces/beit-rubinstein'),
  },
  {
    id: 'rooms-branch-neve-tzedek',
    slug: 'neve-tzedek',
    name: 'ROOMS Neve Tzedek',
    city: 'Tel Aviv',
    assetFolder: 'workspaces/neve-tzedek',
    description: 'ROOMS Neve Tzedek — neighborhood workspace.',
    gallery: wsGallery('workspaces/neve-tzedek'),
  },
  {
    id: 'rooms-branch-bbc',
    slug: 'bbc-bnei-brak',
    name: 'ROOMS BBC',
    city: 'Bnei Brak',
    assetFolder: 'workspaces/bbc-bnei-brak',
    description: 'ROOMS BBC — Bnei Brak business center.',
    gallery: wsGallery('workspaces/bbc-bnei-brak'),
  },
  {
    id: 'rooms-branch-acro-raanana',
    slug: 'acro-raanana',
    name: 'ROOMS Acro Ra\'anana',
    city: 'Ra\'anana',
    assetFolder: 'workspaces/acro-raanana',
    description: 'ROOMS Acro — Ra\'anana.',
    gallery: wsGallery('workspaces/acro-raanana'),
  },
  {
    id: 'rooms-branch-millennium-raanana',
    slug: 'millennium-raanana',
    name: 'ROOMS Millennium',
    city: 'Ra\'anana',
    assetFolder: 'workspaces/millennium-raanana',
    description: 'ROOMS Millennium — Ra\'anana.',
    gallery: wsGallery('workspaces/millennium-raanana'),
  },
  {
    id: 'rooms-branch-modiin',
    slug: 'modiin',
    name: 'ROOMS Modi\'in',
    city: 'Modi\'in',
    assetFolder: 'workspaces/modiin',
    description: 'ROOMS Modi\'in — central Israel.',
    gallery: wsGallery('workspaces/modiin'),
  },
  {
    id: 'rooms-branch-bsr-city',
    slug: 'bsr-city',
    name: 'ROOMS BSR City',
    city: 'Petah Tikva',
    assetFolder: 'workspaces/bsr-city',
    description: 'ROOMS BSR City — Petah Tikva.',
    gallery: wsGallery('workspaces/bsr-city'),
  },
  {
    id: 'rooms-branch-herzliya',
    slug: 'herzliya',
    name: 'ROOMS Herzliya',
    city: 'Herzliya',
    assetFolder: 'workspaces/herzliya',
    description: 'ROOMS Herzliya — coastal business district.',
    gallery: wsGallery('workspaces/herzliya'),
  },
  {
    id: 'rooms-branch-haifa',
    slug: 'haifa',
    name: 'ROOMS Haifa',
    city: 'Haifa',
    assetFolder: 'workspaces/haifa',
    description: 'ROOMS Haifa — northern hub.',
    gallery: wsGallery('workspaces/haifa'),
  },
  {
    id: 'rooms-branch-jerusalem',
    slug: 'jerusalem',
    name: 'ROOMS Jerusalem',
    city: 'Jerusalem',
    assetFolder: 'workspaces/jerusalem',
    description: 'ROOMS Jerusalem — capital workspace.',
    gallery: wsGallery('workspaces/jerusalem'),
  },
  {
    id: 'rooms-branch-beer-sheva',
    slug: 'beer-sheva',
    name: 'ROOMS Beersheva',
    city: 'Beersheva',
    assetFolder: 'workspaces/beer-sheva',
    description: 'ROOMS Beersheva — Negev hub.',
    gallery: wsGallery('workspaces/beer-sheva'),
  },
  {
    id: 'rooms-branch-eilat',
    slug: 'eilat',
    name: 'ROOMS Eilat',
    city: 'Eilat',
    assetFolder: 'workspaces/eilat',
    description: 'ROOMS Eilat — Red Sea resort city.',
    gallery: wsGallery('workspaces/eilat'),
  },
];

export const ROOMS_RENTAL_CATEGORIES = [
  {
    id: 'monthly',
    titleHe: 'ארוך טווח (חודשי)',
    titleEn: 'Long-term (Monthly)',
    items: ['Private Offices', 'Designated Desks', 'משרדים פרטיים', 'שולחנות קבועים'],
  },
  {
    id: 'daily',
    titleHe: 'יומי',
    titleEn: 'Daily',
    items: ['Hot Desks', 'Daily Offices', 'שולחנות חמים', 'משרד יומי'],
  },
  {
    id: 'hourly',
    titleHe: 'לפי שעה',
    titleEn: 'Hourly',
    items: ['Meeting Rooms', 'Cinema', 'Event Spaces', 'חדרי ישיבות', 'מיני-סינמה', 'חללי אירוע'],
  },
];

export const ROOMS_PIN_ID_SET = new Set(ROOMS_BRANCH_PINS.map((b) => b.id));
