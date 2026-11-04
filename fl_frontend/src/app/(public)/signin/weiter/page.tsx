import { Suspense } from "react";
import { redirect } from "next/navigation";

import { getSignInDestination } from "@/core/auth";
import { ROUTES } from "@/core/routes";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { pageMetadata } from "@/shared/utils/metadata";

import type { Metadata, ResolvingMetadata } from "next";

/**
 * Its row's metadata, as `/signin`'s: `noindex` and no description, as a sign-in page carries none. It carries no
 * parameter, so no return destination rides it, and the allowlist one would need first (`docs/decisions.md`,
 * **auth**) has nothing to judge.
 */
export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.signInLanding, ROUTES.signInLanding.path());
}

/**
 * Resolves nothing itself: a top-level await would tie the App Shell to one URL, and this page is a
 * function of the session on the request.
 */
export default function AnmeldungWeiterPage() {
  return (
    <Suspense fallback={<ContentLoader fills="viewport" />}>
      <AnmeldungWeiterInhalt />
    </Suspense>
  );
}

async function AnmeldungWeiterInhalt() {
  // The one decision this page renders, and it decides none of it: the passkey requirement and the
  // session lifetimes are judged per request in the guard `getSignInDestination` asks.
  return redirect(await getSignInDestination());
}
