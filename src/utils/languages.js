/**
 * languages.js — single source of truth for i18n language support.
 *
 * Add a new language by: (1) dropping a locale JSON in src/locales/<code>.json,
 * (2) registering it in src/i18n.js, and (3) adding the code/label/dir here.
 * Every other place (store, App, FieldView) derives from these constants so the
 * "allowed languages" can never drift out of sync again.
 */

/** Languages the UI ships with (must each have a locale file + i18n registration). */
export const SUPPORTED_LANGS = ['en', 'he', 'el', 'ar', 'hi', 'th', 'sq'];

/** Right-to-left scripts — drive document.dir + layout mirroring. */
export const RTL_LANGS = ['he', 'ar'];

/** Native-name labels for language pickers (short code shown in compact UIs). */
export const LANGUAGE_LABELS = {
  en: { label: 'EN', name: 'English' },
  he: { label: 'עב', name: 'עברית' },
  el: { label: 'EL', name: 'Ελληνικά' },
  ar: { label: 'ع', name: 'العربية' },
  hi: { label: 'हि', name: 'हिन्दी' },
  th: { label: 'ไทย', name: 'ไทย' },
  sq: { label: 'SQ', name: 'Shqip' },
};

export const DEFAULT_LANG = 'en';

/** True when the given language code renders right-to-left. */
export const isRtlLang = (lang) => RTL_LANGS.includes(String(lang || '').toLowerCase().trim());

/** Coerce any input to a supported code, falling back to English. */
export const normalizeLang = (lang) => {
  const l = String(lang || '').toLowerCase().trim();
  return SUPPORTED_LANGS.includes(l) ? l : DEFAULT_LANG;
};

/** Ordered list of { code, label, name } for building language selectors. */
export const LANGUAGE_OPTIONS = SUPPORTED_LANGS.map((code) => ({
  code,
  ...LANGUAGE_LABELS[code],
}));
