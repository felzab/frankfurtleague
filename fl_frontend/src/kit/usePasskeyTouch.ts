"use client";

import { useEffect, useState } from "react";

import { COPY } from "@/core/copy";

import type { Copy } from "@/core/copy";

/**
 * The passkey touch's browser half, which an act on its fixed list runs before it posts: a passkey sign-in, whose fresh
 * session the action's lane admits (`fl_frontend/src/core/action.ts`, the lane's `passkey` slot). `held` is whether
 * the person holds a passkey, which the page read; a person holding none is asked nothing, as the lane admits them.
 * The act's button stays busy while the browser's prompt stands, and the touch answers the refusal its status line
 * shows, or `null` once the passkey has answered.
 */
export function usePasskeyTouch(held: boolean) {
  const [isTouching, setTouching] = useState(false);
  // The library's client fetched once the page stands, as the sign-in fetches it, so the press keeps its gesture.
  useEffect(() => {
    if (held) void import("@/core/authClient").catch(() => undefined);
  }, [held]);

  const touch = async (): Promise<Copy | null> => {
    if (!held) return null;
    setTouching(true);
    try {
      const { authClient } = await import("@/core/authClient");
      const { error } = await authClient.signIn.passkey();
      // A cancelled prompt and a refused passkey alike: the act did not run, and the passkey did not answer for it.
      return error === null ? null : COPY.signIn.refusal.unverified;
    } catch {
      return COPY.shared.failure.unexpected;
    } finally {
      setTouching(false);
    }
  };

  return { touch, isTouching };
}
