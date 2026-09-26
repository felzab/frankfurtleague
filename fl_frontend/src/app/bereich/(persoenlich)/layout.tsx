import { Suspense } from "react";

import { funktionenOf } from "@/core/funktionen";
import { FunktionenGuard } from "@/features/funktionen/components/providers/FunktionenGuard";
import { PersonAreaBoundary } from "@/features/funktionen/components/providers/PersonAreaBoundary";
import { PersonShell } from "@/features/funktionen/components/ui/PersonShell";
import { personStructureFor } from "@/features/funktionen/constants";
import { requireSubjectSession } from "@/features/funktionen/resolvers";
import { funktionOrteOf, personEintraegeOf } from "@/features/funktionen/utils";
import { PageLoader } from "@/shared/components/ui/PageLoader";

/**
 * Not async, for the reason `fl_frontend/src/app/bereich/admin/layout.tsx` states. Unlike that shell
 * this one waits on the session too: which entries it lists is the person's Funktionen, derived per
 * request, so the chrome cannot be painted before the read.
 */
export default function PersoenlichLayout({ children }: { children: React.ReactNode }) {
  return (
    // Around the whole of it: the area's `error.tsx` sits inside this layout and catches none of it.
    <PersonAreaBoundary>
      <Suspense fallback={<PageLoader />}>
        <FunktionenGuard>
          <PersonChrome>{children}</PersonChrome>
        </FunktionenGuard>
      </Suspense>
    </PersonAreaBoundary>
  );
}

async function PersonChrome({ children }: { children: React.ReactNode }) {
  // The guard's own read, memoised per render (`fl_frontend/src/core/subject.ts :: getSubjectSession`).
  const subject = await requireSubjectSession();

  const { funktionen } = funktionenOf(subject);

  return (
    <PersonShell
      structure={personStructureFor(personEintraegeOf(funktionen))}
      orte={funktionOrteOf(funktionen)}>
      {children}
    </PersonShell>
  );
}
