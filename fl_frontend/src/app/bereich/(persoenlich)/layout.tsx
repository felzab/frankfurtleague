import { Suspense } from "react";
import { connection } from "next/server";

import { funktionenOf } from "@/core/funktionen";
import { FunktionenGuard } from "@/features/funktionen/components/providers/FunktionenGuard";
import { PersonAreaBoundary } from "@/features/funktionen/components/providers/PersonAreaBoundary";
import { PersonLaneFunktionSwitcher } from "@/features/funktionen/components/ui/PersonLaneFunktionSwitcher";
import { PersonShell, PersonSidemenuEntries } from "@/features/funktionen/components/ui/PersonShell";
import { PERSON_SIDEMENU_ENTRIES, PERSON_SIDEMENU_STRUCTURE, personStructureFor } from "@/features/funktionen/constants";
import { requireSubjectSession } from "@/features/funktionen/resolvers";
import { personEintraegeOf } from "@/features/funktionen/utils";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";

/**
 * Not async, for the reason `fl_frontend/src/app/bereich/admin/layout.tsx` states. The frame paints before
 * the session read; only what the person's Funktionen decide waits on it (`docs/frontend/spec.md :: I735`).
 */
export default function PersoenlichLayout({ children }: { children: React.ReactNode }) {
  return (
    // Around the whole of it: the area's `error.tsx` sits inside this layout and catches none of it.
    <PersonAreaBoundary>
      <PersonShell
        structure={PERSON_SIDEMENU_STRUCTURE}
        entries={
          // The landing alone in its stead, which every person holds: a listed page the person may not open is
          // a link the page turns away.
          <Suspense fallback={<PersonSidemenuEntries structure={personStructureFor(new Set(["landing"]))} />}>
            <PersonEntries />
          </Suspense>
        }
        funktionSwitcher={
          // Nothing in its stead: most people hold one place, where the switcher draws nothing, so a placeholder
          // would move the rail for them. No way to `/bereich` beneath the places: this shell's own „Übersicht“
          // entry is that address.
          <Suspense fallback={null}>
            <PersonLaneFunktionSwitcher
              ohneOrt={PERSON_SIDEMENU_ENTRIES.landing.label}
              mitBereich={false}
            />
          </Suspense>
        }>
        {/* Not redundant with `loading.tsx`, which Next nests INSIDE this boundary: this one covers the
            guard's session round-trip, which sits above the page segment. */}
        <Suspense fallback={<ContentLoader />}>
          <FunktionenGuard>{children}</FunktionenGuard>
        </Suspense>
      </PersonShell>
    </PersonAreaBoundary>
  );
}

async function PersonEntries() {
  // Its own, whatever is mounted above: the builder stage reaches no sign-in store, so a session read
  // ahead of this runs at build time (`docs/frontend/spec.md :: I448`).
  await connection();
  // The guard's own read, memoised per render (`fl_frontend/src/core/subject.ts :: getSubjectSession`).
  const { funktionen } = funktionenOf(await requireSubjectSession());

  return <PersonSidemenuEntries structure={personStructureFor(personEintraegeOf(funktionen))} />;
}
