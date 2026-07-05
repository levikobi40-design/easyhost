import { LANGUAGE_OPTIONS } from './languages';

/** Greece pilot UI languages — Hebrew kept primary; add EN / EL / AR alongside. */
export const PILOT_LANGS = ['he', 'en', 'el', 'ar'];

export const PILOT_LANGUAGE_OPTIONS = LANGUAGE_OPTIONS.filter((o) =>
  PILOT_LANGS.includes(o.code),
);
