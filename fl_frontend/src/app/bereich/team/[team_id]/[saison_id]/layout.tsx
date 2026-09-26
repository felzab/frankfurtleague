import { Suspense } from "react";

import { funktionenOf } from "@/core/funktionen";
import { getSubjectSession } from "@/core/subject";
import { FunktionenGuard } from "@/features/funktionen/components/providers/FunktionenGuard";
import { TeamForbiddenPanel } from "@/features/funktionen/components/ui/TeamForbiddenPanel";
import { TeamShell } from "@/features/funktionen/components/ui/TeamShell";
import { teamStructureFor } from "@/features/funktionen/constants";
import { seatsAt } from "@/features/funktionen/teamSeats";
import { PageLoader } from "@/shared/components/ui/PageLoader";

type TeamParams = Promise<{ team_id: string; saison_id: string }>;

/**
 * Not async, for the reason `fl_frontend/src/app/bereich/admin/layout.tsx` states. Like the person
 * shell this one waits on the session: which entries it lists, and whether it lists any, is the
 * seats the person holds at this address.
 */
export default function TeamLayout({ children, params }: { children: React.ReactNode; params: TeamParams }) {
  return (
    <Suspense fallback={<PageLoader />}>
      <FunktionenGuard>
        <TeamChrome params={params}>{children}</TeamChrome>
      </FunktionenGuard>
    </Suspense>
  );
}

async function TeamChrome({ params, children }: { params: TeamParams; children: React.ReactNode }) {
  const { team_id, saison_id } = await params;
  // The guard's own read, memoised per render (`fl_frontend/src/core/subject.ts :: getSubjectSession`).
  const subject = await getSubjectSession();
  // Nothing rather than a second redirect, for the reason
  // `fl_frontend/src/app/bereich/(persoenlich)/layout.tsx :: PersonChrome` gives.
  if (subject === null) return null;

  const { funktionen } = funktionenOf(subject);
  // A seat on a `past` season is no Funktion, so its address lands here as held by nobody.
  const seats = seatsAt(funktionen, team_id, saison_id);

  return (
    <TeamShell
      teamId={team_id}
      saisonId={saison_id}
      structure={teamStructureFor(seats)}
      saison={seats.length === 0 ? null : { isLaufend: seats.some((seat) => seat.saison_status === "active") }}>
      {/* In the page's stead rather than beside it: the page never renders for an address the person holds no seat on. */}
      {seats.length === 0 ? <TeamForbiddenPanel funktionen={funktionen} /> : children}
    </TeamShell>
  );
}
