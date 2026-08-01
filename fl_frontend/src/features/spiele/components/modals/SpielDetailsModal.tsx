"use client";

import Link from "next/link";

import { CircleInfo } from "@gravity-ui/icons";

import { Modal, Separator } from "@heroui/react";

import { buildMapsSearchUrl, PLACEHOLDER } from "@/shared/utils/format";

import { computeSpielStatus, formatSpielDisplay } from "../../utils";
import SaisonPhaseChip from "../ui/SaisonPhaseChip";
import SpielStatusChip from "../ui/SpielStatusChip";

import type { FLSpiel } from "../../schemas";

/**
 * Deliberately NOT on `ModalShell` (owner decision, 2026-07-31): this is the one modal public users
 * see, and its lighter `bg-surface p-6 shadow-sm` appearance is the wanted look.
 *
 * **The stay-mounted arrangement this used to describe is gone (R4 §16.4, owner decision
 * 2026-07-31).** Keeping the Backdrop mounted preserved HeroUI's exit transition, but `SpielCardsList`
 * is instantiated once per collection, so it also mounted ~11 idle overlay trees across the app on
 * first paint. The caller now guards the mount and the exit transition is the accepted cost.
 *
 * `spielData` stays nullable and the inner guard stays. All four call sites now guard the mount, so
 * null should not arrive — but the prop is typed for a caller holding a null selection, and the guard
 * is what keeps the header and body off it. Cheap, and it is the reason a missed call site degrades
 * to an empty dialog rather than a crash: two of the four were missed when the guard first landed.
 */
export default function SpielDetailsModal({
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
  const { datum: spielDatum, uhrzeit: spielUhrzeit } = formatSpielDisplay(spielData ?? { datum: null, uhrzeit: null, ergebnis: null });
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
      variant="blur">
      <Modal.Container placement="top">
        {/* No `aria-label`: it outranked the heading, so opening a match announced
            "Spieldetails-Dialog" and never said which match (R4 §1.1). `Modal.Heading` below names
            the dialog "Spiel Nr. 42", which is the one thing it exists to convey. */}
        <Modal.Dialog className="border-border bg-surface rounded-2xl border p-6 shadow-sm">
          {spielData && (
            <>
              {/* The only modal a non-admin ever sees, and it had no close affordance at all —
                  dismissable only by Escape or an outside press, which leaves a touch user with
                  motor difficulty nothing to aim at (R4 §1.4). Same trigger the admin shell uses. */}
              <Modal.CloseTrigger className="text-foreground-muted hover:text-foreground transition-colors" />

              <Modal.Header className="gap-y-2 pb-4">
                <div className="flex w-full flex-row items-center justify-start gap-x-2">
                  <Modal.Heading className="text-fluid-lg! text-foreground font-extrabold">{`Spiel Nr. ${spielData.spiel_nr}`}</Modal.Heading>
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
                {/* Teams area  */}
                <div className="bg-background border-border flex h-fit flex-col items-center justify-center rounded-xl border py-4 shadow-inner">
                  {/** I just pass teamIsDisqualified=false because it's not included in the game data */}
                  {/* Plain links, not a team popover (owner decision, 2026-07-31). A popover
                      anchored inside a `position: fixed` overlay is mispositioned by react-aria,
                      which adds `document.scrollTop` to the trigger's viewport rect — on the landing
                      page, the one route where you must scroll to reach a match, it opened that far
                      below the name. Every fix for that is a workaround around a nested overlay
                      nobody needs: this modal is already a focused view of one match, so the name
                      goes straight to the team. The Kader shortcut stays on the cards. */}
                  <Link
                    prefetch={false}
                    href={`/dashboard/teams/${spielData.team1.team_id}`}
                    onClick={onClose}
                    className="text-fluid-xl hover:text-brand max-w-full truncate rounded font-bold transition-colors duration-200">
                    {spielData.team1.name}
                  </Link>

                  <span className="text-fluid-sm text-foreground-muted my-1 font-bold tracking-widest uppercase">vs</span>

                  <Link
                    prefetch={false}
                    href={`/dashboard/teams/${spielData.team2.team_id}`}
                    onClick={onClose}
                    className="text-fluid-xl hover:text-brand max-w-full truncate rounded font-bold transition-colors duration-200">
                    {spielData.team2.name}
                  </Link>
                </div>

                <Separator className="bg-border my-4 h-[2px]" />

                {/* Details Grid */}
                <div className="text-fluid-sm grid grid-cols-2 gap-4 whitespace-normal">
                  {/** Datum */}
                  <div>
                    <h4 className="text-foreground-muted font-semibold">Datum</h4>
                    <p className="text-foreground font-bold">{spielDatum}</p>
                  </div>
                  {/** Uhrzeit */}
                  <div>
                    <h4 className="text-foreground-muted font-semibold">Uhrzeit</h4>
                    <p className="text-foreground font-bold">{spielUhrzeit}</p>
                  </div>
                  {/** Ort */}
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
                  {/** Schiedsrichter */}
                  <div>
                    <h4 className="text-foreground-muted font-semibold">Schiedsrichter</h4>
                    <p className="text-foreground font-bold">{spielData.schiedsrichter?.name ?? PLACEHOLDER.entity}</p>
                  </div>
                </div>
              </Modal.Body>
            </>
          )}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
