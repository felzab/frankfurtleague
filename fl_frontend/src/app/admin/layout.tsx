import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getAdminSession } from "@/core/auth";
import AdminSidemenu from "@/features/admin/components/AdminSidemenu";
import AdminContextWrapper from "@/features/admin/components/providers/AdminContextWrapper";
import SaisonMetadataDisplay from "@/features/saisons/components/ui/SaisonMetadataDisplay";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { SkipToContentLink } from "@/shared/components/ui/SkipToContentLink";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Second layer behind proxy.ts. Nothing else under /admin calls auth(), so before this the whole
  // admin area was public the moment the proxy matcher stopped covering a segment -- and
  // /admin/action_required fetches with the admin API key on exactly that assumption.
  // connection() first, per CLAUDE.md §9 A1: the guard must not be resolved at build time.
  await connection();
  if (!(await getAdminSession())) redirect("/signin");

  return (
    <div className="relative flex h-dvh w-full flex-col lg:flex-row">
      <SkipToContentLink />

      <AdminSidemenu saisonMetadataDisplay={<SaisonMetadataDisplay />} />

      <main
        id="main-content"
        className="bg-background relative flex flex-1 scrollbar-gutter-stable flex-col overflow-y-auto">
        {/* NOT redundant with `loading.tsx` (unlike the dashboard's): Next nests that fallback
            around the page segment only, i.e. INSIDE AdminContextWrapper. This boundary is what
            covers the wrapper's own three FastAPI round-trips. Do not remove it. */}
        <Suspense fallback={<ContentLoader />}>
          <AdminContextWrapper>{children}</AdminContextWrapper>
        </Suspense>
      </main>
    </div>
  );
}
