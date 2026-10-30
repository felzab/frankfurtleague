import { Suspense } from "react";

import { funktionenOf } from "@/core/funktionen";
import { getSubjectSession } from "@/core/subject";
import { PersonAreaBoundary } from "@/features/funktionen/components/providers/PersonAreaBoundary";
import { PersonSessionHold } from "@/features/funktionen/components/providers/PersonSessionHold";
import { PersonLaneFunktionSwitcher } from "@/features/funktionen/components/ui/PersonLaneFunktionSwitcher";
import { PersonShell, PersonSidemenuEntries } from "@/features/funktionen/components/ui/PersonShell";
import { PERSON_SIDEMENU_ENTRIES, PERSON_SIDEMENU_STRUCTURE, personStructureFor } from "@/features/funktionen/constants";
import { personEintraegeOf } from "@/features/funktionen/utils";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";

/**
 * Not async, for the reason `fl_frontend/src/app/bereich/admin/layout.tsx` states. The frame paints before
 * the session read; only what the person's Funktionen decide waits on it.
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
            hold's session round-trip, which sits above the page segment. */}
        <Suspense fallback={<ContentLoader />}>
          <PersonSessionHold>{children}</PersonSessionHold>
        </Suspense>
      </PersonShell>
    </PersonAreaBoundary>
  );
}

async function PersonEntries() {
  // The hold's own read, memoised per render; a refused session keeps the fallback, the page turning it away.
  const subject = await getSubjectSession();
  if (subject === null) return <PersonSidemenuEntries structure={personStructureFor(new Set(["landing"]))} />;
  const { funktionen } = funktionenOf(subject);

  return <PersonSidemenuEntries structure={personStructureFor(personEintraegeOf(funktionen))} />;
}
