"use client";

import { Error } from "@/shared/components/ui/Error";

/*
  Below `fl_frontend/src/app/(public)/layout.tsx` rather than at the root, so Next renders it inside
  `PublicShell`: a visitor whose page failed keeps the navigation and the footer.
*/
export default function PublicErrorBoundary({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <Error
      error={error}
      retry={retry}
      fills="shell"
    />
  );
}
