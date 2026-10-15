import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** True when the system asks for reduced motion; effects then render still. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => globalThis.matchMedia?.(QUERY).matches ?? false);
  useEffect(() => {
    const mq = globalThis.matchMedia?.(QUERY);
    if (!mq) return;
    const update = () => setReduced(mq.matches);
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return reduced;
}
