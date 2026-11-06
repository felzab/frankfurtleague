import { notFound } from "next/navigation";
import { connection } from "next/server";

import { StatusPage } from "@/kit/StatusPage";

import { SERVER_COPY } from "@/core/serverCopy";
import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";

import type { Metadata } from "next";

// A page's own metadata, which the 404 it renders keeps: Next reads none off a nested boundary
// (`fl_frontend/src/app/not-found.tsx`).
export const metadata: Metadata = NOT_FOUND_METADATA;

/**
 * The 404, on a request and under the card's boundary: thrown while the build prerenders the page, it leaves a shell
 * with no frame at all (`<html id="__next_error__">`).
 */
async function miss(): Promise<never> {
  await connection();
  notFound();
}

/**
 * Every address under `/saisons` no other page answers, so a mistyped one meets the not-found page in the rail frame
 * rather than the classic one.
 */
export default function SaisonsUnmatchedPage() {
  return (
    <StatusPage
      frame="rail"
      scope="saison"
      title={SERVER_COPY.notFound}
      card={miss()}
    />
  );
}
