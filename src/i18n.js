import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import he from './locales/he.json';
import el from './locales/el.json';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    he: { translation: he },
    el: { translation: el },
  },
  lng: 'he',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
