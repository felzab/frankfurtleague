"use client";

import { Error } from "@/shared/components/ui/Error";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Error
      error={error}
      reset={reset}
    />
  );
}
