/**

 * Greece Corfu pilot — 3 properties (matches backend `_christos_corfu_portfolio_seed`).
 * + Herbert Samuel Milos Dead Sea (matches `_milos_dead_sea_portfolio_seed`).

 */

const CORFU_LUXURY_ROOM_IMG =

  'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1200&q=85';

const CORFU_BEACH_ROOM_IMG =

  'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=85';

const MILOS_DEAD_SEA_IMG =

  'https://images.unsplash.com/photo-1540541338287-41700207dee6?auto=format&fit=crop&w=1200&q=85';



/** @type {Record<string, string>} */

export const PORTFOLIO_IMAGE_URL_BY_ID = {

  'christos-thaleri-villa-corfu': CORFU_LUXURY_ROOM_IMG,

  'christos-manto-beach-apartment-barbati': CORFU_BEACH_ROOM_IMG,

  'christos-manto-luxury-beach-2p-barbati': CORFU_BEACH_ROOM_IMG,

  milos_dead_sea: MILOS_DEAD_SEA_IMG,

};



export const CHRISTOS_PROPERTY_IDS = [

  'christos-thaleri-villa-corfu',

  'christos-manto-beach-apartment-barbati',

  'christos-manto-luxury-beach-2p-barbati',

];

export const MILOS_DEAD_SEA_PROPERTY_ID = 'milos_dead_sea';



const now = () => new Date().toISOString();



export const initialProperties = [

  {

    id: 'christos-thaleri-villa-corfu',

    name: 'וילה Thaleri',

    description: 'Greece Corfu pilot property.',

    photo_url: CORFU_LUXURY_ROOM_IMG,

    image_url: CORFU_LUXURY_ROOM_IMG,

    amenities: ['Corfu', 'Greece', 'Pilot'],

    status: 'Active',

    occupancy_rate: 88,

    created_at: now(),

    branch_slug: 'christos-thaleri-villa-corfu',

    max_guests: 6,

    bedrooms: 3,

    beds: 4,

    bathrooms: 2,

  },

  {

    id: 'christos-manto-beach-apartment-barbati',

    name: 'Manto Apartments',

    description: 'Greece Corfu pilot property.',

    photo_url: CORFU_BEACH_ROOM_IMG,

    image_url: CORFU_BEACH_ROOM_IMG,

    amenities: ['Corfu', 'Greece', 'Pilot'],

    status: 'Active',

    occupancy_rate: 85,

    created_at: now(),

    branch_slug: 'christos-manto-beach-apartment-barbati',

    max_guests: 4,

    bedrooms: 2,

    beds: 2,

    bathrooms: 1,

  },

  {

    id: 'christos-manto-luxury-beach-2p-barbati',

    name: 'Manto Beach Suite',

    description: 'Greece Corfu pilot property.',

    photo_url: CORFU_BEACH_ROOM_IMG,

    image_url: CORFU_BEACH_ROOM_IMG,

    amenities: ['Corfu', 'Greece', 'Pilot'],

    status: 'Active',

    occupancy_rate: 92,

    created_at: now(),

    branch_slug: 'christos-manto-luxury-beach-2p-barbati',

    max_guests: 2,

    bedrooms: 1,

    beds: 1,

    bathrooms: 1,

  },

  {

    id: 'milos_dead_sea',

    name: 'Herbert Samuel Milos Dead Sea',

    description:
      'Herbert Samuel Milos Dead Sea Resort — 162 rooms. '
      + 'Rooms 101-160: Superior Patio / Deluxe Ground; '
      + 'Rooms 201-260: Deluxe Sea View / Balcony; '
      + 'Rooms 301-342: Premium Private Pool Suites. '
      + 'Facilities: Anasa Spa, pools, private beach, Main Restaurant, Greek Pool Tavern, '
      + 'Dairy Lobby Bar, Kids/Gaming Club (Floor -1), Gym, Rooftop Solarium, Synagogue.',

    photo_url: MILOS_DEAD_SEA_IMG,

    image_url: MILOS_DEAD_SEA_IMG,

    amenities: [
      'Dead Sea',
      'Anasa Spa',
      'Private Beach',
      'Pool',
      'Restaurant',
      'Kids Club',
      'Gym',
      'Synagogue',
      '162 Rooms',
    ],

    status: 'Active',

    occupancy_rate: 78,

    created_at: now(),

    branch_slug: 'milos_dead_sea',

    max_guests: 4,

    bedrooms: 162,

    beds: 162,

    bathrooms: 162,

  },

];



export function ensurePropertyPortfolioImages(list) {

  if (!Array.isArray(list)) return [];

  return list.map((row) => {

    if (!row || typeof row !== 'object') return row;

    const id = String(row.id ?? '');

    const fallbackImg = PORTFOLIO_IMAGE_URL_BY_ID[id];

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
