import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { LOCALE_RESOURCES, applyDirection, detectLocale, type Locale } from './locale'

const STORAGE_KEY = 'ai-desktop:locale'

/** Read the user's saved locale override, if any. */
export function readStoredLocale(): Locale | null {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY)
    return value === 'en' || value === 'fa' ? value : null
  } catch {
    return null
  }
}

export function storeLocale(locale: Locale): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale)
  } catch {
    // Persisting the locale is best-effort.
  }
}

/** The locale to boot with: saved override first, then browser detection. */
export function initialLocale(): Locale {
  return readStoredLocale() ?? detectLocale()
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: LOCALE_RESOURCES.en },
    fa: { translation: LOCALE_RESOURCES.fa }
  },
  lng: initialLocale(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false
})

i18n.on('languageChanged', (language) => {
  const locale: Locale = language === 'fa' ? 'fa' : 'en'
  storeLocale(locale)
  if (typeof document !== 'undefined') applyDirection(locale, document.documentElement)
})

if (typeof document !== 'undefined') {
  applyDirection(i18n.language === 'fa' ? 'fa' : 'en', document.documentElement)
}

export default i18n
