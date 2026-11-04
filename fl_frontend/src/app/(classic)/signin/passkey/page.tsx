import { redirect } from "next/navigation";

import { SignInShell } from "@/kit/SignInShell";

import { getPasskeyStep } from "@/core/auth/landing";
import { RETURN_PARAMETER, withReturnAddress } from "@/core/auth/returnAddress";
import { ROUTES } from "@/core/routes";
import { PasskeyStep } from "@/features/auth/components/forms/PasskeyStep";
import { pageMetadata } from "@/shared/utils/metadata";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata, ResolvingMetadata } from "next";

/** No description, as `/signin` carries none. */
export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.signInPasskey, ROUTES.signInPasskey.path());
}

// Never under `/bereich/admin`: the session that must reach this page is the one the admin guard is
// refusing, so a page behind that guard is a page nobody can open.

/**
 * Resolves nothing itself: a top-level await would tie the static shell to one URL, and this page is a
 * function of the session on the request. It waits in the sign-in's skeleton, as `/signin` does, its title a bar:
 * the step the session reads names it.
 */
export default function PasskeyPage({ searchParams }: NextPageProps) {
  return (
    <SignInShell
      title={null}
      view={readView(searchParams)}
    />
  );
}

async function readView(searchParams: NextPageProps["searchParams"]) {
  // Which control stands here is the guard's answer and never this page's: the requirement it
  // enforces is judged per request, beside the session lifetimes.
  const schritt = await getPasskeyStep();
  if (schritt === null) {
    // A session the step does not hold goes on to the landing with the address a mailed link asked for, which the
    // landing honours where the allowlist holds it.
    const asked = (await searchParams)[RETURN_PARAMETER];
    redirect(withReturnAddress(ROUTES.signInLanding.path(), typeof asked === "string" ? asked : null));
  }

  // „Später“ goes past the landing rather than to it, which would offer the passkey again.
  return schritt.step === "offer" ? (
    <PasskeyStep
      step="offer"
      address={schritt.email}
      next={ROUTES.signInLanding.path()}
      later="/bereich"
    />
  ) : (
    <PasskeyStep
      step={schritt.step}
      address={schritt.email}
      next={ROUTES.signInLanding.path()}
    />
  );
}
