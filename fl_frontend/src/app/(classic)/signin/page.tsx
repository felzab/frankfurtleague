import { Suspense } from "react";

import { getSignedInAddress } from "@/core/auth";
import { frontend_config } from "@/core/config";
import { ROUTES } from "@/core/routes";
import { SignInFlow } from "@/features/auth/components/forms/SignInFlow";
import { SignedIn } from "@/features/auth/components/ui/SignedIn";
import { pageMetadata } from "@/shared/utils/metadata";

import type { Metadata, ResolvingMetadata } from "next";

/** No description: a sign-in page carries none. */
export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.signIn, ROUTES.signIn.path());
}

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
      next={ROUTES.signInLanding.path()}
      siteKey={frontend_config.TURNSTILE_SITE_KEY}
    />
  ) : (
    <SignedIn address={address} />
  );
}
