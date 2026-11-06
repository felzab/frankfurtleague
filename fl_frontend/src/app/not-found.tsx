import { StatusPage } from "@/kit/StatusPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";

import type { Metadata } from "next";

// Honoured on this root file alone, which answers an unmatched URL: Next reads no `metadata` off a
// nested boundary, and a React `<title>` in one outlives a client navigation away from the 404.
export const metadata: Metadata = NOT_FOUND_METADATA;

/**
 * Every address the site has no page for: the bare card, as the root `fl_frontend/src/app/error.tsx` draws it, a real
 * 404 with no read behind it. It stays bare because Next hands this element to every layout's boundary, so whatever
 * it draws travels in every page's payload, and a frame here would be a frame in every response.
 */
export default function NotfoundPage() {
  return (
    <StatusPage
      frame="classic"
      tone="info"
      title={SERVER_COPY.notFound}
      next={{ label: COPY.shared.end.toHome, href: ROUTES.home.path() }}
    />
  );
}
