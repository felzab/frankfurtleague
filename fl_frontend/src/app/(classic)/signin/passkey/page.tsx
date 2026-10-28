import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getPasskeyStep } from "@/core/auth";
import { COPY } from "@/core/copy";
import { SIGN_IN_LANDING } from "@/core/signInLanding";
import { PasskeyStep } from "@/features/auth/components/forms/PasskeyStep";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata } from "next";

/** `noindex` as `/signin` spells it, and no description either. */
export const metadata: Metadata = {
  title: COPY.anmeldung.passkeyTitel,
  robots: { index: false, follow: false },
  openGraph: openGraphFor("/signin/passkey"),
  alternates: { canonical: "/signin/passkey" },
};

// Never under `/bereich/admin`: the session that must reach this page is the one the admin guard is
// refusing, so a page behind that guard is a page nobody can open.

/**
 * Resolves nothing itself: a top-level await would tie the static shell to one URL, and this page is a
 * function of the session on the request.
 */
export default function PasskeyPage() {
  return (
    <Suspense>
      <PasskeyInhalt />
    </Suspense>
  );
}

async function PasskeyInhalt() {
  await connection();

  // Which control stands here is the guard's answer and never this page's: the requirement it
  // enforces is judged per request, beside the session lifetimes.
  const schritt = await getPasskeyStep();
  if (schritt === null) redirect(SIGN_IN_LANDING);

  // „Später“ goes past the landing rather than to it, which would offer the passkey again.
  return schritt.step === "offer" ? (
    <PasskeyStep
      step="offer"
      address={schritt.email}
      next={SIGN_IN_LANDING}
      later="/bereich"
    />
  ) : (
    <PasskeyStep
      step={schritt.step}
      address={schritt.email}
      next={SIGN_IN_LANDING}
    />
  );
}
