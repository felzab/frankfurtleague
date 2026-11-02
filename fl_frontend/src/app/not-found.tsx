import { StatusPage } from "@/kit/StatusPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { NOT_FOUND_METADATA } from "@/shared/utils/notFoundMetadata";

import { Classic } from "./(classic)/frame";

import type { Metadata } from "next";

// Honoured on this root file alone, which answers an unmatched URL: Next reads no `metadata` off a
// nested boundary, and a React `<title>` in one outlives a client navigation away from the 404.
export const metadata: Metadata = NOT_FOUND_METADATA;

// Wears the classic frame itself: an unmatched URL renders under the root layout alone. A public route's own
// `notFound()` meets `fl_frontend/src/app/(public)/not-found.tsx` instead, inside the layout that already
// draws its shell.
export default function NotfoundPage() {
  const words = SERVER_COPY.landing.notFound;
  return (
    <Classic>
      <StatusPage
        frame="classic"
        mark="info"
        title={words.title}
        sentence={words.sentence}
        next={{ label: COPY.shared.end.toHome, href: ROUTES.home.path() }}
      />
    </Classic>
  );
}
