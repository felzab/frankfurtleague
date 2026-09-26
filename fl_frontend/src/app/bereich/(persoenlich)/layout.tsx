import { Suspense } from "react";

import { funktionenOf } from "@/core/funktionen";
import { getSubjectSession } from "@/core/subject";
import { FunktionenGuard } from "@/features/funktionen/components/providers/FunktionenGuard";
import { PersonShell } from "@/features/funktionen/components/ui/PersonShell";
import { personStructureFor } from "@/features/funktionen/constants";
import { personEintraegeOf } from "@/features/funktionen/utils";
import { PageLoader } from "@/shared/components/ui/PageLoader";

/**
 * Not async, for the reason `fl_frontend/src/app/bereich/admin/layout.tsx` states. Unlike that shell
 * this one waits on the session too: which entries it lists is the person's Funktionen, derived per
 * request, so the chrome cannot be painted before the read.
 */
export default function PersoenlichLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<PageLoader />}>
      <FunktionenGuard>
        <PersonChrome>{children}</PersonChrome>
      </FunktionenGuard>
    </Suspense>
  );
}

async function PersonChrome({ children }: { children: React.ReactNode }) {
  // The guard's own read, memoised per render (`fl_frontend/src/core/subject.ts :: getSubjectSession`).
  const subject = await getSubjectSession();
  // Nothing rather than a second redirect: the guard above is the one place a missing session is
  // turned away, and nothing of the person's is drawn without one.
  if (subject === null) return null;

  return <PersonShell structure={personStructureFor(personEintraegeOf(funktionenOf(subject).funktionen))}>{children}</PersonShell>;
}
