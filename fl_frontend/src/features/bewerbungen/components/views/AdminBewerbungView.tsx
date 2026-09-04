"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { BEWERBUNG_STATUS_TINT, bewerbungStatusLabel } from "@/features/bewerbungen/constants";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { Callout } from "@/shared/components/ui/Callout";
import { formButton } from "@/shared/components/ui/formButtons";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";

import { AdminBewerbungAblehnenSection } from "../forms/AdminBewerbungAblehnenSection";
import { AdminBewerbungAnnehmenSection } from "../forms/AdminBewerbungAnnehmenSection";
import { BewerbungAngabenPanel } from "./BewerbungAngabenPanel";
import { bestaetigungsStand, BewerbungBestaetigungStrip, istOffen, nenneUnd } from "./BewerbungBestaetigungStrip";

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
  const router = useRouter();
  const saisonHref = useSaisonHref();
  const [isLeaving, startLeaving] = useTransition();

  const isOpen = bewerbung.status === "eingereicht";

  // `null` for an application submitted before the workflow: it carries no per-seat state, and the
  // acceptance is not closed against one.
  const staende = bestaetigungsStand(bewerbung);
  const offen = staende === null ? [] : staende.filter(istOffen);
  const wartetAuf = nenneUnd(offen.filter((sitz) => sitz.stand.art === "ausstehend").map((sitz) => sitz.name ?? sitz.label));

  const schliessung = [
    wartetAuf === "" ? null : `Die Zusage wartet auf die Bestätigung von ${wartetAuf}.`,
    offen.some((sitz) => sitz.stand.art === "abgelehnt")
      ? "Wo jemand abgelehnt hat, steht für diese Rolle niemand mehr in der Bewerbung, und dann bleibt nur die Absage."
      : null,
  ]
    .filter((satz) => satz !== null)
    .join(" ");

  const leavePage = () => {
    // Blur first: react-aria's focus attribute survives a kept-alive tree.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    // Hover next: the disabled flag is what ends it (`docs/frontend/spec.md :: I68`).
    startLeaving(() => {
      if (window.history.length > 1) router.back();
      else router.push(saisonHref("/admin/bewerbungen"));
    });
  };

  return (
    <div className={`${PAGE_RISE} w-full p-6 sm:p-8`}>
      <div className="max-w-page mx-auto flex w-full flex-col">
        <Button
          onPress={leavePage}
          isDisabled={isLeaving}
          className={`${formButton({ intent: "nav", size: "sm" })} mb-6 w-fit gap-x-2`}>
          <ArrowUturnCwLeft className="h-4 w-4 shrink-0" />
          <span>Zurück</span>
        </Button>

        <header className="mb-6 flex w-full flex-row items-center gap-x-3">
          {/* `h2`, never `h1`: the shell's top bar owns the page's one heading. */}
          <h2 className="fluid-2xl text-foreground min-w-0 truncate font-extrabold tracking-tight">
            {teamName ?? `Bewerbung für die Saison ${bewerbung.saison_id}`}
          </h2>
          <span className="shrink-0">
            <span className={`${LABEL_BADGE} ${BEWERBUNG_STATUS_TINT[bewerbung.status]}`}>{bewerbungStatusLabel(bewerbung.status)}</span>
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

          {isOpen &&
            (teamName === null ? (
              // `REQ-BEWERBUNG-002` refuses exactly this row, so the panel that would offer the
              // acceptance is absent rather than shown and then refused.
              <Callout
                severity="warning"
                title="Diese Bewerbung nennt kein Team">
                Ohne eine neue Schule und ohne ein bestehendes Team steht nicht fest, wer aufgenommen würde. Bleibt nur die Absage.
              </Callout>
            ) : offen.length > 0 ? (
              // In the endpoint's own order, after the row it cannot enter: a seat that has not
              // confirmed refuses the acceptance whatever the season's state, so the panel that
              // would offer it is absent rather than shown and then refused.
              <Callout
                severity="warning"
                title="Noch nicht alle Kontaktpersonen haben bestätigt">
                {schliessung}
              </Callout>
            ) : (
              <AdminBewerbungAnnehmenSection
                bewerbungId={bewerbung.id}
                teamName={teamName}
                createsTeam={bewerbung.schule !== null}
                saisonId={bewerbung.saison_id}
                saisonStatus={saisonStatus}
                gruppeOffer={gruppeOffer}
              />
            ))}

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
