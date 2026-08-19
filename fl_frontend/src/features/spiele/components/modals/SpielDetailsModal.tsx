"use client";

import Link from "next/link";

import { CircleInfo } from "@gravity-ui/icons";

import { Modal, Separator } from "@heroui/react";

import { dismissControl } from "@/core/dismissControl";
import { TeamPopoverMenu } from "@/features/teams/components/ui/TeamPopoverMenu";
import { buildMapsSearchUrl, PLACEHOLDER } from "@/shared/utils/format";

import { computeSpielStatus, formatQuelle, formatSpielDisplay } from "../../utils";
import { SaisonPhaseChip } from "../ui/SaisonPhaseChip";
import { SpielStatusChip } from "../ui/SpielStatusChip";

import type { FLSpiel, FLSpielQuelle, FLSpielTeamFieldJoined } from "../../schemas";

/**
 * One side of the fixture, in this modal's own idiom.
 *
 * A resolved side is a `TeamPopoverMenu` placed `top`, not the cards' `right`: this trigger is a wide
 * centred line, and only a vertical placement puts that width on the axis react-aria clamps to the
 * viewport. A side whose occupant is not yet known shows its provenance label as text, because there
 * is no team page to send anyone to.
 */
function TeamNameLine({
  team,
  quelle,
  onNavigate,
}: {
  team: FLSpielTeamFieldJoined | null;
  quelle: FLSpielQuelle | null;
  onNavigate: () => void;
}) {
  if (team === null) {
    return (
      <span className="fluid-xl text-foreground-muted max-w-full truncate font-bold italic">{formatQuelle(quelle) ?? PLACEHOLDER.slot}</span>
    );
  }

  return (
    <TeamPopoverMenu
      teamName={team.name}
      teamId={team.team_id}
      teamIsDisqualified={team.disqualifikation !== null}
      placement="top"
      onNavigate={onNavigate}>
      <strong className="fluid-xl hover:text-brand max-w-full truncate font-bold transition-colors duration-200">{team.name}</strong>
    </TeamPopoverMenu>
  );
}

/**
 * Deliberately NOT on `ModalShell` (decided 2026-07-31): this is the one modal public users
 * see, and its lighter `bg-surface p-6 shadow-sm` appearance is the wanted look.
 *
 * **The caller guards the mount; this component does not stay mounted (decided 2026-07-31).**
 * Keeping the Backdrop mounted would preserve HeroUI's exit transition, but `SpielCardsList` is
 * instantiated once per collection, so it would also mount ~11 idle overlay trees across the app on
 * first paint. Losing the exit transition is the accepted cost.
 *
 * `spielData` is nullable and the inner guard is deliberate. Every call site guards the mount, so
 * null should not arrive — but the prop is typed for a caller holding a null selection, and the guard
 * is what keeps the header and body off it. It is cheap, and it is why a call site that forgets to
 * guard degrades to an empty dialog rather than a crash.
 */
