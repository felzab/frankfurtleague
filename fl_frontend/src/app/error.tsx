"use client";

import Error from "@/shared/components/ui/Error";

// No console.error here: server errors are already redacted by Next to a message plus a digest, and
// client errors are the user's own code. The digest shown to the user is written server-side by
// instrumentation.ts, which is what makes a reported "Fehler-Code" greppable.
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Error
      error={error}
      reset={reset}
    />
  );
}
