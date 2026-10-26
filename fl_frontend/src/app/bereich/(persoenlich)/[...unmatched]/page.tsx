import { notFound } from "next/navigation";
import { connection } from "next/server";

import { requireSubjectSession } from "@/features/funktionen/resolvers";
import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";

import type { Metadata } from "next";

// A page's own metadata, which the 404 it renders keeps: Next reads none off a nested boundary
// (`fl_frontend/src/app/not-found.tsx`).
export const metadata: Metadata = NOT_FOUND_METADATA;

// Reached only where every other `/bereich` route has already refused the address, `admin` and
// `team` among them, so a mistyped one answers under the person shell (`docs/frontend/spec.md :: I232`).
export default async function PersoenlichUnmatchedRoute() {
  await connection();
  // The page's own turn-away, ahead of the 404, as every person page's (`docs/frontend/spec.md :: I834`).
  await requireSubjectSession();
  // Matching the address is what costs it the 404 status, wherever this call sits
  // (`docs/frontend/spec.md :: I242`).
  notFound();
}
