"use client";

import { bestaetigungsStand, zusageHindernis } from "@/features/bewerbungen/bestaetigungStand";
import { BEWERBUNG_STATUS_TINT, bewerbungStatusLabel } from "@/features/bewerbungen/constants";
import { BackButton } from "@/shared/components/ui/BackButton";
import { labelBadge } from "@/shared/components/ui/badges";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";

import { AdminBewerbungAblehnenSection } from "../forms/AdminBewerbungAblehnenSection";
import { AdminBewerbungAnnehmenSection } from "../forms/AdminBewerbungAnnehmenSection";
import { BewerbungAngabenPanel } from "./BewerbungAngabenPanel";
import { BewerbungBestaetigungStrip } from "./BewerbungBestaetigungStrip";

import type { FLBewerbung } from "@/features/bewerbungen/schemas";
import type { GruppeOffer } from "@/features/teams/types";

/**
 * One application, with the two decisions it is still open to. **Nothing on this page is a draft
 * that a save bar commits**: each decision writes on its own press, through its own endpoint, and
 * both are final.
 */
export function AdminBewerbungView({
  bewerbung,
  teamName,
  saisonStatus,
  gruppeOffer,
}: {
  bewerbung: FLBewerbung;
  /** The club the application names, resolved by the page — `null` where it names none. */
  teamName: string | null;
  /** The state of the season this application is for, or `null` where no season carries its id. */
  saisonStatus: "past" | "active" | "future" | null;
  gruppeOffer: readonly GruppeOffer[];
}) {
  const saisonHref = useSaisonHref();

  const isOpen = bewerbung.status === "eingereicht";

  // `null` for an application submitted before the workflow: it carries no per-seat state, and the
  // acceptance is not closed against one.
  const staende = bestaetigungsStand(bewerbung);
  const hindernis = zusageHindernis(staende, teamName);

  return (
    <div className={`${PAGE_RISE} w-full p-6 sm:p-8`}>
      <div className="max-w-page mx-auto flex w-full flex-col">
        <BackButton fallbackHref={saisonHref("/admin/bewerbungen")} />

        <header className="mb-6 flex w-full flex-row items-center gap-x-3">
          {/* `h2`, never `h1`: the shell's top bar owns the page's one heading. */}
          <h2 className="fluid-2xl text-foreground min-w-0 truncate font-extrabold tracking-tight">
            {teamName ?? `Bewerbung für die Saison ${bewerbung.saison_id}`}
          </h2>
          <span className="shrink-0">
            <span className={labelBadge(BEWERBUNG_STATUS_TINT[bewerbung.status])}>{bewerbungStatusLabel(bewerbung.status)}</span>
          </span>
        </header>

        <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 xl:mx-0 xl:max-w-none">
          {staende !== null && (
            <BewerbungBestaetigungStrip
              bewerbungId={bewerbung.id}
              staende={staende}
              frist={bewerbung.bestaetigungsfrist}
              isOpen={isOpen}
            />
          )}

          <BewerbungAngabenPanel
            bewerbung={bewerbung}
            teamName={teamName}
            staende={staende}
          />

          {/* Standing whatever the endpoint would refuse, its own control closed with the reason
              instead: a section that comes and goes hides the decision the page is for. */}
          {isOpen && (
            <AdminBewerbungAnnehmenSection
              bewerbungId={bewerbung.id}
              teamName={teamName}
              createsTeam={bewerbung.schule !== null}
              saisonId={bewerbung.saison_id}
              saisonStatus={saisonStatus}
              gruppeOffer={gruppeOffer}
              hindernis={hindernis}
            />
          )}

          {isOpen && (
            <AdminBewerbungAblehnenSection
              bewerbungId={bewerbung.id}
              teamName={teamName}
              saisonId={bewerbung.saison_id}
            />
          )}
        </div>
      </div>
    </div>
  );
}
