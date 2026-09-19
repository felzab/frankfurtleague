import { NotFound } from "@/shared/components/ui/NotFound";

/*
  Below `fl_frontend/src/app/(public)/layout.tsx`, so a public route's `notFound()` renders inside
  the shell that layout draws. Without it Turbopack hands this first-level group
  `fl_frontend/src/app/not-found.tsx`, which draws a second shell inside the first.
*/
export default function PublicNotFound() {
  return <NotFound />;
}
