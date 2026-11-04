"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { SignInPage } from "@/kit/SignInPage";

import { allowedReturnAddress, RETURN_PARAMETER, withReturnAddress } from "@/core/auth/returnAddress";
import { COPY } from "@/core/copy";
import { leaveDocumentFor } from "@/shared/utils/documentNavigation";

import { describeCeremonyRefusal, refusalCode, refusalStatus, SESSION_NOT_FRESH } from "../../passkeyAnswers";

import type { Copy } from "@/core/copy";

/** Named off `fl_frontend/src/core/auth/landing.ts :: PasskeyStep`, whose verdict the page hands over. */
type Step = "enrol" | "assert" | "offer";

/** One set of words per step, so a heading and its control cannot drift apart. */
const WORTE = { enrol: COPY.signIn.passkey.setUp, assert: COPY.signIn.passkey.signIn, offer: COPY.signIn.passkey.offer };

/** What the reader is told, and whether the step this view was handed may have moved on. */
type Held = { readonly satz: Copy; readonly stale: boolean };

/** Why the ceremony did not complete, as far as a reader can act on it. */
async function ceremonyHeld(step: Step): Promise<Held | null> {
  const enrolling = step !== "assert";

  try {
    // The library's own client both ways: it holds the WebAuthn call beside the two endpoints that
    // frame it, and a hand-rolled ceremony would own that pairing without owning the endpoints.

    // `createSession`: setting the passkey up signs in with it, ending the code's session in the same step.
    const { authClient } = await import("@/core/authClient");
    const { error } = enrolling ? await authClient.passkey.addPasskey({ createSession: true }) : await authClient.signIn.passkey();

    if (error === null) return null;

    // The guard's own refusal, which an enrolment another tab or device finished first earns too, and the library's
    // for a session that aged past its `freshAge` while the card stood: the step this view was handed is then stale.
    if (enrolling && (refusalStatus(error) === 404 || refusalCode(error) === SESSION_NOT_FRESH)) {
      return { satz: COPY.shared.failure.unexpected, stale: true };
    }

    return { satz: describeCeremonyRefusal(error), stale: false };
  } catch {
    return { satz: COPY.shared.failure.unexpected, stale: false };
  }
}

// No control here lists or removes a passkey: this page is reached by the mailed code alone, and a
// session that could remove one would let a stolen mailbox swap the administrator's own out.

// Removal lives behind a fresh sign-in, and the plugin's own three management paths stay refused at
// `fl_frontend/src/core/auth/library.ts :: BROWSER_PATHS`.

/** Where „Später“ goes, which only the offer carries: the requirement and the assertion have no way past them. */
type Props = { readonly address: string; readonly next: string } & (
  { readonly step: "enrol" | "assert" } | { readonly step: "offer"; readonly later: string }
);

/** `/signin/passkey`: the passkey the code's sign-in leads to, set up or asserted, or offered with a way past. */
export function PasskeyStep(props: Props) {
  const { step, address, next } = props;
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [fehler, setFehler] = useState<Copy | null>(null);
  const worte = WORTE[step];
  // The library's client fetched once the page stands, as `SignInFlow` fetches it, so the press keeps its gesture.
  useEffect(() => void import("@/core/authClient").catch(() => undefined), []);
  // The address a mailed link asked for, which both ways on carry where the allowlist holds it.
  const asked = allowedReturnAddress(useSearchParams().get(RETURN_PARAMETER));

  const run = async () => {
    setIsPending(true);
    setFehler(null);

    const held = await ceremonyHeld(step);
    if (held !== null) {
      setIsPending(false);
      setFehler(held.satz);
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
      title={worte.title}
      sentence={worte.sentence}
      address={address}
      // `isBusy` is the whole of the double-press guard: a second prompt aborts the first, which this view would
      // then report as a refusal of a press made while it ran.
      go={{ label: worte.button, isBusy: isPending, onPress: () => void run() }}
      // The session is unchanged, so a soft navigation is the right tool here.
      later={
        props.step === "offer"
          ? { label: COPY.signIn.passkey.later, isDisabled: isPending, onPress: () => router.push(asked ?? props.later) }
          : undefined
      }
      row={fehler}
    />
  );
}
