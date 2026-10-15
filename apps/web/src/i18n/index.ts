import { LOCALES, type Locale } from "@rave/shared/client";
import i18next from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import { en } from "./en";
import { ru } from "./ru";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof ru };
  }
}

/** A guest's choice; a logged-in player's choice lives on the server (settings.setLocale). */
export const LOCALE_STORAGE_KEY = "rb.locale";

const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/**
 * Interface language, first match wins: the logged-in player's choice or Discord language (`fromServer`),
 * a guest's stored choice, the browser's preferred languages, Russian.
 */
export function pickLocale(input: { fromServer?: Locale | null; stored?: string | null; languages?: readonly string[] }): Locale {
  if (input.fromServer) return input.fromServer;
  if (isLocale(input.stored)) return input.stored;
  for (const tag of input.languages ?? []) {
    const lang = tag.toLowerCase().split("-")[0];
    if (isLocale(lang)) return lang;
  }
  return "ru";
}

export function readStoredLocale(): string | null {
  try {
    return globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY) ?? null;
  } catch {
    // Private mode or blocked storage: no stored choice.
    return null;
  }
}

export function storeLocale(locale: Locale): void {
  try {
    globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Not persisted; the choice still applies for this visit.
  }
}

const initial = pickLocale({ stored: readStoredLocale(), languages: globalThis.navigator?.languages ?? [] });

export const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  resources: { ru: { translation: ru }, en: { translation: en } },
  lng: initial,
  fallbackLng: "ru",
  supportedLngs: [...LOCALES],
  // React escapes text itself.
  interpolation: { escapeValue: false },
  initAsync: false,
});

export function currentLocale(): Locale {
  return isLocale(i18n.language) ? i18n.language : "ru";
}

/** Switches the interface language and keeps <html lang> in step. */
export function applyLocale(locale: Locale): void {
  if (i18n.language !== locale) void i18n.changeLanguage(locale);
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

/** The interface language and a setter that applies it right away and remembers it. */
export function useLocale(save?: (locale: Locale) => void): [Locale, (locale: Locale) => void] {
  const { i18n: instance } = useTranslation();
  const locale = isLocale(instance.language) ? instance.language : "ru";
  return [
    locale,
    (next) => {
      applyLocale(next);
      storeLocale(next);
      save?.(next);
    },
  ];
}

export function formatNumber(n: number, locale: Locale = currentLocale()): string {
  return new Intl.NumberFormat(locale).format(n);
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1000],
];

/** "5 минут назад" / "in 2 hours": the largest whole unit between `at` and `now`. */
export function formatRelative(at: number, now: number, locale: Locale = currentLocale()): string {
  const diff = at - now;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms || unit === "second") return rtf.format(Math.trunc(diff / ms), unit);
  }
  return rtf.format(0, "second");
}

export { useTranslation };
