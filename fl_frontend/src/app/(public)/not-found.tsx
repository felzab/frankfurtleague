// Redesign: goes with the (public) group's last page.
import { StatusCard } from "@/kit/StatusPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";

/*
  Below `fl_frontend/src/app/(public)/layout.tsx`, so a public route's `notFound()` renders inside
  the shell that layout draws. Without it Turbopack hands this first-level group
  `fl_frontend/src/app/not-found.tsx`, which draws a second frame inside the shell. The card alone, since the
  shell already writes the page's `main`.
*/
export default function PublicNotFound() {
  const words = SERVER_COPY.landing.notFound;
  return (
    <StatusCard
      mark="info"
      title={words.title}
      sentence={words.sentence}
      next={{ label: COPY.shared.end.toHome, href: ROUTES.home.path() }}
    />
  );
}
