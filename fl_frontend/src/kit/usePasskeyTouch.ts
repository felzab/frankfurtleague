"use client";

import { useEffect, useState } from "react";

import { COPY } from "@/core/copy";

import type { Copy } from "@/core/copy";

/**
 * The passkey touch's browser half, which an act on its fixed list runs before anything else, a question included: a
 * passkey sign-in, whose fresh session the action's lane admits (`fl_frontend/src/core/action.ts`, the lane's `passkey`
 * slot). `held` is whether the person holds a passkey, which the page read; a person holding none is asked nothing, as
 * the lane admits them. `run` asks the touch and then runs the act; where the passkey did not answer, the act never
 * runs and `refusal` holds the line the act's status line shows, cleared by the next run. The act's button stays busy
 * while the browser's prompt stands.
 */
export function usePasskeyTouch(held: boolean) {
  const [isTouching, setTouching] = useState(false);
  // The touch's own refusal: the act never ran, so no answer of its says it.
  const [refusal, setRefusal] = useState<Copy | null>(null);
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

  /** The touch, then the act; the refusal where the act did not run, which `refusal` holds too. */
  const run = async (act: () => void): Promise<Copy | null> => {
    setRefusal(null);
    const refused = await touch();
    if (refused === null) act();
    else setRefusal(refused);
    return refused;
  };

  return { run, refusal, isTouching };
}
