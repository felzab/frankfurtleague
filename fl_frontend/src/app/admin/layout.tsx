import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getAdminSession } from "@/core/auth";
import AdminSidemenu from "@/features/admin/components/AdminSidemenu";
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
        {/* AdminContextWrapper moved out to the two routes that consume it (R4 §16.2), so this no
            longer covers its three round-trips — but it stays, because each page's own awaits still
            need a boundary between them and the shell above. */}
        <Suspense fallback={<ContentLoader />}>{children}</Suspense>
      </main>
    </div>
  );
}
