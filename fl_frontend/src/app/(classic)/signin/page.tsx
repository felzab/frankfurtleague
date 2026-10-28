import { Suspense } from "react";
import { connection } from "next/server";

import { getSignedInAddress } from "@/core/auth";
import { frontend_config } from "@/core/config";
import { COPY } from "@/core/copy";
import { SIGN_IN_LANDING } from "@/core/signInLanding";
import { SignInFlow } from "@/features/auth/components/forms/SignInFlow";
import { SignedIn } from "@/features/auth/components/ui/SignedIn";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata } from "next";

/**
 * `noindex`, not a canonical: this is the entrance to `/bereich` and there is nothing here to rank. A
 * route declaring no metadata inherits the root layout's, which would point `/signin` at the homepage.
 * No description: a sign-in page carries none.
 */
export const metadata: Metadata = {
  title: COPY.anmeldung.titel,
  robots: { index: false, follow: false },
  openGraph: openGraphFor("/signin"),
  alternates: { canonical: "/signin" },
};

/**
 * Resolves nothing itself: the view is a function of the request's session, and a top-level await would
 * tie the static shell to one visitor. No placeholder: the wait is a session read, well under a second.
 */
export default function AnmeldenPage() {
  return (
    <Suspense>
      <Anmelden />
    </Suspense>
  );
}

async function Anmelden() {
  await connection();

  const address = await getSignedInAddress();
  // The key off the request's settings, past `connection()`: a prerendered shell would carry the build's, which is none.
  return address === null ? (
    <SignInFlow
      next={SIGN_IN_LANDING}
      siteKey={frontend_config.TURNSTILE_SITE_KEY}
    />
  ) : (
    <SignedIn address={address} />
  );
}
