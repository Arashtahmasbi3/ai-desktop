import i18n from '../../src/renderer/src/i18n'

/**
 * U3-2 / U3-5 — the i18n keys the progressive-disclosure surfaces need.
 *
 * They ship as snippets (`_research/i18n/disclosure-en.json` and `disclosure-fa.json`) and
 * are merged into `en.json` / `fa.json` separately, so the tests that pin the wiring install
 * them here. `addResourceBundle` with `overwrite` makes this a no-op once the merged file
 * carries the same values, which is what lets these tests pass both before and after that
 * merge.
 */
export const DISCLOSURE_EN: Record<string, Record<string, string>> = {
  disclosure: {
    moreLines_one: '{{count}} more line',
    moreLines_other: '{{count}} more lines',
    moreLabels: '+{{count}} more',
    fullScreen: 'Full screen',
    outputTitle: 'Output',
    reviewAll: 'Review all files',
    previousFile: 'Previous',
    nextFile: 'Next'
  }
}

export const DISCLOSURE_FA: Record<string, Record<string, string>> = {
  disclosure: {
    moreLines_one: '{{count}} خط دیگر',
    moreLines_other: '{{count}} خط دیگر',
    moreLabels: '+{{count}} مورد دیگر',
    fullScreen: 'تمام‌صفحه',
    outputTitle: 'خروجی',
    reviewAll: 'بازبینی همهٔ فایل‌ها',
    previousFile: 'قبلی',
    nextFile: 'بعدی'
  }
}

/** Install the snippet keys for both locales. Call it from `beforeAll`, before changing language. */
export function installDisclosureResources(): void {
  i18n.addResourceBundle('en', 'translation', DISCLOSURE_EN, true, true)
  i18n.addResourceBundle('fa', 'translation', DISCLOSURE_FA, true, true)
}
