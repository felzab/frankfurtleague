import { Suspense } from "react";
import { connection } from "next/server";

import { funktionenOf } from "@/core/funktionen";
import { getSubjectSession } from "@/core/subject";
import { PersonSessionHold } from "@/features/funktionen/components/providers/PersonSessionHold";
import { TeamAreaBoundary } from "@/features/funktionen/components/providers/TeamAreaBoundary";
import { PersonLaneFunktionSwitcher } from "@/features/funktionen/components/ui/PersonLaneFunktionSwitcher";
import { SaisonChipSlot } from "@/features/funktionen/components/ui/SaisonChipSlot";
import { TeamForbiddenPanel } from "@/features/funktionen/components/ui/TeamForbiddenPanel";
import { TeamShell, TeamShellHeading, TeamSidemenuEntries } from "@/features/funktionen/components/ui/TeamShell";
import { TEAM_SHELL_FALLBACK, TEAM_SIDEMENU_ENTRIES, teamStructureFor } from "@/features/funktionen/constants";
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
            hold's session round-trip, which sits above the page segment. */}
        <Suspense fallback={<ContentLoader />}>
          <PersonSessionHold>
            <TeamContent params={params}>{children}</TeamContent>
          </PersonSessionHold>
        </Suspense>
      </TeamShell>
    </TeamAreaBoundary>
  );
}

/**
 * The seats the person holds at the address, which every part of this layout below reads first; `null` for a
 * refused session, which each part answers with its fallback, the page turning it away (`docs/frontend/spec.md :: I834`).
 */
async function seatsHere(params: TeamParams) {
  // Its own, whatever is mounted above: the builder stage reaches no sign-in store, so a session read
  // ahead of this runs at build time (`docs/frontend/spec.md :: I448`).
  await connection();
  const { team_id, saison_id } = await params;
  // The hold's own read, memoised per render (`fl_frontend/src/core/subject.ts :: getSubjectSession`).
  const subject = await getSubjectSession();
  if (subject === null) return null;
  const { funktionen } = funktionenOf(subject);

  // A seat on a `past` season is no Funktion, so its address lands here as held by nobody.
  return { funktionen: funktionen, saisonId: saison_id, seats: seatsAt(funktionen, team_id, saison_id) };
}

/** The bar heads a refused session's address as it does before the read: it holds no seat to be refused from. */
async function TeamHeading({ params }: { params: TeamParams }) {
  const here = await seatsHere(params);

  return <TeamShellHeading isRefused={here !== null && here.seats.length === 0} />;
}

async function TeamEntries({ params }: { params: TeamParams }) {
  const here = await seatsHere(params);

  return <TeamSidemenuEntries structure={teamStructureFor(here?.seats ?? [])} />;
}

/** No chip over an address the person holds nothing on: its segment is whatever was typed there. */
async function TeamSaisonChip({ params }: { params: TeamParams }) {
  const here = await seatsHere(params);
  if (here === null || here.seats.length === 0) return null;
  const { saisonId, seats } = here;

  return (
    <SaisonChipSlot
      saisonId={saisonId}
      isLaufend={seats.some((seat) => seat.saison_status === "active")}
    />
  );
}

async function TeamContent({ params, children }: { params: TeamParams; children: React.ReactNode }) {
  const here = await seatsHere(params);
  // A refused session reaches the page, whose own `requireTeamSeats` sends it to sign in: withheld, the
  // page's redirect would never reach the client.
  if (here === null || here.seats.length > 0) return <>{children}</>;
  const { funktionen } = here;

  // Here alone: each page under this checks the seat again and renders nothing, which would log it twice.
  logPageVerweigert("/bereich/team/[team_id]/[saison_id]", "kein_sitz");
  // In the page's stead: Next runs the page whatever this renders, so the page checks the seat itself
  // (`fl_frontend/src/features/funktionen/resolvers.ts :: requireTeamSeats`).
  return <TeamForbiddenPanel funktionen={funktionen} />;
}
