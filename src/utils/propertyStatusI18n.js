import { normalizeLang } from './languages';

/**
 * Normalize API / legacy status labels (incl. Hebrew) to a stable i18n key
 * under `status.*` (e.g. status.ready, status.cleaning).
 */
const STATUS_ALIASES = {
  ready: 'ready',
  available: 'ready',
  clean: 'ready',
  vacant: 'ready',
  cleaning: 'cleaning',
  dirty: 'cleaning',
  inprogress: 'cleaning',
  'in_progress': 'cleaning',
  'in-progress': 'cleaning',
  occupied: 'occupied',
  booked: 'occupied',
  maintenance: 'maintenance',
  // Hebrew API / legacy chrome
  מוכן: 'ready',
  פנוי: 'ready',
  ניקיון: 'cleaning',
  בניקיון: 'cleaning',
  מלוכלך: 'cleaning',
  תפוס: 'occupied',
  תחזוקה: 'maintenance',
};

export function normalizePropertyStatusKey(status) {
  const raw = String(status ?? '').trim();
  if (!raw) return 'cleaning';
  const lower = raw.toLowerCase().replace(/\s+/g, '_');
  if (STATUS_ALIASES[lower]) return STATUS_ALIASES[lower];
  if (STATUS_ALIASES[raw]) return STATUS_ALIASES[raw];
  // Title-case English like "Ready" / "Cleaning"
  if (STATUS_ALIASES[raw.toLowerCase()]) return STATUS_ALIASES[raw.toLowerCase()];
  return lower.replace(/[^a-z0-9_]/g, '_') || 'cleaning';
}

/**
 * Translate a property status badge. Always pass explicit lng when available
 * so UI never shows Hebrew while the store language is en/el.
 */
export function translatePropertyStatus(t, status, lng) {
  const key = normalizePropertyStatusKey(status);
  const full = `status.${key}`;
  const opts = lng ? { lng: normalizeLang(lng) } : undefined;
  const translated = typeof t === 'function' ? t(full, opts) : full;
  if (!translated || translated === full) {
    // Fallbacks for older keys
    if (key === 'ready') return t('propertyCard.ready', opts);
    if (key === 'cleaning') return t('propertyCard.cleaning', opts);
    return String(status || '');
  }
  return translated;
}
