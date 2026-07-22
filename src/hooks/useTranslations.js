import { useTranslation } from 'react-i18next';

/**
 * App-wide translation hook.
 * Thin wrapper around react-i18next's useTranslation so every consumer
 * re-renders immediately when the active language changes.
 *
 * @returns {{ t: Function, i18n: object, lang: string }}
 */
export const useTranslations = () => {
  const { t, i18n } = useTranslation();
  return {
    t,
    i18n,
    lang: i18n?.language || 'en',
  };
};

export default useTranslations;
