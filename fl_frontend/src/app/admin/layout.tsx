// The component styles only /admin renders. Imported here rather than in `globals.css` so the public
// routes never download or parse them — see the header of that file.
import "./admin.css";

import { Suspense } from "react";

import { AdminAuthGuard } from "@/features/admin/components/providers/AdminAuthGuard";
import { AdminLocaleProvider } from "@/features/admin/components/providers/AdminLocaleProvider";
import { AdminShell } from "@/features/admin/components/ui/AdminShell";
import { SaisonMetadataDisplay } from "@/features/saisons/components/ui/SaisonMetadataDisplay";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";

// Not async, and that is the point: awaiting the auth guard before any JSX would make the whole
// admin shell a dynamic hole. It lives in AdminAuthGuard below the Suspense boundary, so only the
// session check and the page's own data resolve per request.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminShell saisonMetadataDisplay={<SaisonMetadataDisplay />}>
      {/* NOT redundant with `loading.tsx`: Next nests that fallback around the page segment only,
          i.e. INSIDE this boundary. This one covers the guard's session round-trip, which sits above
          the page segment and would otherwise have nothing between it and the shell. */}
      <Suspense fallback={<ContentLoader />}>
        {/* Why the locale is pinned, and why through a client wrapper, is on the provider. */}
        <AdminLocaleProvider>
          <AdminAuthGuard>{children}</AdminAuthGuard>
        </AdminLocaleProvider>
      </Suspense>
    </AdminShell>
  );
}
