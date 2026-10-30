"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { SignInPage } from "@/kit/SignInPage";

import { authClient } from "@/core/authClient";
import { COPY } from "@/core/copy";
import { leaveDocumentFor } from "@/shared/utils/documentNavigation";

import { describeCeremonyRefusal, refusalStatus } from "../../passkeyAnswers";

import type { Copy } from "@/core/copy";

/** Named off `fl_frontend/src/core/auth.ts :: PasskeyStep`, whose verdict the page hands over. */
type Step = "enrol" | "assert" | "offer";

/** One set of words per step, so a heading and its control cannot drift apart. */
const WORTE = { enrol: COPY.anmeldung.passkey.einrichten, assert: COPY.anmeldung.passkey.anmelden, offer: COPY.anmeldung.passkey.angebot };

/** What the reader is told, and whether the step this view was handed may have moved on. */
type Held = { readonly satz: Copy; readonly stale: boolean };

/** Why the ceremony did not complete, as far as a reader can act on it. */
async function ceremonyHeld(step: Step): Promise<Held | null> {
  const enrolling = step !== "assert";

  try {
    // The library's own client both ways: it holds the WebAuthn call beside the two endpoints that
    // frame it, and a hand-rolled ceremony would own that pairing without owning the endpoints.

    // `createSession`: setting the passkey up signs in with it, ending the code's session in the same step.
    const { error } = enrolling ? await authClient.passkey.addPasskey({ createSession: true }) : await authClient.signIn.passkey();

    if (error === null) return null;

    // The guard's own refusal, which an enrolment another tab or device finished first earns too: the step
    // this view was handed is then stale in the same way.
    if (enrolling && refusalStatus(error) === 404) return { satz: COPY.shared.fehler.unerwartet, stale: true };

    return { satz: describeCeremonyRefusal(error), stale: false };
  } catch {
    return { satz: COPY.shared.fehler.unerwartet, stale: false };
  }
}

// No control here lists or removes a passkey: this page is reached by the mailed code alone, and a
// session that could remove one would let a stolen mailbox swap the administrator's own out.

// Removal lives behind a fresh sign-in, and the plugin's own three management paths stay refused at
// `fl_frontend/src/core/auth.ts :: BROWSER_PATHS`.

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
    leaveDocumentFor(next);
  };

  return (
    <SignInPage
      view="passkey"
      titel={worte.titel}
      satz={worte.satz}
      adresse={address}
      // `isBusy` is the whole of the double-press guard: a second prompt aborts the first, which this view would
      // then report as a refusal of a press made while it ran.
      los={{ label: worte.knopf, isBusy: isPending, onPress: () => void run() }}
      // The session is unchanged, so a soft navigation is the right tool here.
      spaeter={
        props.step === "offer"
          ? { label: COPY.anmeldung.passkey.spaeter, isDisabled: isPending, onPress: () => router.push(props.later) }
          : undefined
      }
      row={fehler}
    />
  );
}
