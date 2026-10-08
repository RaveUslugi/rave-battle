import { useEffect, useState } from "react";
import { useGame } from "../state/game-store";

/** Current time, refreshed every `intervalMs`; drives countdowns. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Server time, refreshed every `intervalMs`: for countdowns to server timestamps. */
export function useServerNow(intervalMs: number): number {
  const now = useNow(intervalMs);
  const offset = useGame((s) => s.clockOffset);
  return now + offset;
}
