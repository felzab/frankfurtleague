"use server";

import NotFound from "@/shared/components/ui/NotFound";
import { Suspense } from "react";

export default async function HorizontalSoccer404() {
  return (
    <Suspense>
      <NotFound />
    </Suspense>
  );
}
