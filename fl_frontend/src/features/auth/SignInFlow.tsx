"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

import { usePreloadedAuthClient } from "@/core/auth/browserClient";
import { RETURN_PARAMETER, withReturnAddress } from "@/core/auth/returnAddress";
import { PUBLIC_COPY } from "@/core/copy/public";
import { COPY } from "@/core/copy/shared";
import { TURNSTILE_FIELD } from "@/core/turnstileToken";
import { SignInPage } from "@/kit/SignInPage";
import { useBotCheck } from "@/kit/useBotCheck";
import { useFormAction } from "@/kit/useFormAction";
import { leaveDocumentFor } from "@/shared/utils/documentNavigation";

import { handleSignIn } from "./actions";
import { clientRefusal, describeCeremonyRefusal } from "./passkeyAnswers";
import { codeRefusal } from "./signInAnswers";

import type { ActionAnswer } from "@/core/action";
import type { BoxRules } from "@/core/boxRules";
import type { Copy } from "@/core/copy";

/**
 * `next` is the landing every finished sign-in leaves for; `siteKey` the bot check's public key, which the page reads
 * at request time; `rules` what the send's lane asks of the address, read on the server.
 */
export function SignInFlow({ next, siteKey, rules }: { next: string; siteKey: string; rules: BoxRules }) {
  const [email, setEmail] = useState("");
  // The address a mailed link asked for, carried to the landing only where the allowlist holds it.
  const landing = withReturnAddress(next, useSearchParams().get(RETURN_PARAMETER));
  const humanCheck = useBotCheck({ siteKey, size: "compact" });

  usePreloadedAuthClient();

  // The send answers every address alike, the code on its way or the hour's limit on the address view: the code view
  // and its sentence are written here from the address the action folded and nothing else it says, so a member's
  // answer and a stranger's cannot differ.
  const send = useFormAction(
    async (address: string): Promise<ActionAnswer<string>> => {
      const request = await humanCheck.takeToken();
      if ("sentence" in request) return { ok: false, reason: request.sentence };

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

      const refusal = await clientRefusal((authClient) => authClient.signIn.emailOtp({ email: address, otp: code }));

      // A full document load and never a soft navigation: the session has just changed, so every payload the
      // router holds was rendered for somebody signed out. The view stays busy until the document goes.
      if (refusal === null) return leaveDocumentFor(landing);

      setChecking(false);
      setAttempt((count) => count + 1);
      setCodeError(codeRefusal(refusal));
    };

    // The typed code's own refusal is a phrase under its boxes; every other answer is a sentence on the status line.
    const inField = codeError === PUBLIC_COPY.signIn.refusal.codeWrong;

    return (
      <SignInPage
        view="code"
        title={PUBLIC_COPY.signIn.inbox}
        sentence={PUBLIC_COPY.signIn.codeOnItsWay}
        address={address}
        code={{
          label: PUBLIC_COPY.signIn.code,
          error: inField ? codeError : null,
          attempt,
          isBusy: checking,
          onComplete: (code) => void check(code),
        }}
        back={{
          label: PUBLIC_COPY.signIn.otherAddress,
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
  // None while a send is on its way: the last refusal is none to the send still running.
  const sendError = refused === null || send.isPending ? null : (refused.reason ?? null);

  const withPasskey = async () => {
    setPasskeyRunning(true);
    setPasskeyError(null);

    const refusal = await clientRefusal((authClient) => authClient.signIn.passkey());
    if (refusal === null) return leaveDocumentFor(landing);

    setPasskeyRunning(false);
    setPasskeyError(describeCeremonyRefusal(refusal));
  };

  return (
    <SignInPage
      view="address"
      title={COPY.page.signIn}
      address={{ label: COPY.shared.emailAddress, value: email, onChange: setEmail, error: refused?.fieldErrors, rules }}
      check={humanCheck.widget}
      send={{
        label: PUBLIC_COPY.signIn.sendCode,
        isBusy: send.isPending,
        onPress: (address) => {
          setPasskeyError(null);
          send.submit(address);
        },
      }}
      or={PUBLIC_COPY.signIn.or}
      // `isBusy` is the whole of the double-press guard: a second prompt aborts the first, which would then read
      // as a refusal of a press made while it ran.
      passkey={{ label: PUBLIC_COPY.signIn.withPasskey, isBusy: passkeyRunning, onPress: () => void withPasskey() }}
      row={passkeyError ?? sendError}
    />
  );
}
