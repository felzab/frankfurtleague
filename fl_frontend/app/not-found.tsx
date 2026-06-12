import NotFound from "@/shared/components/ui/NotFound";
import { Suspense } from "react";

export default async function NotfoundPage() {
  return (
    <Suspense>
      <NotFound />
    </Suspense>
  );
}
