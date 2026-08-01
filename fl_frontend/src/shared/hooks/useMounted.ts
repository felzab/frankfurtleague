/**
 * SHARED · mount detection
 *
 * Returns false on the server and on the first client render, true afterwards.
 *
 * For gating content that would otherwise produce a hydration mismatch — anything depending on
 * `window`, the current time, or a stored preference. The eslint suppression is deliberate: setting
 * state in an effect is exactly the mechanism here, since the point is to render differently after
 * hydration.
 */

import { useEffect, useState } from "react";

export function useMounted() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  return mounted;
}
