"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@heroui/react/button";

import { authClient } from "@/core/authClient";
import { KONTAKT_EMAIL } from "@/core/brand";
import { ENROLMENT_CONFLICT, USER_VERIFICATION_REFUSED } from "@/core/passkeyRefusal";
import { formButton } from "@/shared/components/ui/formButtons";
import { SignInCard } from "@/shared/components/ui/SignInCard";
import { appToast } from "@/shared/utils/appToast";
import { leaveDocumentFor } from "@/shared/utils/documentNavigation";

/** Named off `fl_frontend/src/core/auth.ts :: PasskeyStep`, whose verdict the page hands over. */
type Step = "enrol" | "assert";

/** One column of words per step, so a heading and its control cannot drift apart. */
const STEPS = {
  enrol: {
    title: "Passkey einrichten",
    hint: "Die Verwaltung ist erst mit einem Passkey erreichbar.",
    control: "Jetzt einrichten",
    pending: "Richtet ein...",
  },
  assert: {
    title: "Mit Passkey anmelden",
    hint: "Melde Dich mit dem Passkey an, den Du eingerichtet hast.",
    control: "Jetzt anmelden",
    pending: "Meldet an...",
  },
} as const;

/** The way out alone: the toast's title has already said which of the two did not happen. */
const VERSUCHE_ES_ERNEUT = "Versuche es noch einmal.";

/**
 * The one refusal a reader can act on: the assertion ASKS for verification rather than demanding
 * it, so a passkey with no PIN and no biometric is offered by the browser and refused here.
 */
const OHNE_BESTAETIGUNG =
  "Dieser Passkey hat nicht bestätigt, dass Du es bist. Nimm einen Passkey mit PIN, Fingerabdruck oder Gesichtserkennung.";

// Said as what now stands: a retry here is refused for good, and under a stolen mailbox this toast is
// the administrator's one sign that a passkey they may not have made exists.

/** The loser of two enrolments of this account that ran at once (`docs/frontend/spec.md :: I341`). */
const GLEICHZEITIG =
  "Für diesen Zugang wurde gerade ein anderer Passkey eingerichtet. Melde Dich jetzt mit ihm an. " +
  `Hast Du keinen zweiten eingerichtet, schreib an ${KONTAKT_EMAIL}; wir löschen dann alle Passkeys dieses Zugangs.`;

/** Read off the answer rather than off its type: the client declares no `code`, and the body has one. */
const refusalCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;

/** The same, for the answer's HTTP status. */
const refusalStatus = (error: unknown): number | undefined =>
  typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined;

/** What the reader is told, and whether the step this card was handed may have moved on. */
type Held = { readonly description: string; readonly stale: boolean };

/** Why the ceremony did not complete, as far as a reader can act on it. */
async function ceremonyHeld(step: Step): Promise<Held | null> {
  try {
    // The library's own client both ways: it holds the WebAuthn call beside the two endpoints that
    // frame it, and a hand-rolled ceremony would own that pairing without owning the endpoints.
    const { error } = step === "enrol" ? await authClient.passkey.addPasskey() : await authClient.signIn.passkey();

    if (error === null) return null;

    const code = refusalCode(error);

    // The other enrolment may stand, and then the guard offers the assertion: a retry on this card
    // meets the refusal of a second link-borne enrolment for good.
    if (code === ENROLMENT_CONFLICT) return { description: GLEICHZEITIG, stale: true };

    // The guard's own refusal, which an enrolment another tab or device finished first earns too:
    // the step this card was handed is then stale in the same way.
    if (step === "enrol" && refusalStatus(error) === 404) return { description: VERSUCHE_ES_ERNEUT, stale: true };

    // A cancelled prompt and a refused one are one answer; the unverified passkey is the exception,
    // because retrying the same one repeats the refusal.
    return { description: code === USER_VERIFICATION_REFUSED ? OHNE_BESTAETIGUNG : VERSUCHE_ES_ERNEUT, stale: false };
  } catch {
    return { description: VERSUCHE_ES_ERNEUT, stale: false };
  }
}

// No control here lists or removes a passkey: this page is reached by the mailed link alone, and a
// session that could remove one would let a stolen mailbox swap the administrator's own out.

// Removal lives in the sidemenu's dialog, behind a fresh assertion, and the plugin's own three
// management paths stay refused at `fl_frontend/src/core/auth.ts :: BROWSER_PATHS` for both
// (`docs/frontend/spec.md :: I261`).

/** The card `/signin` opens the flow with, so every step of one sign-in meets one design. */
export function PasskeyForm({ step, address, next }: { step: Step; address: string; next: string }) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const words = STEPS[step];

  const run = async () => {
    setIsPending(true);

    const held = await ceremonyHeld(step);
    if (held !== null) {
      setIsPending(false);
      // Literals at the call, where `core/toastTitles.test.ts` reads a title from.
      appToast.danger(step === "enrol" ? "Passkey nicht eingerichtet" : "Nicht angemeldet", { description: held.description });
      // Re-read in place, as after an enrolment that worked, so the toast survives it.
      if (held.stale) router.refresh();
      return;
    }

    if (step === "enrol") {
      // The enrolment leaves the reader in front of the SECOND card, asking for another ceremony:
      // silent, that reads as the press having failed.

      // Literals at the call, where `core/toastTitles.test.ts` reads a title from.
      appToast.success("Passkey eingerichtet", { description: "Melde Dich jetzt damit an." });

      // This same page offers the assertion next, so it is re-read in place: the session is
      // unchanged, the guard's answer is not, and a navigation would drop the toast.
      setIsPending(false);
      router.refresh();
      return;
    }

    // Never `router.refresh()` beside a soft navigation here: the assertion replaced the session, so
    // this page's own guard redirects to the landing while the navigation redirects past it, and
    // the two left the reader on the landing for good.
    leaveDocumentFor(next);
  };

  return (
    <SignInCard title={words.title}>
      <div className="flex flex-col items-center gap-y-4 text-center">
        <p className="muted-hint text-pretty">{words.hint}</p>

        {/* The account this passkey belongs to, at the rung a person's own datum takes on a page
            (`docs/frontend/spec.md` §1.16). */}
        <p className="fluid-sm text-foreground font-bold break-all">{address}</p>

        {/* `isPending` is the whole of the double-press guard: a second prompt aborts the first,
            which this card would then report as a refusal on a press made while it ran. */}
        <Button
          type="button"
          variant="primary"
          isPending={isPending}
          onPress={() => void run()}
          className={formButton({ intent: "submit", fullWidth: true })}>
          {isPending ? words.pending : words.control}
        </Button>
      </div>
    </SignInCard>
  );
}
