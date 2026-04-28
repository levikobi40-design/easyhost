/**
 * Canonical property knowledge (not shown on main properties grid — use in detail views + Maya).
 */

export const BAZAAR_JAFFA_PROPERTY_ID = 'bazaar-jaffa-hotel';

/** Structured policy for UI (detail / modal) */
export const BAZAAR_JAFFA_GUEST_POLICY = {
  titleHe: 'מלון בזאר יפו — מדיניות ומידע לאורחים',
  bullets: [
    { label: 'חדרים', text: '32 חדרים בסך הכול.' },
    {
      label: 'צ׳ק-אין',
      text: '15:00–23:59. שבת וחג: כניסה לחדר החל מ-18:00 בלבד.',
    },
    {
      label: 'צ׳ק-אאוט',
      text: 'עד 11:00. שבת וחג: עד 14:00.',
    },
    { label: 'צ׳ק-אאוט מאוחר', text: '170 ₪ (בכפוף לאישור ולזמינות).' },
    { label: 'כשרות', text: 'אין ארוחות כשרות ואין מתקני כשרות במלון.' },
    {
      label: 'מתקנים',
      text: 'קבלה ואבטחה 24 שעות, חדר כושר, מסעדה, מעלית, חדרים נגישים.',
    },
    {
      label: 'כללים',
      text: 'איסור עישון; ללא חיות מחמד; ללא מסיבות; גיל 18+ (אלא אם כן בליווי הורה/אפוטרופוס).',
    },
  ],
};

export function isBazaarJaffaProperty(p) {
  if (!p) return false;
  if (String(p.id) === BAZAAR_JAFFA_PROPERTY_ID) return true;
  const n = `${p.name || ''}`.toLowerCase();
  return /בזאר|bazaar|מלון בזאר|hotel bazaar|jaffa|יפו/.test(n);
}

/** Plain Hebrew block for Maya / system prompts */
export function getBazaarJaffaPolicyTextForMaya() {
  const lines = BAZAAR_JAFFA_GUEST_POLICY.bullets.map((b) => `${b.label}: ${b.text}`);
  return `${BAZAAR_JAFFA_GUEST_POLICY.titleHe}\n${lines.join('\n')}`;
}
