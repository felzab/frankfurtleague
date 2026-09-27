import { Suspense } from "react";
import { connection } from "next/server";

import { getSignedInAddress } from "@/core/auth";
import { SIGN_IN_LANDING } from "@/core/signInLanding";
import { SignInForm } from "@/features/auth/components/forms/SignInForm";
import { SignedInCard } from "@/features/auth/components/ui/SignedInCard";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata } from "next";

/**
 * `noindex`, not a canonical: this is the entrance to `/bereich` and there is nothing here to rank. A
 * route declaring no metadata inherits the root layout's, which would point `/signin` at the homepage.
 */
export const metadata: Metadata = {
  title: "Anmelden",
  description: "Anmeldung bei der Frankfurt League.",
  robots: { index: false, follow: false },
  openGraph: openGraphFor("/signin"),
  alternates: { canonical: "/signin" },
};

/** Resolves nothing itself, for `/signin/weiter`'s reason: the card is a function of the request's session. */
export default function SignInPage() {
  return (
    <Suspense fallback={<ContentLoader fills="viewport" />}>
      <AnmeldenInhalt />
    </Suspense>
  );
}

async function AnmeldenInhalt() {
  await connection();

  const address = await getSignedInAddress();
  return address === null ? <SignInForm next={SIGN_IN_LANDING} /> : <SignedInCard address={address} />;
}
