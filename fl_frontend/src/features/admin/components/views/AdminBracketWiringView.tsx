import Link from "next/link";

import { PencilToSquare } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { PHASE_TINTS } from "@/features/saisons/constants";
import { adminSpielEditHref, deriveSlotHerkunft, formatQuelle, sideLabel } from "@/features/spiele/utils";
import { spieltagLabels } from "@/features/spieltage/utils";
import { card } from "@/shared/components/ui/card";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { IconTooltip } from "@/shared/components/ui/IconTooltip";
import { CARDS_CASCADE } from "@/shared/components/ui/motion";
import { PLACEHOLDER } from "@/shared/utils/format";

import type { FLSpielQuelle, FLSpielTeamField } from "@/features/spiele/schemas";
import type { FLSlotHerkunft } from "@/features/spiele/utils";
import type { FLSpieltagWithSpiele } from "@/features/spieltage/schemas";

/** The wiring review colours a group-fed slot apart from a match-fed one, so `quelle` splits here and stays whole in `FLSlotHerkunft`. */
type FLSlotInkKey = Exclude<FLSlotHerkunft, "quelle"> | FLSpielQuelle["type"];

/** Reads the tint's ink off it rather than a fixed position, so a token added ahead of the foreground still resolves. */
const inkOf = (tint: string): string =>
  tint
    .split(" ")
    .filter((token) => token.startsWith("text-"))
    .join(" ");

/**
 * `gruppe` reads `PHASE_TINTS` rather than spelling the token, so the caption tracks the phase it
 * names everywhere else. Warm means the slot needs an admin; `brand` is excluded as a second deep red
 * beside `danger`.
 */
const HERKUNFT_INK: Record<FLSlotInkKey, string> = {
  gruppe: inkOf(PHASE_TINTS.gruppenphase),
  spiel: "text-info-strong",
  manuell: "text-warning-strong",
  offen: "text-danger-strong",
};

/** Source and occupant both, always — unlike a card, which drops the provenance once a winner arrives. */
function SlotWiring({ side, team, quelle }: { side: "team1" | "team2"; team: FLSpielTeamField | null; quelle: FLSpielQuelle | null }) {
  const herkunft = deriveSlotHerkunft({ team, quelle });

  let label: string;
  let ink: string;

  // Branching on `quelle` rather than on `herkunft`, which TypeScript cannot narrow to read `.type`.
  if (quelle !== null) {
    // Unreachable for a stored fixture: `formatQuelle` answers `null` only for the `NaN` a form holds
    // mid-edit. The fallback keeps the caption total if one ever arrived.
    label = formatQuelle(quelle) ?? "Herkunft unlesbar";
    ink = HERKUNFT_INK[quelle.type];
  } else if (herkunft === "offen") {
    label = "Ohne Herkunft";
    ink = HERKUNFT_INK.offen;
  } else {
    label = "Manuell gesetzt";
    ink = HERKUNFT_INK.manuell;
  }

  // Colour at caption size is a thin alarm on its own, so the one state waiting on somebody carries
  // weight as well.
  const weight = herkunft === "offen" ? "font-bold" : "font-semibold";

  return (
    // The seat marker sits in a side track rather than on a line of its own: it spends 13 px of measure
    // once instead of a text line per seat, and only a seat's first line has a digit beside it.
    <div className="grid grid-cols-[13px_minmax(0,1fr)] items-baseline gap-x-[9px]">
      <span className="fluid-xxs text-foreground-muted text-right font-semibold">
        <span aria-hidden="true">{side === "team1" ? "1" : "2"}</span>
        {/* Nothing else names the seats now that the pair is one column, and the digit on its own
            would be announced as a bare number. */}
        <span className="sr-only">{sideLabel(side)}</span>
      </span>

      {/* One inline flow and not two flex items: flex moves a whole club name down the moment it will
          not fit beside the origin and abandons the rest of that line, where a flow breaks between
          words and fills it. */}
      <div className="fluid-sm text-pretty">
        {/* `fluid-sm` sits on the flow and not on the name because the space between the two is the
            block's, so its size is what decides where the line breaks. */}
        <span className={`fluid-xxs whitespace-nowrap ${weight} ${ink}`}>{label}</span>{" "}
        {/* `break-words` and not `truncate`: a review surface that hides half a club's name cannot be
            finished, and the row is free to grow. */}
        {team === null ? (
          <span className="muted-meta italic">{PLACEHOLDER.slot}</span>
        ) : (
          <strong className="text-foreground font-bold break-words">{team.name}</strong>
        )}
      </div>
    </div>
  );
}

/**
 * Read-only: rows link into the fixture's own editor, so there is no second write surface to keep in
 * step with the endpoint's refusals. The Gruppenphase is absent by construction — the write path
 * refuses a `quelle` there.
 */
