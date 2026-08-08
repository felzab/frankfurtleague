"use client";

import Link from "next/link";

import { CircleInfo } from "@gravity-ui/icons";

import { Modal, Separator } from "@heroui/react";

import { buildMapsSearchUrl, PLACEHOLDER } from "@/shared/utils/format";

import { computeSpielStatus, formatQuelle, formatSpielDisplay } from "../../utils";
import { SaisonPhaseChip } from "../ui/SaisonPhaseChip";
import { SpielStatusChip } from "../ui/SpielStatusChip";

import type { FLSpiel, FLSpielQuelle, FLSpielTeamField } from "../../schemas";

/**
 * One side of the fixture, in this modal's own idiom.
 *
 * A resolved side is a plain link straight to the team — not a popover, for the reason recorded at the
 * call site. A side whose occupant is not yet known shows its provenance label as text, because there
 * is no team page to send anyone to (ADR-0041).
 */
function TeamNameLine({ team, quelle, onNavigate }: { team: FLSpielTeamField | null; quelle: FLSpielQuelle | null; onNavigate: () => void }) {
  if (team === null) {
    return (
      <span className="fluid-xl text-foreground-muted max-w-full truncate font-bold italic">{formatQuelle(quelle) ?? PLACEHOLDER.slot}</span>
    );
  }

  return (
    <Link
      prefetch={false}
      href={`/dashboard/teams/${team.team_id}`}
      onClick={onNavigate}
      className="fluid-xl hover:text-brand max-w-full truncate rounded font-bold transition-colors duration-200">
      {team.name}
    </Link>
  );
}

/**
 * Deliberately NOT on `ModalShell` (owner decision, 2026-07-31): this is the one modal public users
 * see, and its lighter `bg-surface p-6 shadow-sm` appearance is the wanted look.
 *
 * **The caller guards the mount; this component does not stay mounted (owner decision, 2026-07-31).**
 * Keeping the Backdrop mounted would preserve HeroUI's exit transition, but `SpielCardsList` is
 * instantiated once per collection, so it would also mount ~11 idle overlay trees across the app on
 * first paint. Losing the exit transition is the accepted cost.
 *
 * `spielData` is nullable and the inner guard is deliberate. All four call sites guard the mount, so
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
      variant="blur">
      <Modal.Container placement="top">
        {/* No `aria-label`: it outranked the heading, so opening a match announced
            "Spieldetails-Dialog" and never said which match. `Modal.Heading` below names
            the dialog "Spiel Nr. 42", which is the one thing it exists to convey. */}
        <Modal.Dialog className="border-border bg-surface rounded-2xl border p-6 shadow-sm">
          {spielData && (
            <>
              {/* The only modal a non-admin ever sees, and it had no close affordance at all —
                  dismissable only by Escape or an outside press, which leaves a touch user with
                  motor difficulty nothing to aim at. Same trigger the admin shell uses. */}
              <Modal.CloseTrigger className="text-foreground-muted hover:text-foreground transition-colors" />

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
                {/* Teams area  */}
                <div className="bg-background border-border flex h-fit flex-col items-center justify-center rounded-xl border py-4 shadow-inner">
                  {/* Plain links, not a team popover (owner decision, 2026-07-31). A popover
                      anchored inside a `position: fixed` overlay is mispositioned by react-aria,
                      which adds `document.scrollTop` to the trigger's viewport rect — on the landing
                      page, the one route where you must scroll to reach a match, it opened that far
                      below the name. Every fix for that is a workaround around a nested overlay
                      nobody needs: this modal is already a focused view of one match, so the name
                      goes straight to the team. The Kader shortcut stays on the cards. */}
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

                {/* Details Grid */}
                <div className="fluid-sm grid grid-cols-2 gap-4 whitespace-normal">
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

                  {/** Notiz — only when one exists: an empty "Notiz —" row would tell every visitor
                       about a field that is blank on almost every match. Spans both columns, because
                       prose does not belong in a half-width cell. `whitespace-pre-line` keeps the
                       admin's line breaks without honouring stray indentation. */}
                  {spielData.notiz !== null && spielData.notiz !== "" && (
                    <div className="col-span-2">
                      <h4 className="text-foreground-muted font-semibold">Notiz</h4>
                      <p className="text-foreground font-medium whitespace-pre-line">{spielData.notiz}</p>
                    </div>
                  )}
                </div>
              </Modal.Body>
            </>
          )}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
