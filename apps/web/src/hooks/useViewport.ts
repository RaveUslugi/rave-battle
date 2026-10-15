import { useSyncExternalStore } from "react";

/** The desktop layout starts here; narrower screens get the phone layout. */
export const DESKTOP_QUERY = "(min-width: 900px)";

function subscribeMedia(query: string) {
  return (onChange: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  };
}

const subscribeDesktop = subscribeMedia(DESKTOP_QUERY);

/** Desktop or phone layout, by the window width (not the user agent): a narrow desktop window gets the phone layout. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}

function subscribeResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

export function useWindowWidth(): number {
  return useSyncExternalStore(
    subscribeResize,
    () => window.innerWidth,
    () => 1440,
  );
}
