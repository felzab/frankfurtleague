"use client";

import DashboardError from "@/features/dashboard/components/DashboardError";
import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";

export default function AdminDashboardErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    console.error("Dashboard Error:", error);
  }, [error]);

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