export function AdminBracketWiringView({ rounds }: { rounds: FLSpieltagWithSpiele[] }) {
  // The number an admin checks against is the matchday's own `position`, which the label reads
  // straight off each row rather than counting over this list.
  const labels = spieltagLabels(rounds);

  if (rounds.length === 0) {
    return (
      <div className="w-full px-3 py-4 sm:p-8">
        <div className="max-w-page mx-auto flex w-full flex-col gap-6">
          <EmptyState
            title="Noch keine Finalrunden"
            hint="Sobald die Spieltage der KO-Runde angelegt sind, steht hier, woher jede Seite kommt."
          />
        </div>
      </div>
    );
  }

  return (
    /* `AdminCrudShell`'s frame rather than the component, which would owe this page a create trigger.
       No page rise beside `CARDS_CASCADE`: the leading panel's own step is identical, so it would
       travel the distance twice. */
    <div className="w-full px-3 py-4 sm:p-8">
      <div
        role="list"
        className={`${CARDS_CASCADE} max-w-page mx-auto flex w-full flex-col gap-6`}>
        {rounds.map((round) => (
          <div
            role="listitem"
            key={round.id}
            className={`${card()} flex w-full flex-col items-start gap-4 p-3 sm:p-6`}>
            <h2 className="fluid-lg text-foreground w-full font-black tracking-tight">{labels.get(round.id)?.label}</h2>

            {round.spiele.length === 0 ? (
              <EmptyState title="Noch keine Spiele in dieser Runde" />
            ) : (
              <Table
                variant="secondary"
                className="h-fit w-full text-left">
                {/* `table-fixed` is what holds the two narrow columns at the widths they declare. Auto
                    layout reads a declared width as a preference and lets the longest club name in the
                    pair column push them around. */}
                <Table.Content
                  aria-label={`Herkunft der Paarungen: ${labels.get(round.id)?.label ?? ""}`}
                  className="table-fixed">
                  <Table.Header className="fluid-xxs text-foreground-muted font-semibold uppercase">
                    <Table.Column
                      isRowHeader
                      className="w-11 pt-1.5 pb-2 pl-3 whitespace-nowrap lg:w-16 lg:pl-4">
                      {/* The full word costs column width the two captions below need on a phone. */}
                      <span className="hidden sm:inline">Spiel</span>
                      <span className="sm:hidden">#</span>
                    </Table.Column>
                    {/* No width: this is the column fixed layout gives the remainder to. Both seats sit
                        in it, one under the other at every width, so it carries a single heading. */}
                    <Table.Column className="px-2 lg:px-4">Paarung</Table.Column>
                    {/* The width has to clear the button at its `md` size, not the size it starts at:
                        sized to the smaller one, the control was pressed against both cell edges. */}
                    <Table.Column className="w-14 pr-3 lg:w-16 lg:pr-4">
                      <span className="sr-only">Aktionen</span>
                    </Table.Column>
                  </Table.Header>

                  {/* No `renderEmptyState`: a Server Component may not pass a render prop to a Client
                      Component (frontend spec I13), and the branch above covers the case. */}
                  <Table.Body>
                    {[...round.spiele]
                      .sort((spiel1, spiel2) => spiel1.spiel_nr - spiel2.spiel_nr)
                      .map((spiel) => (
                        <Table.Row key={spiel.id}>
                          {/* `spiel_nr`, because that is the number a `spiel` source cites. */}
                          <Table.Cell className="fluid-sm py-4 pl-3 font-bold whitespace-nowrap lg:pl-4">{spiel.spiel_nr}</Table.Cell>

                          <Table.Cell className="px-2 py-4 align-top lg:px-4">
                            {/* No rule between the seats: the gap here is more than twice the space
                                between two lines inside one seat, which is what tells them apart where
                                both run long. */}
                            <div className="flex flex-col gap-4">
                              <SlotWiring
                                side="team1"
                                team={spiel.team1}
                                quelle={spiel.team1_quelle}
                              />
                              <SlotWiring
                                side="team2"
                                team={spiel.team2}
                                quelle={spiel.team2_quelle}
                              />
                            </div>
                          </Table.Cell>

                          {/* No `align-*` here or on the number cell, so both take HeroUI's vendored
                              `align-middle` and the control stays level with the number a reader is
                              checking it against. */}
                          <Table.Cell className="py-4 pr-3 lg:pr-4">
                            {/* Ended right so the column's surplus falls inside the row: left-aligned it
                                sat outside the control and the right gutter read as the bigger one. */}
                            <div className="flex justify-end">
                              {/* A `<Link>` and not a button, so Next prefetches on approach and
                                  middle-click opens the fixture in its own tab. */}
                              <IconTooltip label="Spiel bearbeiten">
                                <Link
                                  href={adminSpielEditHref(spiel.id)}
                                  aria-label={`Spiel Nr. ${spiel.spiel_nr} bearbeiten`}
                                  className="bg-brand-solid text-brand-solid-foreground hover:bg-brand-solid-hover flex h-[35px] w-[35px] shrink-0 items-center justify-center rounded-xl shadow-sm transition-colors duration-200 md:h-[38px] md:w-[38px]">
                                  <PencilToSquare className="m-0 size-5" />
                                </Link>
                              </IconTooltip>
                            </div>
                          </Table.Cell>
                        </Table.Row>
                      ))}
                  </Table.Body>
                </Table.Content>
              </Table>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
