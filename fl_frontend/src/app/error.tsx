"use client";

import { Error } from "@/shared/components/ui/Error";

export default function ErrorBoundary({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <Error
      error={error}
      retry={retry}
    />
  );
}
