"use client";

import { useEffect } from "react";

/**
 * The field and the address bar in one component, because the strip is safe only while the field
 * holds the token: parted, a reader meets a page whose button posts nothing.
 */
export function SignInTokenField({ token }: { token: string }) {
  useEffect(() => {
    // The bare path after hydration, so the address bar, a screenshot and the history entry carry
    // no token. Unconditional: this field stands only where the link brought one.
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  return (
    <input
      type="hidden"
      name="token"
      value={token}
    />
  );
}
