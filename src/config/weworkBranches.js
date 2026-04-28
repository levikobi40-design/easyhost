/**
 * WeWork Israel — portfolio placeholders (grid + filters).
 * Images: pending placeholder until Kobi uploads; pricing stub ₪0 in description.
 */

/** Placeholder until Kobi uploads real photography */
export const WEWORK_PENDING_IMAGE_URL =
  'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=80';

/** Default rental / membership options enabled for every WeWork branch */
export const WEWORK_RENTAL_OPTIONS = [
  { id: 'daily_access', titleHe: 'גישה יומית', titleEn: 'Daily Access' },
  { id: 'meeting_rooms', titleHe: 'חדרי ישיבות', titleEn: 'Meeting Rooms' },
  { id: 'hot_desk', titleHe: 'מנוי לחלל עבודה', titleEn: 'Hot Desk' },
  { id: 'dedicated_desk', titleHe: 'עמדת עבודה קבועה', titleEn: 'Dedicated Desk' },
  { id: 'private_office', titleHe: 'משרד פרטי', titleEn: 'Private Office' },
  { id: 'full_floor', titleHe: 'קומה שלמה', titleEn: 'Full Floor' },
];

/** Hebrew labels for property chips (amenities) */
export const WEWORK_RENTAL_LABELS_HE = WEWORK_RENTAL_OPTIONS.map((o) => o.titleHe);

/**
 * 14 locations — Tel Aviv (9), Ramat Gan, Haifa, Herzliya, Jerusalem, Beersheba
 */
export const WEWORK_BRANCH_PINS = [
  {
    id: 'wework-tlv-london-ministore',
    slug: 'wework-tlv-london-ministore',
    name: 'WeWork London Ministore',
    cityHe: 'תל אביב',
    address: 'אבן גבירול 30, תל אביב',
  },
  {
    id: 'wework-tlv-toha',
    slug: 'wework-tlv-toha',
    name: 'WeWork ToHA',
    cityHe: 'תל אביב',
    address: 'יגאל אלון 114, תל אביב',
  },
  {
    id: 'wework-tlv-azrieli-town',
    slug: 'wework-tlv-azrieli-town',
    name: 'WeWork Azrieli Town',
    cityHe: 'תל אביב',
    address: 'מנחם בגין 146, תל אביב',
  },
  {
    id: 'wework-tlv-shaul-hamelech',
    slug: 'wework-tlv-shaul-hamelech',
    name: 'WeWork Shaul HaMelech 35',
    cityHe: 'תל אביב',
    address: 'שאול המלך 35, תל אביב',
  },
  {
    id: 'wework-tlv-midtown',
    slug: 'wework-tlv-midtown',
    name: 'WeWork Midtown',
    cityHe: 'תל אביב',
    address: 'מנחם בגין 144, תל אביב',
  },
  {
    id: 'wework-tlv-sarona',
    slug: 'wework-tlv-sarona',
    name: 'WeWork Sarona',
    cityHe: 'תל אביב',
    address: 'אלוף קלמן מגן 3, תל אביב',
  },
  {
    id: 'wework-tlv-hazerem',
    slug: 'wework-tlv-hazerem',
    name: 'WeWork HaZerem 10',
    cityHe: 'תל אביב',
    address: 'הזרם 10, תל אביב',
  },
  {
    id: 'wework-tlv-schocken',
    slug: 'wework-tlv-schocken',
    name: 'WeWork Schocken 23',
    cityHe: 'תל אביב',
    address: 'שוקן 23, תל אביב',
  },
  {
    id: 'wework-tlv-dubnov',
    slug: 'wework-tlv-dubnov',
    name: 'WeWork Dubnov 7',
    cityHe: 'תל אביב',
    address: 'דובנוב 7, תל אביב',
  },
  {
    id: 'wework-rg-sapir',
    slug: 'wework-rg-sapir',
    name: 'WeWork Sapir Tower',
    cityHe: 'רמת גן',
    address: 'תובל 40, רמת גן',
  },
  {
    id: 'wework-haifa-atzmaut',
    slug: 'wework-haifa-atzmaut',
    name: 'WeWork Haifa — Derech Ha\'atzmaut 45',
    cityHe: 'חיפה',
    address: 'דרך העצמאות 45, חיפה',
  },
  {
    id: 'wework-herzliya-shenkar',
    slug: 'wework-herzliya-shenkar',
    name: 'WeWork Herzliya — Aryeh Shenkar 1',
    cityHe: 'הרצליה',
    address: 'אריה שנקר 1, הרצליה',
  },
  {
    id: 'wework-jlm-king-george',
    slug: 'wework-jlm-king-george',
    name: 'WeWork Jerusalem — King George 20',
    cityHe: 'ירושלים',
    address: 'קינג ג\'ורג\' 20, ירושלים',
  },
  {
    id: 'wework-b7-halutz',
    slug: 'wework-b7-halutz',
    name: 'WeWork Beersheba — Halutziei HaOr 16',
    cityHe: 'באר שבע',
    address: 'חלוצי האור 16, באר שבע',
  },
];

export const WEWORK_PIN_ID_SET = new Set(WEWORK_BRANCH_PINS.map((b) => b.id));

const NAME_LC = new Set(WEWORK_BRANCH_PINS.map((b) => b.name.trim().toLowerCase()));

export function isWeWorkPortfolioProperty(p) {
  const id = String(p?.id || '');
  if (WEWORK_PIN_ID_SET.has(id)) return true;
  return NAME_LC.has(String(p?.name || '').trim().toLowerCase());
}

export function getWeWorkBranchById(id) {
  return WEWORK_BRANCH_PINS.find((b) => b.id === id) || null;
}
