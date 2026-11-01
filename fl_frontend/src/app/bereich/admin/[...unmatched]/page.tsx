import { notFound } from "next/navigation";

import { requireAdminRequest } from "@/shared/utils/adminRead";
import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";

import type { Metadata } from "next";

// A page's own metadata, which the 404 it renders keeps: Next reads none off a nested boundary
// (`fl_frontend/src/app/not-found.tsx`).
export const metadata: Metadata = NOT_FOUND_METADATA;

// Reached only where every other admin route has already refused the address, so a mistyped one
// answers under the admin shell rather than under the visitor's.
export default async function AdminUnmatchedRoute() {
  // The page's own turn-away, ahead of the 404, as every admin page's.
  await requireAdminRequest();
  // Matching the address is what costs it the 404 status, wherever this call sits.
  notFound();
}
