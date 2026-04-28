/** Hotel Bazaar Jaffa — Week 1 manager view: deal highlights per calendar day (pilot). */

const BARBY_ROTATION = [
  'Teapacks (טיפקס)',
  'Mercedes Band',
  'Ninet (נינט)',
  'Fortisakharof (Fortis)',
];

/**
 * Hebrew line for “deal of the day” to pair with bookings in the manager grid.
 * @param {Date} date
 * @param {number} dayIndex offset from today 0..6
 */
export function getDealHighlightForDay(date, dayIndex = 0) {
  const wd = date.getDay();
  const artist = BARBY_ROTATION[(dayIndex + wd) % BARBY_ROTATION.length];
  const isWeekend = wd === 5 || wd === 6;

  const base = [
    `הנחה כללית 10%; חבילת ספא; חבילה קולינרית; "טעמים ורגיעה" — ${isWeekend ? 'תעריף סוף שבוע' : 'תעריף חול'}.`,
    `מבצע פסח 20% (בעונה); 25% בלעדי מועדון; מילואים — 50% ללילה שני (בכפוף לאישור ותעודה).`,
    `ברבי: הופעות — למשל ${artist} (הצעה למוזיקה חיה לפי היום בשבוע).`,
  ].join(' ');

  return base;
}

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function isDateInRange(isoDateStr, from, to) {
  if (!isoDateStr) return false;
  const t = Date.parse(isoDateStr);
  if (!Number.isFinite(t)) return false;
  return t >= from.getTime() && t <= to.getTime();
}
