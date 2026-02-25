import { useEffect, useState } from 'react';
import i18n from '../i18n';

/**
 * Custom hook for translations (no React context needed)
 * @returns {object} Translation helpers { t, i18n }
 */
export const useTranslations = () => {
  const [, forceRender] = useState(0);

  useEffect(() => {
    const handleLanguageChange = () => {
      forceRender((prev) => prev + 1);
    };
    try {
      i18n.on('languageChanged', handleLanguageChange);
    } catch (_) {}
    return () => {
      try {
        i18n.off('languageChanged', handleLanguageChange);
      } catch (_) {}
    };
  }, []);

  const t = (key, options) => {
    try {
      if (typeof i18n?.t === 'function') return i18n.t(key, options);
    } catch (_) {}
    return typeof key === 'string' ? key : '';
  };
  return { t, i18n };
};

export default useTranslations;
