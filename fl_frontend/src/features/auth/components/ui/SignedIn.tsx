"use client";

import { useState } from "react";

import { SignInPage } from "@/kit/SignInPage";

import { COPY } from "@/core/copy";
import { SIGN_IN_LANDING } from "@/core/signInLanding";
import { leaveDocumentFor } from "@/shared/utils/documentNavigation";
import { signOut } from "@/shared/utils/signOut";

import type { Copy } from "@/core/copy";

/**
 * `/signin` for somebody already signed in, instead of a second sign-in: its passkey would list the
 * signed-in account's passkeys alone, and a code would replace the session this reader holds.
 */
export function SignedIn({ address }: { address: string }) {
  const [isPending, setIsPending] = useState(false);
  const [fehler, setFehler] = useState<Copy | null>(null);

  const abmelden = async () => {
    setIsPending(true);
    setFehler(null);

    const result = await signOut().catch(() => null);
    // A full document load, as Next's guide advises for a sign-out: a soft navigation keeps every hidden route
    // with its rows and typed text.
    if (result?.success === true) return leaveDocumentFor("/");

    setIsPending(false);
    setFehler(COPY.shared.fehler.unerwartet);
  };

  return (
    <SignInPage
      view="angemeldet"
      titel={COPY.anmeldung.titel}
      satz={COPY.anmeldung.angemeldetAls}
      adresse={address}
      // A link and never a press: the landing decides where a signed-in visitor goes, as after every sign-in.
      continue={{ label: COPY.shared.uebersicht, href: SIGN_IN_LANDING }}
      // One press, as every sign-out is.
      signOut={{ label: COPY.shared.verb.abmelden, isBusy: isPending, onPress: () => void abmelden() }}
      row={fehler}
    />
  );
}
