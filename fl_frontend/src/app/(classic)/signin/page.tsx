import { connection } from "next/server";

import { SignInShell } from "@/kit/SignInShell";

import { frontend_config } from "@/core/config";
import { ROUTES } from "@/core/routes";
import { SignInFlow } from "@/features/auth/components/forms/SignInFlow";
import { pageMetadata } from "@/shared/utils/metadata";

import type { Metadata, ResolvingMetadata } from "next";

/** No description: a sign-in page carries none. */
export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.signIn, ROUTES.signIn.path());
}

/**
 * The sign-in form, for a visitor holding no session: the proxy sends one holding a session on to the landing before
 * this page renders.
 */
export default function SignInPage() {
  return <SignInShell view={readView()} />;
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
