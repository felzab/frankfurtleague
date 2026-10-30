import { Suspense } from "react";

import { getSignedInAddress } from "@/core/auth";
import { frontend_config } from "@/core/config";
import { ROUTES } from "@/core/routes";
import { SIGN_IN_LANDING } from "@/core/signInLanding";
import { SignInFlow } from "@/features/auth/components/forms/SignInFlow";
import { SignedIn } from "@/features/auth/components/ui/SignedIn";
import { pageMetadata } from "@/shared/utils/metadata";

import type { Metadata } from "next";

/** No description: a sign-in page carries none. */
export const metadata: Metadata = pageMetadata(ROUTES.anmeldung, ROUTES.anmeldung.path());

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
  const address = await getSignedInAddress();
  // The key off the request's settings, past the session read: a prerendered shell would carry the build's, which is none.
  return address === null ? (
    <SignInFlow
      next={SIGN_IN_LANDING}
      siteKey={frontend_config.TURNSTILE_SITE_KEY}
    />
  ) : (
    <SignedIn address={address} />
  );
}