export function SpielDetailsModal({
  spielData,
  isOpen,
  onClose,
  today,
}: {
  spielData: FLSpiel | null;
  isOpen: boolean;
  onClose: () => void;
  today: string;
}) {
  const { datum: spielDatum, uhrzeit: spielUhrzeit } = formatSpielDisplay(
    spielData ?? { datum: null, uhrzeit: null, ergebnis: null, elfmeterschiessen: null },
  );
  // Searches the Spielort's stored maps_link, not an address -- the embedded copy carries no
  // FLAddress, so this query is genuinely different from the other two call sites.
  const mapUrl = spielData?.ort ? buildMapsSearchUrl(spielData.ort.maps_link) : "";

  return (
    <Modal.Backdrop
      isOpen={isOpen}
      // HeroUI reports both directions; only the closing edge is ours to handle. Passing `onClose`
      // straight in would forward the boolean as its first argument.
      onOpenChange={(open: boolean) => {
        if (!open) onClose();
      }}
      variant="opaque">
      {/* The blur on an empty sibling rather than `variant="blur"`, for ModalShell's reason: a
          backdrop-filter on the ancestor of animated content is what Chromium drops for good. This
          modal is off the shell by decision (below), so it carries its own copy of the layer. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 backdrop-blur-md"
      />
      <Modal.Container placement="top">
        {/* No `aria-label`: it outranked the heading, so opening a match announced
            "Spieldetails-Dialog" and never said which match. `Modal.Heading` below names
            the dialog "Spiel Nr. 42", which is the one thing it exists to convey. */}
        <Modal.Dialog className="border-border bg-surface rounded-2xl border p-6 shadow-sm">
          {spielData && (
            <>
              {/* The one modal a non-admin sees, so it carries a visible dismissal: Escape and an
                  outside press leave a touch user with motor difficulty nothing to aim at. */}
              <Modal.CloseTrigger {...dismissControl({ label: "Dialog schließen" })} />

              <Modal.Header className="gap-y-2 pb-4">
                <div className="flex w-full flex-row items-center justify-start gap-x-2">
                  <Modal.Heading className="fluid-lg! text-foreground font-extrabold">{`Spiel Nr. ${spielData.spiel_nr}`}</Modal.Heading>
                  <Modal.Icon className="text-foreground-muted size-5 lg:size-6">
                    <CircleInfo className="size-full" />
                  </Modal.Icon>
                </div>
                <div className="flex h-fit w-full flex-row items-center justify-start gap-x-2">
                  {/* Computed inside the guard, so narrowing flows and no cast is needed. */}
                  <SpielStatusChip spielStatus={computeSpielStatus({ datum: spielData.datum, isCanceled: spielData.is_canceled, today })} />
                  <SaisonPhaseChip saisonPhase={spielData.saison_phase} />
                </div>
              </Modal.Header>
              <Modal.Body className="text-foreground">
                <div className="bg-background border-border flex h-fit flex-col items-center justify-center rounded-xl border py-4 shadow-inner">
                  {/* `onClose` on the way out: the App Router keeps this page in a hidden Activity
                      tree, so a dialog left open over a navigation is open again on the way back. */}
                  <TeamNameLine
                    team={spielData.team1}
                    quelle={spielData.team1_quelle}
                    onNavigate={onClose}
                  />

                  <span className="fluid-sm text-foreground-muted my-1 font-bold tracking-widest uppercase">vs</span>

                  <TeamNameLine
                    team={spielData.team2}
                    quelle={spielData.team2_quelle}
                    onNavigate={onClose}
                  />
                </div>

                <Separator className="bg-border my-4 h-[2px]" />

                <div className="fluid-sm grid grid-cols-2 gap-4 whitespace-normal">
                  <div>
                    <h4 className="text-foreground-muted font-semibold">Datum</h4>
                    <p className="text-foreground font-bold">{spielDatum}</p>
                  </div>
                  <div>
                    <h4 className="text-foreground-muted font-semibold">Uhrzeit</h4>
                    <p className="text-foreground font-bold">{spielUhrzeit}</p>
                  </div>
                  <div>
                    <h4 className="text-foreground-muted font-semibold">Ort</h4>
                    {spielData.ort ? (
                      <Link
                        href={mapUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand hover:text-brand/80 font-bold transition-colors hover:underline">
                        {spielData.ort.name}
                      </Link>
                    ) : (
                      <p className="text-foreground font-bold">{PLACEHOLDER.entity}</p>
                    )}
                  </div>
                  <div>
                    <h4 className="text-foreground-muted font-semibold">Schiedsrichter</h4>
                    <p className="text-foreground font-bold">{spielData.schiedsrichter?.name ?? PLACEHOLDER.entity}</p>
                  </div>
                </div>

                {/* Its own block below the grid, not a cell in it: a note is prose of any length.
                    `.trim()` is this field's emptiness rule (`draftStatus.ts :: notiz`); an empty
                    "Notiz" would advertise a field blank on almost every match. */}
                {spielData.notiz !== null && spielData.notiz.trim() !== "" && (
                  <>
                    <Separator className="bg-border my-4 h-[2px]" />
                    {/* The teams panel's treatment, which is this dialog's idiom for a block that
                        is not the metadata list. `pre-line`, not `pre-wrap`: it keeps the admin's
                        line breaks and collapses the indentation a pasted note carries. */}
                    <div className="bg-background border-border fluid-sm rounded-xl border p-4 shadow-inner">
                      <h4 className="text-foreground-muted font-semibold">Notiz</h4>
                      <p className="text-foreground mt-1 font-medium whitespace-pre-line">{spielData.notiz}</p>
                    </div>
                  </>
                )}
              </Modal.Body>
            </>
          )}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
