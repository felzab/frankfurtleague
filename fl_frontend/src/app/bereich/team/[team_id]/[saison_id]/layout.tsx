import { Suspense } from "react";
import { connection } from "next/server";

import { funktionenOf } from "@/core/funktionen";
import { FunktionenGuard } from "@/features/funktionen/components/providers/FunktionenGuard";
import { TeamAreaBoundary } from "@/features/funktionen/components/providers/TeamAreaBoundary";
import { PersonLaneFunktionSwitcher } from "@/features/funktionen/components/ui/PersonLaneFunktionSwitcher";
import { SaisonChipSlot } from "@/features/funktionen/components/ui/SaisonChipSlot";
import { TeamForbiddenPanel } from "@/features/funktionen/components/ui/TeamForbiddenPanel";
import { TeamShell, TeamShellHeading, TeamSidemenuEntries } from "@/features/funktionen/components/ui/TeamShell";
import { TEAM_SHELL_FALLBACK, TEAM_SIDEMENU_ENTRIES, teamStructureFor } from "@/features/funktionen/constants";
import { requireSubjectSession } from "@/features/funktionen/resolvers";
import { seatsAt } from "@/features/funktionen/teamSeats";
import { logPageVerweigert } from "@/features/funktionen/verweigert";
import { SidemenuEntriesSkeleton } from "@/shared/components/layout/sidemenu/SidemenuNavLinks";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";

type TeamParams = Promise<{ team_id: string; saison_id: string }>;

/**
 * Not async, for the reason `fl_frontend/src/app/bereich/admin/layout.tsx` states, and `params` is never
 * awaited here: the address is unknown to the build, so each part reading it waits in its own boundary
 * beside the session's (`docs/frontend/spec.md :: I735`).
 */
export default function TeamLayout({ children, params }: { children: React.ReactNode; params: TeamParams }) {
  return (
    // Around the whole of it: the area's `error.tsx` sits inside this layout and catches none of it.
    <TeamAreaBoundary>
      <TeamShell
        heading={<TeamHeading params={params} />}
        entries={
          // Rows and no link in its stead: an address the person holds no seat on lists no entry.
          <Suspense fallback={<SidemenuEntriesSkeleton rows={TEAM_SIDEMENU_ENTRIES.length} />}>
            <TeamEntries params={params} />
          </Suspense>
        }
        saisonMetadataDisplay={<TeamSaisonChip params={params} />}
        funktionSwitcher={
          // Nothing in its stead, for the person layout's reason.
          <Suspense fallback={null}>
            <PersonLaneFunktionSwitcher
              ohneOrt={TEAM_SHELL_FALLBACK.label}
              mitBereich
            />
          </Suspense>
        }>
        {/* Not redundant with `loading.tsx`, which Next nests INSIDE this boundary: this one covers the
            guard's session round-trip, which sits above the page segment. */}
        <Suspense fallback={<ContentLoader />}>
          <FunktionenGuard>
            <TeamContent params={params}>{children}</TeamContent>
          </FunktionenGuard>
        </Suspense>
      </TeamShell>
    </TeamAreaBoundary>
  );
}

/** The seats the person holds at the address, which every part of this layout below reads first. */
async function seatsHere(params: TeamParams) {
  // Its own, whatever is mounted above: the builder stage reaches no sign-in store, so a session read
  // ahead of this runs at build time (`docs/frontend/spec.md :: I448`).
  await connection();
  const { team_id, saison_id } = await params;
  // The guard's own read, memoised per render (`fl_frontend/src/core/subject.ts :: getSubjectSession`).
  const { funktionen } = funktionenOf(await requireSubjectSession());

  // A seat on a `past` season is no Funktion, so its address lands here as held by nobody.
  return { funktionen: funktionen, saisonId: saison_id, seats: seatsAt(funktionen, team_id, saison_id) };
}

async function TeamHeading({ params }: { params: TeamParams }) {
  const { seats } = await seatsHere(params);

  return <TeamShellHeading isRefused={seats.length === 0} />;
}

async function TeamEntries({ params }: { params: TeamParams }) {
  const { seats } = await seatsHere(params);

  return <TeamSidemenuEntries structure={teamStructureFor(seats)} />;
}

/** No chip over an address the person holds nothing on: its segment is whatever was typed there. */
async function TeamSaisonChip({ params }: { params: TeamParams }) {
  const { saisonId, seats } = await seatsHere(params);
  if (seats.length === 0) return null;

  return (
    <SaisonChipSlot
      saisonId={saisonId}
      isLaufend={seats.some((seat) => seat.saison_status === "active")}
    />
  );
}

async function TeamContent({ params, children }: { params: TeamParams; children: React.ReactNode }) {
  const { funktionen, seats } = await seatsHere(params);
  if (seats.length > 0) return <>{children}</>;

  // Here alone: each page under this checks the seat again and renders nothing, which would log it twice.
  logPageVerweigert("/bereich/team/[team_id]/[saison_id]", "kein_sitz");
  // In the page's stead: Next runs the page whatever this renders, so the page checks the seat itself
  // (`fl_frontend/src/features/funktionen/resolvers.ts :: requireTeamSeats`).
  return <TeamForbiddenPanel funktionen={funktionen} />;
}
