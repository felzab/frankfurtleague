import { useEffect, useState } from "react";

/**
 * False on the server and on the first client render, for gating anything depending on `window`, the clock or a stored
 * preference. The suppression is deliberate: rendering differently after hydration is the point.
 */
export function useMounted() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  return mounted;
}
