"use client";

import Error from "@/shared/components/ui/Error";
import { useEffect } from "react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Match Error:", error);
  }, [error]);

  return (
    <Error
      error={error}
      reset={reset}
    />
  );
}
