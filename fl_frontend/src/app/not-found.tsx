import { ServerIsLive } from "@/features/system/components/ui/ServerIsLive";
import { PublicShell } from "@/shared/components/layout/shell/PublicShell";
import { NotFound } from "@/shared/components/ui/NotFound";
import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";

import type { Metadata } from "next";

// Honoured on this root file alone, which answers an unmatched URL: Next reads no `metadata` off a
// nested boundary, and a React `<title>` in one outlives a client navigation away from the 404.
export const metadata: Metadata = NOT_FOUND_METADATA;

// Wears the shell itself: an unmatched URL renders under the root layout alone. A public route's own
// `notFound()` meets `fl_frontend/src/app/(public)/not-found.tsx` instead, inside the layout that
// already draws one.
export default function NotfoundPage() {
  return (
    <PublicShell serverStatusSlot={<ServerIsLive />}>
      <NotFound />
    </PublicShell>
  );
}
