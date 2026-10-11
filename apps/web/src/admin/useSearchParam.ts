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

/** A query-string value kept in sync with the address bar without adding history entries; all instances stay in sync. */
export function useSearchParam(name: string): [string | null, (value: string) => void] {
  const value = useSyncExternalStore(subscribe, () => new URLSearchParams(window.location.search).get(name));
  const set = (next: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set(name, next);
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
    for (const listener of listeners) listener();
  };
  return [value, set];
}
