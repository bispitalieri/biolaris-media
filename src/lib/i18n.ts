/// <reference types="vite/client" />
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import englishLocale from '../locales/en.json';

export type Language = string;

type LocaleFile = {
  languageName: string;
  translation: Record<string, string>;
};

const localeFiles = import.meta.glob<LocaleFile>('../locales/*.json', {
  eager: true,
  import: 'default',
});

const localeEntries = Object.entries(localeFiles).flatMap(([path, locale]) => {
  const match = path.match(/\/([^/]+)\.json$/);
  return match ? [[match[1], locale] as const] : [];
});

export const languageNames = Object.fromEntries(
  localeEntries.map(([code, locale]) => [code, locale.languageName]),
) as Record<Language, string>;

const resources = Object.fromEntries(
  localeEntries.map(([code, locale]) => [code, {translation: locale.translation}]),
);

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {translation: typeof englishLocale.translation};
  }
}

function getInitialLanguage(): Language {
  try {
    const saved = window.localStorage.getItem('biolaris-language');
    if (saved && saved in languageNames) return saved;
  } catch {
    // English is the default when local storage is unavailable.
  }
  return 'en';
}

i18n.use(initReactI18next);
const initialLanguage = getInitialLanguage();
document.documentElement.lang = initialLanguage;
void i18n.init({
  resources,
  lng: initialLanguage,
  fallbackLng: 'en',
  interpolation: {escapeValue: false},
}).then(() => {
  document.documentElement.lang = i18n.resolvedLanguage ?? 'en';
});

i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
  try {
    window.localStorage.setItem('biolaris-language', language);
  } catch {
    // The selected language still applies for the current session.
  }
});

export default i18n;
