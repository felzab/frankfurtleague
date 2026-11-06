import { notFound } from "next/navigation";

import { StatusPage } from "@/kit/StatusPage";

import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { requireAccountSession } from "@/features/account/account";
import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";

import type { Metadata } from "next";

// A page's own metadata, which the 404 it renders keeps: Next reads none off a nested boundary
// (`fl_frontend/src/app/not-found.tsx`).
export const metadata: Metadata = NOT_FOUND_METADATA;

/** The session's turn-away, ahead of the 404, as every Konto page sends it to the sign-in. */
async function judge(): Promise<never> {
  await requireAccountSession(ROUTES.account.path());
  notFound();
}

/**
 * Every address under `/account` no other page answers, so a mistyped one meets Konto's not-found page in the rail
 * frame rather than the visitor's in the classic one. Its card waits for the session under the not-found page's own
 * title, so the strip stands through the wait.
 */
export default function AccountUnmatchedPage() {
  return (
    <StatusPage
      frame="rail"
      scope="area"
      title={SERVER_COPY.landing.notFound}
      card={judge()}
    />
  );
}
