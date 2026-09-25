import { useEffect, useState } from "react";
import type { LinkGateSummary } from "../../shared/contracts";
import { expiryTimerDelay } from "./link-protection";

/** The current time, re-read at a link gate's expiry instant so an expiry
 *  indicator flips on time (time is not reactive state). */
export function useExpiryClock(gate: LinkGateSummary | null | undefined): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const at = new Date();
      setNow(at);
      const delay = expiryTimerDelay(gate, at);
      if (delay !== null) t = setTimeout(tick, delay);
    };
    tick();
    return () => clearTimeout(t);
  }, [gate]);
  return now;
}
