import { Suspense } from "react";
import { redirect } from "next/navigation";

import { getSignInDestination } from "@/core/auth";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata } from "next";

/**
 * `noindex` as `/signin` spells it. It
 * carries no parameter, so `.claude/rules/frontend.md` **auth** has nothing to allowlist.
 */
export const metadata: Metadata = {
  title: "Anmeldung",
  description: "Anmeldung bei der Frankfurt League.",
  robots: { index: false, follow: false },
  openGraph: openGraphFor("/signin/weiter"),
  alternates: { canonical: "/signin/weiter" },
};

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
