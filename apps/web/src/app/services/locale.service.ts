import { Injectable, LOCALE_ID, Inject } from '@angular/core';

export interface SupportedLocale {
  code: string;
  label: string;
}

export const SUPPORTED_LOCALES: SupportedLocale[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Espa\u00f1ol' },
  { code: 'fr', label: 'Fran\u00e7ais' },
  { code: 'de', label: 'Deutsch' },
];

const LOCALE_KEY = 'cc.locale';

@Injectable({ providedIn: 'root' })
export class LocaleService {
  readonly supportedLocales = SUPPORTED_LOCALES;
  readonly currentLocale: string;

  constructor(@Inject(LOCALE_ID) localeId: string) {
    this.currentLocale = localeId;
  }

  getStoredLocale(): string {
    return localStorage.getItem(LOCALE_KEY) ?? 'en';
  }

  setLocale(code: string): void {
    if (!SUPPORTED_LOCALES.some(l => l.code === code)) return;
    localStorage.setItem(LOCALE_KEY, code);
    if (code !== this.currentLocale) {
      const url = new URL(window.location.href);
      url.pathname = `/${code}${url.pathname.replace(/^\/(en|es|fr|de)/, '')}`;
      window.location.href = url.toString();
    }
  }
}
