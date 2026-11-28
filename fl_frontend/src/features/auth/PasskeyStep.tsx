"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { usePreloadedAuthClient } from "@/core/auth/browserClient";
import { RETURN_PARAMETER, withReturnAddress } from "@/core/auth/returnAddress";
import { PUBLIC_COPY } from "@/core/copy/public";
import { COPY } from "@/core/copy/shared";
import { SignInPage } from "@/kit/SignInPage";
import { leaveDocumentFor } from "@/shared/utils/documentNavigation";

import { clientRefusal, describeCeremonyRefusal, refusalCode, SESSION_NOT_FRESH } from "./passkeyAnswers";

import type { Copy } from "@/core/copy";

/** The landing's `PasskeyStep` verdict, which the page hands over. */
type Step = "enrol" | "assert";

/** One set of words per step, so a heading and its control cannot drift apart. */
const WORDS = { enrol: PUBLIC_COPY.signIn.passkey.setUp, assert: PUBLIC_COPY.signIn.passkey.signIn };

/** What the reader is told, `null` for nothing, and whether the step this view was handed may have moved on. */
type Held = { readonly sentence: Copy | null; readonly stale: boolean };

async function ceremonyHeld(step: Step): Promise<Held | null> {
  const enrolling = step === "enrol";

  // The library's own client both ways: it holds the WebAuthn call beside the two endpoints that
  // frame it, and a hand-rolled ceremony would own that pairing without owning the endpoints.
  // `createSession`: setting the passkey up signs in with it, ending the code's session in the same step.
  const refusal = await clientRefusal((authClient) =>
    enrolling ? authClient.passkey.addPasskey({ createSession: true }) : authClient.signIn.passkey(),
  );
  if (refusal === null) return null;

  // The guard's own refusal, which an enrolment another tab or device finished first earns too, and the library's
  // for a session that aged past its `freshAge` while the card stood: the step this view was handed is then stale.
  if (enrolling && (refusal.status === 404 || refusalCode(refusal) === SESSION_NOT_FRESH)) {
    return { sentence: COPY.shared.failure.stale, stale: true };
  }

  return { sentence: describeCeremonyRefusal(refusal), stale: false };
}

// No control here lists or removes a passkey: this page is reached by the mailed code alone, and a
// session that could remove one would let a stolen mailbox swap the administrator's own out.

// Removal lives behind a fresh sign-in, and the plugin's own three management paths stay refused to the browser.

/** The requirement and the assertion have no way past them: the administration admits no session without the passkey. */
type Props = { readonly step: Step; readonly address: string; readonly next: string };

export function PasskeyStep({ step, address, next }: Props) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Copy | null>(null);
  const words = WORDS[step];
  usePreloadedAuthClient();
  // The address a mailed link asked for, carried on where the allowlist holds it.
  const asked = useSearchParams().get(RETURN_PARAMETER);

  const run = async () => {
    setIsPending(true);
    setError(null);

    const held = await ceremonyHeld(step);
    if (held !== null) {
      setIsPending(false);
      setError(held.sentence);
      // Read again in place, so the line survives it.
      if (held.stale) router.refresh();
      return;
    }

    // Never `router.refresh()` beside a soft navigation here: either ceremony replaced the session, so this
    // page's own guard redirects to the landing while the navigation redirects past it, and the two left the
    // reader on the landing for good.
    leaveDocumentFor(withReturnAddress(next, asked));
  };

  return (
    <SignInPage
      view="passkey"
      title={words.title}
      sentence={words.sentence}
      address={address}
      // `isBusy` is the whole of the double-press guard: a second prompt aborts the first, which this view would
      // then report as a refusal of a press made while it ran.
      go={{ label: words.button, isBusy: isPending, onPress: () => void run() }}
      row={error}
    />
  );
}
