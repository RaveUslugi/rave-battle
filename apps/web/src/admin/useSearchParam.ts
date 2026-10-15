import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

const read = () => window.location.search;

export type ParamUpdate = Record<string, string | number | null | undefined>;

/** Changes the query string; `reset` drops every other parameter (switching admin pages). Null removes a parameter. */
export function setSearchParams(update: ParamUpdate, reset = false): void {
  const params = reset ? new URLSearchParams() : new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(update)) {
    if (value === null || value === undefined || value === "") params.delete(key);
    else params.set(key, String(value));
  }
  const search = params.size > 0 ? `?${params}` : "";
  // Page switches are history entries (Back works); edits within a page replace the current one.
  if (reset) window.history.pushState(null, "", `${window.location.pathname}${search}`);
  else window.history.replaceState(null, "", `${window.location.pathname}${search}`);
  for (const listener of listeners) listener();
}

/** The query string, kept in sync with the address bar across all components. */
export function useSearchParams(): [URLSearchParams, typeof setSearchParams] {
  const search = useSyncExternalStore(subscribe, read);
  return [new URLSearchParams(search), setSearchParams];
}

export function useSearchParam(name: string): [string | null, (value: string | null) => void] {
  const [params] = useSearchParams();
  return [params.get(name), (value) => setSearchParams({ [name]: value })];
}
