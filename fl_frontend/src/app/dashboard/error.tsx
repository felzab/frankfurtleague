"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";

import DashboardError from "@/features/dashboard/components/DashboardError";

// No console.error here -- see the note in src/app/error.tsx.
export default function DashboardErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();

  const handleRetry = () => {
    startTransition(() => {
      // 1. Force Next.js to clear the router cache and re-fetch the server data
      router.refresh();
      // 2. Clear the error boundary UI so the fresh data can render
      reset();
    });
  };

  return (
    <DashboardError
      error={error}
      retry={handleRetry}
    />
  );
}
