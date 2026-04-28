/**
 * Emergency client-side seed: Hotel Bazaar Jaffa + 14 ROOMS branches (matches backend `_default_portfolio_seed_rooms`).
 * Used when GET /properties returns [], 204, or missing image_url.
 * Card images: direct Unsplash URLs only (no /assets paths).
 * Occupancy: every row hardcodes `occupancy_rate: 80` for demo / dashboard sync.
 */
import { ROOMS_BRANCH_PINS } from '../config/roomsBranches';
import { BAZAAR_JAFFA_PROPERTY_ID } from './propertyData';

/** Bazaar — direct Unsplash hero */
const BAZAAR_IMG =
  'https://images.unsplash.com/photo-1551882547-ff43c63efe81?auto=format&fit=crop&w=800&q=80';

/** 14 distinct Unsplash images — order matches backend `_rooms_images` + ROOMS_BRANCH_PINS */
const ROOMS_SEED_IMAGES = [
  'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1604328698692-f76ea9498e76?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1517245385007-cbe13ea217f0?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1560185007-cde436f6a4d0?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1502005229762-cf1b2da7c5d6?auto=format&fit=crop&w=800&q=80',
];

const ROOMS_FALLBACK_IMG = ROOMS_SEED_IMAGES[0];

/** Re-export for PropertiesContext / merges */
export const BAZAAR_IMAGE_URL = BAZAAR_IMG;

/** @type {Record<string, string>} */
export const PORTFOLIO_IMAGE_URL_BY_ID = {
  [BAZAAR_JAFFA_PROPERTY_ID]: BAZAAR_IMG,
};

ROOMS_BRANCH_PINS.forEach((b, i) => {
  PORTFOLIO_IMAGE_URL_BY_ID[b.id] = ROOMS_SEED_IMAGES[i] || ROOMS_FALLBACK_IMG;
});

export const initialProperties = [
  {
    id: BAZAAR_JAFFA_PROPERTY_ID,
    name: 'Hotel Bazaar Jaffa',
    description:
      'Bohemian Jaffa — historic Bauhaus near the Flea Market. Emergency client seed.',
    photo_url: BAZAAR_IMG,
    image_url: BAZAAR_IMG,
    amenities: [],
    status: 'Active',
    occupancy_rate: 80,
    created_at: new Date().toISOString(),
    branch_slug: BAZAAR_JAFFA_PROPERTY_ID,
    max_guests: 2,
    bedrooms: 1,
    beds: 1,
    bathrooms: 1,
  },
  ...ROOMS_BRANCH_PINS.map((b, i) => {
    const img = ROOMS_SEED_IMAGES[i] || ROOMS_FALLBACK_IMG;
    return {
      id: b.id,
      name: b.name,
      description: b.description || `ROOMS — ${b.city}`,
      photo_url: img,
      image_url: img,
      amenities: ['ROOMS', 'Coworking', b.city],
      status: 'Active',
      occupancy_rate: 80,
      created_at: new Date().toISOString(),
      branch_slug: b.slug,
      max_guests: 1,
      bedrooms: 0,
      beds: 0,
      bathrooms: 0,
    };
  }),
];

/**
 * @param {unknown[]} list
 * @returns {unknown[]}
 */
function inferFallbackImageByName(id, name) {
  const s = `${id} ${name || ''}`.toLowerCase();
  if (s.includes('bazaar') || s.includes('בזאר')) return BAZAAR_IMG;
  if (s.includes('rooms') || /room\s*s\b/i.test(name || '')) return ROOMS_FALLBACK_IMG;
  return null;
}

export function ensurePropertyPortfolioImages(list) {
  if (!Array.isArray(list)) return [];
  return list.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const id = String(row.id ?? '');
    const fallbackImg =
      PORTFOLIO_IMAGE_URL_BY_ID[id] || inferFallbackImageByName(id, row.name);
    const raw = (row.image_url || row.photo_url || '').trim();
    const img = raw || fallbackImg;
    if (!img) return row;
    return {
      ...row,
      image_url: img,
      photo_url: (row.photo_url || '').trim() || img,
      occupancy_rate: row.occupancy_rate != null ? row.occupancy_rate : 80,
    };
  });
}
