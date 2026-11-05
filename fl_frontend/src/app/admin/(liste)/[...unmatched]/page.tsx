import { notFound } from "next/navigation";

import { requireAdminRequest } from "@/shared/utils/adminRead";
import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";

import type { Metadata } from "next";

// A page's own metadata, which the 404 it renders keeps: Next reads none off a nested boundary
// (`fl_frontend/src/app/not-found.tsx`).
export const metadata: Metadata = NOT_FOUND_METADATA;

/**
 * Every address under `/admin` no other page answers, so a mistyped one meets the administration's not-found page in
 * the rail frame rather than the visitor's in the classic one. A session the area turns away is sent to the sign-in
 * first, as every page of the area sends it.
 */
export default async function AdminUnmatchedPage() {
  await requireAdminRequest();
  notFound();
}
