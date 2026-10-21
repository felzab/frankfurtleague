import { notFound } from "next/navigation";
import { connection } from "next/server";

import { requireAdminRequest } from "@/shared/utils/adminRead";
import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";

import type { Metadata } from "next";

// A page's own metadata, which the 404 it renders keeps: Next reads none off a nested boundary
// (`fl_frontend/src/app/not-found.tsx`).
export const metadata: Metadata = NOT_FOUND_METADATA;

// Reached only where every other admin route has already refused the address, so a mistyped one
// answers under the admin shell rather than under the visitor's (`docs/frontend/spec.md :: I232`).
export default async function AdminUnmatchedRoute() {
  await connection();
  // The page's own turn-away, ahead of the 404, as every admin page's (`docs/frontend/spec.md :: I834`).
  await requireAdminRequest();
  // Matching the address is what costs it the 404 status, wherever this call sits
  // (`docs/frontend/spec.md :: I242`).
  notFound();
}
