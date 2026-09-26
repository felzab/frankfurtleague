"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@heroui/react/button";

import { authClient } from "@/core/authClient";
import { KONTAKT_EMAIL } from "@/core/brand";
import { ENROLMENT_CONFLICT } from "@/core/passkeyRefusal";
import { formButton } from "@/shared/components/ui/formButtons";
import { SignInCard } from "@/shared/components/ui/SignInCard";
import { appToast } from "@/shared/utils/appToast";
import { leaveDocumentFor } from "@/shared/utils/documentNavigation";

import { describeCeremonyRefusal, refusalCode, refusalStatus, VERSUCHE_ES_ERNEUT } from "../../passkeyAnswers";

/** Named off `fl_frontend/src/core/auth.ts :: PasskeyStep`, whose verdict the page hands over. */
type Step = "enrol" | "assert" | "offer";

/** One column of words per step, so a heading and its control cannot drift apart. */
const STEPS = {
  enrol: {
    title: "Passkey einrichten",
    hint: ["Die Verwaltung ist erst mit einem Passkey erreichbar."],
    control: "Jetzt einrichten",
    pending: "Richtet ein...",
  },
  assert: {
    title: "Mit Passkey anmelden",
    hint: ["Melde Dich mit dem Passkey an, den Du eingerichtet hast."],
    control: "Jetzt anmelden",
    pending: "Meldet an...",
  },
  offer: {
    title: "Passkey einrichten",
    hint: [
      "Mit einem Passkey meldest Du Dich künftig ohne Code an, mit Fingerabdruck, Gesicht oder der Displaysperre Deines Geräts.",
      "Was ist ein Passkey? Ein digitaler Schlüssel, den Dein Gerät sicher speichert.",
      "Wo wird er gespeichert? In Deinem Passwortmanager, zum Beispiel im iCloud-Schlüsselbund oder im Google Passwortmanager, damit Du Dich auch auf Deinen anderen Geräten anmelden kannst.",
      "Richte ihn nur auf Deinem eigenen Gerät ein.",
    ],
    control: "Jetzt einrichten",
    pending: "Richtet ein...",
  },
} as const;

// Said as what now stands: a retry here is refused for good, and under a stolen mailbox this toast is
// the administrator's one sign that a passkey they may not have made exists.

/** The loser of two enrolments of this account that ran at once (`docs/frontend/spec.md :: I341`). */
const GLEICHZEITIG =
  "Für diesen Zugang wurde gerade ein anderer Passkey eingerichtet. Melde Dich jetzt mit ihm an. " +
  `Hast Du keinen zweiten eingerichtet, schreib an ${KONTAKT_EMAIL}; wir löschen dann alle Passkeys dieses Zugangs.`;

/** What the reader is told, and whether the step this card was handed may have moved on. */
type Held = { readonly description: string; readonly stale: boolean };

/** Why the ceremony did not complete, as far as a reader can act on it. */
async function ceremonyHeld(step: Step): Promise<Held | null> {
  const enrolling = step !== "assert";

  try {
    // The library's own client both ways: it holds the WebAuthn call beside the two endpoints that
    // frame it, and a hand-rolled ceremony would own that pairing without owning the endpoints.

    // `createSession`: setting the passkey up signs in with it, ending the code's session in the
    // same step (`docs/frontend/spec.md :: I399`).
    const { error } = enrolling ? await authClient.passkey.addPasskey({ createSession: true }) : await authClient.signIn.passkey();

    if (error === null) return null;

    const code = refusalCode(error);

    // The other enrolment may stand, and then the guard offers the assertion: a retry on this card
    // meets the refusal of a second code-borne enrolment for good.
    if (code === ENROLMENT_CONFLICT) return { description: GLEICHZEITIG, stale: true };

    // The guard's own refusal, which an enrolment another tab or device finished first earns too:
    // the step this card was handed is then stale in the same way.
    if (enrolling && refusalStatus(error) === 404) return { description: VERSUCHE_ES_ERNEUT, stale: true };

    return { description: describeCeremonyRefusal(error), stale: false };
  } catch {
    return { description: VERSUCHE_ES_ERNEUT, stale: false };
  }
}

// No control here lists or removes a passkey: this page is reached by the mailed code alone, and a
// session that could remove one would let a stolen mailbox swap the administrator's own out.

// Removal lives behind a fresh sign-in, and the plugin's own three management paths stay refused at
// `fl_frontend/src/core/auth.ts :: BROWSER_PATHS` (`docs/frontend/spec.md :: I261`).

/** Where „Später“ goes, which only the offer carries: the requirement and the assertion have no way past them. */
type Props = { readonly address: string; readonly next: string } & (
  { readonly step: "enrol" | "assert" } | { readonly step: "offer"; readonly later: string }
);

/** The card `/signin` opens the flow with, so every step of one sign-in meets one design. */
export function PasskeyForm(props: Props) {
  const { step, address, next } = props;
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const words = STEPS[step];

  const run = async () => {
    setIsPending(true);

    const held = await ceremonyHeld(step);
    if (held !== null) {
      setIsPending(false);
      appToast.danger(step === "assert" ? "Nicht angemeldet" : "Passkey nicht eingerichtet", { description: held.description });
      // Re-read in place, so the toast survives it.
      if (held.stale) router.refresh();
      return;
    }

    // Never `router.refresh()` beside a soft navigation here: either ceremony replaced the session, so
    // this page's own guard redirects to the landing while the navigation redirects past it, and the
    // two left the reader on the landing for good.
    leaveDocumentFor(next);
  };

  return (
    <SignInCard title={words.title}>
      <div className="flex flex-col items-center gap-y-4 text-center">
        {words.hint.map((sentence) => (
          <p
            key={sentence}
            className="muted-hint text-pretty">
            {sentence}
          </p>
        ))}

        {/* The account this passkey belongs to, at the rung a person's own datum takes on a page
            (`docs/frontend/spec.md` §1.16). */}
        <p className="fluid-sm font-bold break-all text-foreground">{address}</p>

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

        {/* The session is unchanged, so a soft navigation is the right tool here. */}
        {props.step === "offer" && (
          <Button
            type="button"
            variant="secondary"
            isDisabled={isPending}
            onPress={() => router.push(props.later)}
            className={formButton({ intent: "cancel", fullWidth: true })}>
            Später
          </Button>
        )}
      </div>
    </SignInCard>
  );
}
