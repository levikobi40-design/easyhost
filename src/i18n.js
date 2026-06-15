import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import he from './locales/he.json';
import el from './locales/el.json';
import ar from './locales/ar.json';
import hi from './locales/hi.json';
import th from './locales/th.json';
import sq from './locales/sq.json';
import { normalizeLang, DEFAULT_LANG } from './utils/languages';

/**
 * Resolve the initial language strictly from persisted storage so a user's
 * choice survives reloads and route changes (no flicker / reset to English).
 * Priority: dedicated `easyhost_lang` key → Zustand persisted store → default.
 */
function resolveInitialLang() {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  try {
    const direct = localStorage.getItem('easyhost_lang');
    if (direct) return normalizeLang(direct);
  } catch (_) {}
  try {
    const stored = localStorage.getItem('hotel-enterprise-storage');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.state?.lang) return normalizeLang(parsed.state.lang);
    }
  } catch (_) {}
  return DEFAULT_LANG;
}

const initialLng = resolveInitialLang();

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    he: { translation: he },
    el: { translation: el },
    ar: { translation: ar },
    hi: { translation: hi },
    th: { translation: th },
    sq: { translation: sq },
  },
  lng: initialLng,
  fallbackLng: 'en',
  supportedLngs: ['en', 'he', 'el', 'ar', 'hi', 'th', 'sq'],
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
