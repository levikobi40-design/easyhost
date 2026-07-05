import i18n from '../i18n';
import { formatTaskDate, translateTaskType } from './taskDisplayI18n';

/**
 * Locale-aware date formatting (delegates to active i18n language).
 */
export function formatHebrewDate(isoStr, opts = {}) {
  return formatTaskDate(isoStr, i18n.language, opts);
}

/** Localized task type label. */
export function taskTypeLabelHe(tt) {
  const label = translateTaskType(tt, '');
  return label || '—';
}
