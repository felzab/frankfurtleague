import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getPasskeyStep } from "@/core/auth";
import { SIGN_IN_LANDING } from "@/core/signInLanding";
import { PasskeyForm } from "@/features/auth/components/forms/PasskeyForm";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata } from "next";

/** `noindex` as `/signin` spells it, which `fl_frontend/src/app/sitemap.test.ts` matches by path. */
export const metadata: Metadata = {
  title: "Passkey",
  description: "Passkey für die Verwaltung der Frankfurt League.",
  robots: { index: false, follow: false },
  openGraph: openGraphFor("/signin/passkey"),
  alternates: { canonical: "/signin/passkey" },
};

// Under `(public)` and never under `/bereich/admin`: the session that must reach this page is the one the
// admin guard is refusing, so a page behind that guard is a page nobody can open.

/**
 * Resolves nothing itself: a top-level await would tie the App Shell to one URL, and this page is a
 * function of the session on the request (`docs/frontend/spec.md :: I22`).
 */
export default function PasskeyPage() {
  return (
    <Suspense fallback={<ContentLoader fills="viewport" />}>
      <PasskeyInhalt />
    </Suspense>
  );
}

async function PasskeyInhalt() {
  await connection();

  // Which control stands here is the guard's answer and never this page's: the requirement it
  // enforces is judged per request, beside the three lifetimes.
  const schritt = await getPasskeyStep();
  if (schritt === null) redirect(SIGN_IN_LANDING);

  // „Später“ goes past the landing rather than to it, which would offer the passkey again.
  return schritt.step === "offer" ? (
    <PasskeyForm
      step="offer"
      address={schritt.email}
      next={SIGN_IN_LANDING}
      later="/bereich"
    />
  ) : (
    <PasskeyForm
      step={schritt.step}
      address={schritt.email}
      next={SIGN_IN_LANDING}
    />
  );
}
