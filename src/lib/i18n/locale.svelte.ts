export type Locale = 'de' | 'en';
export const language = $state<{ locale: Locale }>({ locale: 'de' });
export const directions: Record<Locale, 'ltr' | 'rtl'> = { de: 'ltr', en: 'ltr' };

export function setLocale(locale: string) {
  language.locale = locale === 'en' ? 'en' : 'de';
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language.locale;
    document.documentElement.dir = directions[language.locale];
  }
}
export function formatNumber(value: number | bigint, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(language.locale, options).format(value);
}
export function formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(language.locale, options).format(value);
}
