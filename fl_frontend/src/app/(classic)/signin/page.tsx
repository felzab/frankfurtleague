import { connection } from "next/server";

import { frontend_config } from "@/core/config";
import { ROUTES } from "@/core/routes";
import { SignInFlow } from "@/features/auth/SignInFlow";
import { pageMetadata } from "@/shared/utils/metadata";

/** No description: a sign-in page carries none. */
export const metadata = pageMetadata(ROUTES.signIn);

/**
 * The sign-in form, for a visitor holding no session: the proxy sends one holding a session on to the landing before
 * this page renders.
 */
export default async function SignInPage() {
  return await readView();
}

async function readView() {
  // The key off the request's settings: a prerendered shell would carry the build's, which is none.
  await connection();
  return (
    <SignInFlow
      next={ROUTES.signInLanding.path()}
      siteKey={frontend_config.TURNSTILE_SITE_KEY}
    />
  );
}
