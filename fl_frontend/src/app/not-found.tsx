import { SERVER_COPY } from "@/core/serverCopy";
import { TO_HOME } from "@/kit/mailedLinkState";
import { ClassicStatusPage } from "@/kit/StatusCard";
import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";

import type { Metadata } from "next";

// Honoured on this root file alone, which answers an unmatched URL: a nested boundary's `metadata` names no tab after a
// page's `generateMetadata` throws, on a hard load or a client navigation, and a React `<title>` in one outlives a
// client navigation away from the 404.
export const metadata: Metadata = NOT_FOUND_METADATA;

/**
 * Every address the site has no page for: the bare card, as the root error boundary draws it, a real 404 with no
 * read behind it. It stays bare because Next hands this element to every layout's boundary, so whatever
 * it draws travels in every page's payload, and a frame here would be a frame in every response.
 */
export default function NotfoundPage() {
  return (
    <ClassicStatusPage
      tone="info"
      title={SERVER_COPY.notFound}
      next={TO_HOME}
    />
  );
}
