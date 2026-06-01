/** Hebrew weekday letters: א׳ = Sunday … ש׳ = Saturday (getDay() order). */
const YOM_LETTER = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

/**
 * Formats an ISO date like: יום א', 5 באפריל (optional time).
 * @param {string} isoStr
 * @param {{ includeTime?: boolean }} opts
 */
export function formatHebrewDate(isoStr, opts = {}) {
  const { includeTime = true } = opts;
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return String(isoStr);
    const letter = YOM_LETTER[d.getDay()] || '—';
    const day = d.getDate();
    const monthName = d.toLocaleDateString('he-IL', { month: 'long' });
    let s = `יום ${letter}', ${day} ב${monthName}`;
    if (includeTime) {
      const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
      s += ` · ${time}`;
    }
    return s;
  } catch {
    return String(isoStr);
  }
}

/** Short label for task / occupancy types (DB may store English or Hebrew). */
export function taskTypeLabelHe(tt) {
  const x = String(tt || '').trim();
  const low = x.toLowerCase();
  if (low === 'cleaning' || x === 'ניקיון חדר') return 'ניקיון חדר';
  if (low === 'maintenance' || x === 'תחזוקה') return 'תחזוקה';
  if (low === 'service' || x === 'שירות') return 'שירות';
  if (low === 'check-in' || low === 'checkin' || x === "צ'ק-אין") return "צ'ק-אין";
  if (low === 'checkout') return "צ'ק-אאוט";
  if (low === 'vip guest' || x === 'אורח VIP') return 'אורח VIP';
  return x || '—';
}
