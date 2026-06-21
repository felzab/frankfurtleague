import { Suspense } from "react";

import NotFound from "@/shared/components/ui/NotFound";

export default async function NotfoundPage() {
  return (
    <Suspense>
      <NotFound />
    </Suspense>
  );
}
