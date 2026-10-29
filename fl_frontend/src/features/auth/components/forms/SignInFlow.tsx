"use client";

import { useState } from "react";

import { SignInPage } from "@/kit/SignInPage";
import { useFormAction } from "@/kit/useFormAction";

import { authClient } from "@/core/authClient";
import { COPY } from "@/core/copy";
import { TURNSTILE_FIELD } from "@/core/turnstileToken";
import { hasFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { useTurnstile } from "@/shared/hooks/useTurnstile";
import { leaveDocumentFor } from "@/shared/utils/documentNavigation";
import { postPublicForm } from "@/shared/utils/publicSubmit";

import { handleSignIn } from "../../actions";
import { CEREMONY_ABORTED, describeCeremonyRefusal, refusalCode } from "../../passkeyAnswers";
import { signInAnswer } from "../../signInAnswers";

import type { Copy } from "@/core/copy";
import type { ActionAnswer } from "@/kit/useFormAction";
import type { PublicEnvelope } from "@/shared/utils/publicSubmit";

/** The route handler a typed code is checked at (`fl_frontend/src/app/api/signin/code/route.ts`). */
const CODE_ENDPOINT = "/api/signin/code";

/**
 * `/signin` for somebody signed out: the address and its send, the six boxes for the mailed code, and the
 * passkey by its button alone. `next` is the landing every finished sign-in leaves for; `siteKey` the bot
 * check's public key, which the page reads at request time.
 */
export function SignInFlow({ next, siteKey }: { next: string; siteKey: string }) {
  const [email, setEmail] = useState("");
  const humanCheck = useTurnstile(siteKey, COPY.anmeldung.pruefungNichtGeladen);

  // The send answers every address alike: the code view and its sentence are written here from the address
  // the action folded, never from what the action says, so a member's answer and a stranger's cannot differ.
  const send = useFormAction(
    async (address: string): Promise<ActionAnswer<string>> => {
      const anfrage = await humanCheck.takeToken();
      if ("satz" in anfrage) return { ok: false, reason: signInAnswer(anfrage.satz) };

      const submitted = new FormData();
      submitted.set("email", address);
      submitted.set(TURNSTILE_FIELD, anfrage.token);
      const state = await handleSignIn(undefined, submitted);

      // `null` is the action's initial state alone, which no send answers.
      if (state === null) return { ok: false, reason: COPY.shared.fehler.unerwartet };
      if (state.success) return { ok: true, value: state.submittedEmail ?? address };
      // A malformed address is the field's: the one message the kit's field shows for it.
      if (hasFieldErrors(state.fieldErrors))
        return { ok: false, fieldErrors: { email: COPY.shared.feld.format(COPY.shared.feld.beispielAdresse) } };
      return { ok: false, reason: signInAnswer(state.error) };
    },
    { resetOnLeave: false },
  );

  // „Andere E-Mail-Adresse verwenden“ sets the answer it leaves aside: the address view returns with the
  // address kept, and one press sends a new code.
  const [verlassen, setVerlassen] = useState<ActionAnswer<string> | null>(null);

  const [passkeyLaeuft, setPasskeyLaeuft] = useState(false);
  const [passkeyFehler, setPasskeyFehler] = useState<Copy | null>(null);

  const [versuch, setVersuch] = useState(0);
  const [pruefe, setPruefe] = useState(false);
  const [codeFehler, setCodeFehler] = useState<Copy | null>(null);

  const answer = send.answer;

  if (answer?.ok === true && answer !== verlassen) {
    const address = answer.value;

    const check = async (code: string) => {
      // The sixth digit sends by itself, so a second complete code while one is checked is no second check.
      if (pruefe) return;
      setPruefe(true);
      setCodeFehler(null);

      const checked = await postPublicForm<PublicEnvelope & { bereits?: boolean }>(CODE_ENDPOINT, { email: address, code });

      // A full document load and never a soft navigation: the session has just changed, so every payload the
      // router holds was rendered for somebody signed out. The view stays busy until the document goes.
      if (checked.answered && checked.body.success) return leaveDocumentFor(next);

      setPruefe(false);
      setVersuch((count) => count + 1);
      if (checked.answered) setCodeFehler(signInAnswer(checked.body.error));
      // The edge's own rate refusal checked nothing; any other answer not this application's may have.
      else setCodeFehler(checked.wroteNothing ? COPY.shared.fehler.zuVieleVersuche : COPY.shared.fehler.unerwartet);
    };

    return (
      <SignInPage
        view="code"
        titel={COPY.anmeldung.postfach}
        satz={COPY.anmeldung.codeUnterwegs}
        adresse={address}
        code={{ label: COPY.anmeldung.code, versuch, isDisabled: pruefe, onComplete: (code) => void check(code) }}
        zurueck={{
          label: COPY.anmeldung.andereAdresse,
          isDisabled: pruefe,
          onPress: () => {
            setCodeFehler(null);
            setVerlassen(answer);
          },
        }}
        zeile={codeFehler}
      />
    );
  }

  const refused = answer !== null && answer !== verlassen && !answer.ok ? answer : null;
  // None while a send is on its way, as the kit's `statusOf` answers, so the same refusal twice is announced twice.
  const sendFehler = refused === null || send.isPending ? null : (refused.reason ?? null);

  const mitPasskey = async () => {
    setPasskeyLaeuft(true);
    setPasskeyFehler(null);

    // A rejection reaches no error boundary from here, and would leave the button busy for good.
    const error = await authClient.signIn.passkey().then(
      (result) => result.error,
      (failed: unknown) => failed,
    );
    if (error === null) return leaveDocumentFor(next);

    setPasskeyLaeuft(false);
    // Aborted by a ceremony started after it, which is no failure of the reader's.
    if (refusalCode(error) !== CEREMONY_ABORTED) setPasskeyFehler(describeCeremonyRefusal(error));
  };

  return (
    <SignInPage
      view="adresse"
      titel={COPY.anmeldung.titel}
      adresse={{ label: COPY.anmeldung.adresse, value: email, onChange: setEmail, fehler: refused?.fieldErrors }}
      pruefung={humanCheck.widget}
      senden={{
        label: COPY.anmeldung.codeSenden,
        isBusy: send.isPending,
        onPress: () => {
          // The busy button is not the whole guard: `Enter` in the field submits too, and a second send mid-flight
          // would mail a second code.
          if (send.isPending) return;
          setPasskeyFehler(null);
          send.submit(email);
        },
      }}
      oder={COPY.anmeldung.oder}
      // `isBusy` is the whole of the double-press guard: a second prompt aborts the first, which would then read
      // as a refusal of a press made while it ran.
      passkey={{ label: COPY.anmeldung.mitPasskey, isBusy: passkeyLaeuft, onPress: () => void mitPasskey() }}
      zeile={passkeyFehler ?? sendFehler}
    />
  );
}
