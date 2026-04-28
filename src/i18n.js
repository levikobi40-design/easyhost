import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import he from './locales/he.json';
import el from './locales/el.json';

const stored = typeof window !== 'undefined' && localStorage.getItem('hotel-enterprise-storage');
let initialLng = 'en';
if (stored) {
  try {
    const parsed = JSON.parse(stored);
    initialLng = parsed?.state?.lang || 'en';
  } catch (_) {}
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    he: { translation: he },
    el: { translation: el },
  },
  lng: initialLng,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
