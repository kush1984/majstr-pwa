import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import uk from '@/locales/uk.json';
import en from '@/locales/en.json';

/**
 * i18n setup (Step 9 — foundation only).
 *
 * The app ships in Ukrainian; English (`en.json`) is a same-shaped stub for a
 * future translation pass. We default to `uk` and only let a stored preference
 * (`majstr.lang`) override it — we deliberately do NOT detect the browser
 * language yet, so an English-browser user isn't shown the half-baked stubs.
 * `i18n.changeLanguage('en')` works (and persists) for testing; there is no UI
 * switcher yet (planned in G2).
 *
 * Keys are grouped by surface: common.* nav.* auth.* dashboard.* projects.*
 * estimate.* catalog.* profile.* questions.* email.* errors.* validation.*,
 * plus shared enum maps units.* trades.* status.* itemType.*.
 */
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      uk: { translation: uk },
      en: { translation: en },
    },
    fallbackLng: 'uk',
    supportedLngs: ['uk', 'en'],
    detection: {
      // localStorage only — no `navigator`, so the default stays Ukrainian
      // until someone explicitly switches.
      order: ['localStorage'],
      caches: ['localStorage'],
      lookupLocalStorage: 'majstr.lang',
    },
    interpolation: {
      escapeValue: false, // React already escapes
    },
  });

export default i18n;
