import { i18n } from "../i18n";

/** Human text for a reject code from the server or from the client-side pre-check, in the interface language. */
export function rejectText(code: string): string {
  const key = `reject.${code}`;
  return i18n.exists(key) ? i18n.t(key as "reject.fallback") : i18n.t("reject.fallback");
}
