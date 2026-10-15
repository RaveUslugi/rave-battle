export const LOCALES = ["ru", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Discord UI language tag → interface language; null when we have no translation for it. */
export function localeFromDiscord(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const lang = tag.toLowerCase().split("-")[0];
  return lang === "ru" || lang === "en" ? lang : null;
}
