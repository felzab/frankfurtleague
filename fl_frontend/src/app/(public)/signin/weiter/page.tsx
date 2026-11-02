import { Suspense } from "react";
import { redirect } from "next/navigation";

import { getSignInDestination } from "@/core/auth";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata, ResolvingMetadata } from "next";

/**
 * `noindex` as `/signin` spells it, and no description, as a sign-in page carries none. It carries no parameter, so
 * no return destination rides it, and the allowlist one would need first (`docs/decisions.md`, **auth**) has nothing
 * to judge.
 */
export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return {
    title: "Anmeldung",
    robots: { index: false, follow: false },
    openGraph: await openGraphFor(parent, "/signin/weiter"),
    alternates: { canonical: "/signin/weiter" },
  };
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
