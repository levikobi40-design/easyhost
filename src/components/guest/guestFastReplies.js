/** Maya line after any successful guest request (ignore backlog size). */
export const GUEST_LAST_REQUEST_ACK_HE = 'רשמתי את הבקשה האחרונה שלך';
export const GUEST_LAST_REQUEST_ACK_EN = "I've logged your latest request.";

/**
 * Instant Maya copy for guest tile actions — shown before the server responds.
 */
export const GUEST_INSTANT_MAYA = {
  towels: 'קיבלתי! המגבות בדרך לחדר שלך. 🚚',
  cleaning: 'הודעתי לצוות הניקיון, הם יגיעו אליך בהקדם. ✨',
  maintenance: 'טכנאי בדרך לבדוק את התקלה. תודה על הדיווח! 🛠️',
  service: 'קיבלתי! הצוות מטפל בזה בהקדם. ✨',
};

export function getInstantMayaForGuestTask(payload) {
  const tt = String(payload.task_type || '').trim();
  const desc = String(payload.description || '').toLowerCase();
  if (tt === 'Cleaning') {
    if (desc.includes('מגבת') || desc.includes('towel')) return GUEST_INSTANT_MAYA.towels;
    return GUEST_INSTANT_MAYA.cleaning;
  }
  if (tt === 'Maintenance') return GUEST_INSTANT_MAYA.maintenance;
  return GUEST_INSTANT_MAYA.service;
}

/**
 * Guest-facing status — never expose internal worker states (Searching_for_Staff, escalated, etc.).
 * Maps any active work to calm copy.
 */
export function guestFacingRequestStatusHe(status) {
  const s = String(status || '').trim().toLowerCase();
  if (!s || s === 'done' || s === 'completed' || s === 'closed') return 'הושלם';
  if (s === 'in_progress' || s === 'in progress' || s === 'accepted' || s === 'seen') return 'בביצוע';
  if (s === 'waiting') return 'בהמתנה לטיפול';
  return 'בטיפול';
}

export function guestFacingRequestStatusEn(status) {
  const s = String(status || '').trim().toLowerCase();
  if (!s || s === 'done' || s === 'completed' || s === 'closed') return 'Completed';
  if (s === 'in_progress' || s === 'in progress' || s === 'accepted' || s === 'seen') return 'In progress';
  return 'Processing';
}

/** Hide technical / AI outage wording if it ever leaks to the client. */
export function sanitizeGuestVisibleMessage(text) {
  const t = String(text || '').trim();
  if (!t) return 'אני כאן איתך — במה לעזור?';
  const low = t.toLowerCase();
  const bad = [
    'searching_for_staff',
    'מתייצבת',
    'מעבדת המון',
    'נסו שוב בעוד דקה',
    'נסו שוב עוד דקה',
    'הפסקה קצרה',
    'stabiliz',
    'try again in',
    'temporarily unavailable',
    'rate limit',
    'quota',
    '503',
    '502',
    '429',
    'failed to create',
    'chat failed',
    'network',
  ];
  if (bad.some((b) => low.includes(b))) {
    return 'הבקשה התקבלה! אני כבר מעדכנת את הצוות.';
  }
  return t;
}
