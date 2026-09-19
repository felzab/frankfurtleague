import { notFound } from "next/navigation";

import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";

import type { Metadata } from "next";

// A page's own metadata, which the 404 it renders keeps: Next reads none off a nested boundary
// (`fl_frontend/src/app/not-found.tsx`).
export const metadata: Metadata = NOT_FOUND_METADATA;

// Reached only where every other dashboard route has already refused the address, so a mistyped one
// answers under the dashboard shell rather than under the visitor's (`docs/frontend/spec.md :: I232`).
export default function DashboardUnmatchedRoute() {
  // Matching the address is what costs it the 404 status, wherever this call sits
  // (`docs/frontend/spec.md :: I242`).
  notFound();
}
