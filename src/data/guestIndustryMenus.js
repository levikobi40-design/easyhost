/**
 * Static menus for Guest Dashboard — room service (tasks) and spa (WhatsApp to manager).
 */

export const GUEST_ROOM_SERVICE_MENU = [
  { id: 'rs_breakfast', labelHe: '\u05D0\u05E8\u05D5\u05D7\u05EA \u05D1\u05D5\u05E7\u05E8 \u05D1\u05D7\u05D3\u05E8', description: '\u05E9\u05D9\u05E8\u05D5\u05EA \u05D7\u05D3\u05E8: \u05D0\u05E8\u05D5\u05D7\u05EA \u05D1\u05D5\u05E7\u05E8 \u05DE\u05DC\u05D0\u05D4' },
  { id: 'rs_burger', labelHe: '\u05D4\u05DE\u05D1\u05D5\u05E8\u05D2\u05E8 \u05D5\u05E6\u05D9\u05E4\u05E1', description: '\u05E9\u05D9\u05E8\u05D5\u05EA \u05D7\u05D3\u05E8: \u05D4\u05DE\u05D1\u05D5\u05E8\u05D2\u05E8 \u05D5\u05E6\u05D9\u05E4\u05E1' },
  { id: 'rs_salad', labelHe: '\u05E1\u05DC\u05D8 \u05E7\u05D9\u05E1\u05E8', description: '\u05E9\u05D9\u05E8\u05D5\u05EA \u05D7\u05D3\u05E8: \u05E1\u05DC\u05D8 \u05E7\u05D9\u05E1\u05E8' },
  { id: 'rs_pasta', labelHe: '\u05E4\u05E1\u05D8\u05D4 \u05D1\u05E8\u05D5\u05D8\u05D1 \u05E2\u05D2\u05D1\u05E0\u05D9\u05D5\u05EA', description: '\u05E9\u05D9\u05E8\u05D5\u05EA \u05D7\u05D3\u05E8: \u05E4\u05E1\u05D8\u05D4 \u05D1\u05E8\u05D5\u05D8\u05D1 \u05E2\u05D2\u05D1\u05E0\u05D9\u05D5\u05EA' },
  { id: 'rs_coffee', labelHe: '\u05E7\u05E4\u05D4 \u05D5\u05E2\u05D5\u05D2\u05D4', description: '\u05E9\u05D9\u05E8\u05D5\u05EA \u05D7\u05D3\u05E8: \u05E7\u05E4\u05D4 \u05D5\u05E2\u05D5\u05D2\u05D4' },
  { id: 'rs_water', labelHe: '\u05DE\u05D9\u05DD \u05DE\u05D9\u05E0\u05E8\u05DC\u05D9\u05D9\u05DD', description: '\u05E9\u05D9\u05E8\u05D5\u05EA \u05D7\u05D3\u05E8: \u05DE\u05D9\u05DD \u05DE\u05D9\u05E0\u05E8\u05DC\u05D9\u05D9\u05DD' },
];

export const GUEST_SPA_SERVICES = [
  { id: 'sp_massage_60', labelHe: '\u05E2\u05D9\u05E1\u05D5\u05D9 \u05E9\u05D5\u05D5\u05D3\u05D9 60 \u05D3\u05E7\u05D5\u05EA', short: '\u05E2\u05D9\u05E1\u05D5\u05D9 \u05E9\u05D5\u05D5\u05D3\u05D9 60 \u05D3\u05E7\u05D5\u05EA' },
  { id: 'sp_massage_90', labelHe: '\u05E2\u05D9\u05E1\u05D5\u05D9 \u05E8\u05E7\u05DE\u05D5\u05EA \u05E2\u05DE\u05D5\u05E7 90 \u05D3\u05E7\u05D5\u05EA', short: '\u05E2\u05D9\u05E1\u05D5\u05D9 \u05E8\u05E7\u05DE\u05D5\u05EA \u05E2\u05DE\u05D5\u05E7' },
  { id: 'sp_facial', labelHe: '\u05D8\u05D9\u05E4\u05D5\u05DC \u05E4\u05E0\u05D9\u05DD', short: '\u05D8\u05D9\u05E4\u05D5\u05DC \u05E4\u05E0\u05D9\u05DD' },
  { id: 'sp_scrub', labelHe: '\u05E4\u05D9\u05DC\u05D9\u05E0\u05D2 \u05D2\u05D5\u05E3 \u05D5\u05E2\u05D9\u05E1\u05D5\u05D9', short: '\u05E4\u05D9\u05DC\u05D9\u05E0\u05D2 \u05D2\u05D5\u05E3' },
  { id: 'sp_couple', labelHe: '\u05D7\u05D1\u05D9\u05DC\u05EA \u05D6\u05D5\u05D2\u05D5\u05EA \u2014 \u05E1\u05E4\u05D0 \u05E4\u05E8\u05D8\u05D9', short: '\u05D7\u05D1\u05D9\u05DC\u05EA \u05D6\u05D5\u05D2\u05D5\u05EA \u05E1\u05E4\u05D0' },
];

export function getGuestManagerWhatsAppDigits() {
  const raw = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_GUEST_MANAGER_WHATSAPP) || '';
  return String(raw).replace(/\D/g, '');
}

export function openGuestManagerWhatsAppPrefilled(messageHe) {
  const digits = getGuestManagerWhatsAppDigits();
  if (!digits || typeof window === 'undefined') return false;
  const text = encodeURIComponent(messageHe || '');
  window.open(`https://wa.me/${digits}?text=${text}`, '_blank', 'noopener,noreferrer');
  return true;
}
