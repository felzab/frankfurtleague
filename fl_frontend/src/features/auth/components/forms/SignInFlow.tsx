"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

import { SignInPage } from "@/kit/SignInPage";
import { useFormAction } from "@/kit/useFormAction";

import { loadAuthClient, usePreloadedAuthClient } from "@/core/auth/browserClient";
import { RETURN_PARAMETER, withReturnAddress } from "@/core/auth/returnAddress";
import { COPY } from "@/core/copy";
import { TURNSTILE_FIELD } from "@/core/turnstileToken";
import { useTurnstile } from "@/shared/hooks/useTurnstile";
import { leaveDocumentFor } from "@/shared/utils/documentNavigation";

import { handleSignIn } from "../../actions";
import { CEREMONY_ABORTED, describeCeremonyRefusal, refusalCode } from "../../passkeyAnswers";
import { codeRefusal, signInAnswer } from "../../signInAnswers";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";

/**
 * `/signin` for somebody signed out: the address and its send, the six boxes for the mailed code, and the
 * passkey by its button alone. `next` is the landing every finished sign-in leaves for; `siteKey` the bot
 * check's public key, which the page reads at request time.
 */
export function SignInFlow({ next, siteKey }: { next: string; siteKey: string }) {
  const [email, setEmail] = useState("");
  // The address a mailed link asked for, carried to the landing only where the allowlist holds it.
  const landing = withReturnAddress(next, useSearchParams().get(RETURN_PARAMETER));
  const humanCheck = useTurnstile(siteKey);

  usePreloadedAuthClient();

  // The send answers every address alike: the code view and its sentence are written here from the address
  // the action folded, never from what the action says, so a member's answer and a stranger's cannot differ.
  const send = useFormAction(
    async (address: string): Promise<ActionAnswer<string>> => {
      const request = await humanCheck.takeToken();
      if ("sentence" in request) return { ok: false, reason: signInAnswer(request.sentence) };

      const submitted = new FormData();
      submitted.set("email", address);
      submitted.set(TURNSTILE_FIELD, request.token);
      return handleSignIn(submitted);
    },
    { resetOnLeave: false },
  );

  // „Andere E-Mail-Adresse verwenden“ sets the answer it leaves aside: the address view returns with the
  // address kept, and one press sends a new code.
  const [left, setLeft] = useState<ActionAnswer<string> | null>(null);

  const [passkeyRunning, setPasskeyRunning] = useState(false);
  const [passkeyError, setPasskeyError] = useState<Copy | null>(null);

  const [attempt, setAttempt] = useState(0);
  const [checking, setChecking] = useState(false);
  const [codeError, setCodeError] = useState<Copy | null>(null);

  const answer = send.answer;

  if (answer?.ok === true && answer !== left) {
    const address = answer.value;

    const check = async (code: string) => {
      // The sixth digit sends by itself, so a second complete code while one is checked is no second check.
      if (checking) return;
      setChecking(true);
      setCodeError(null);

      // A rejection, a network that failed, reaches no error boundary from here and would leave the boxes busy for good.
      const error = await loadAuthClient()
        .then((authClient) => authClient.signIn.emailOtp({ email: address, otp: code }))
        .then(
          (result) => result.error,
          (failed: unknown) => failed,
        );

      // A full document load and never a soft navigation: the session has just changed, so every payload the
      // router holds was rendered for somebody signed out. The view stays busy until the document goes.
      if (error === null) return leaveDocumentFor(landing);

      setChecking(false);
      setAttempt((count) => count + 1);
      setCodeError(codeRefusal(error));
    };

    // The typed code's own refusal is a phrase under its boxes; every other answer is a sentence on the status line.
    const inField = codeError === COPY.signIn.refusal.codeWrong;

    return (
      <SignInPage
        view="code"
        title={COPY.signIn.inbox}
        sentence={COPY.signIn.codeOnItsWay}
        address={address}
        code={{
          label: COPY.signIn.code,
          error: inField ? codeError : null,
          attempt: attempt,
          isDisabled: checking,
          onComplete: (code) => void check(code),
        }}
        back={{
          label: COPY.signIn.otherAddress,
          isDisabled: checking,
          onPress: () => {
            setCodeError(null);
            setLeft(answer);
          },
        }}
        row={inField ? null : codeError}
      />
    );
  }

  const refused = answer !== null && answer !== left && !answer.ok ? answer : null;
  // None while a send is on its way, as the kit's `statusOf` answers, so the same refusal twice is announced twice.
  const sendError = refused === null || send.isPending ? null : (refused.reason ?? null);

  const withPasskey = async () => {
    setPasskeyRunning(true);
    setPasskeyError(null);

    // A rejection reaches no error boundary from here, and would leave the button busy for good.
    const error = await loadAuthClient()
      .then((authClient) => authClient.signIn.passkey())
      .then(
        (result) => result.error,
        (failed: unknown) => failed,
      );
    if (error === null) return leaveDocumentFor(landing);

    setPasskeyRunning(false);
    // Aborted by a ceremony started after it, which is no failure of the reader's.
    if (refusalCode(error) !== CEREMONY_ABORTED) setPasskeyError(describeCeremonyRefusal(error));
  };

  return (
    <SignInPage
      view="address"
      title={COPY.signIn.title}
      address={{ label: COPY.signIn.address, value: email, onChange: setEmail, error: refused?.fieldErrors }}
      check={humanCheck.widget}
      send={{
        label: COPY.signIn.sendCode,
        isBusy: send.isPending,
        onPress: () => {
          // The busy button is not the whole guard: `Enter` in the field submits too, and a second send mid-flight
          // would mail a second code.
          if (send.isPending) return;
          setPasskeyError(null);
          send.submit(email);
        },
      }}
      or={COPY.signIn.or}
      // `isBusy` is the whole of the double-press guard: a second prompt aborts the first, which would then read
      // as a refusal of a press made while it ran.
      passkey={{ label: COPY.signIn.withPasskey, isBusy: passkeyRunning, onPress: () => void withPasskey() }}
      row={passkeyError ?? sendError}
    />
  );
}
