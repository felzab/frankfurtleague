import Link from "next/link";

import { PencilToSquare } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { adminSpielEditHref, deriveSlotHerkunft, formatQuelle } from "@/features/spiele/utils";
import { spieltagLabels } from "@/features/spieltage/utils";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { IconTooltip } from "@/shared/components/ui/IconTooltip";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { PLACEHOLDER } from "@/shared/utils/format";

import type { FLSpielQuelle, FLSpielTeamField } from "@/features/spiele/schemas";
import type { FLSpieltagWithSpiele } from "@/features/spieltage/schemas";

/**
 * The four answers to "what fills this side", each in its own colour.
 *
 * **Four rather than three, because the two kinds of source are the distinction worth seeing.** A
 * bracket is seeded from the standings in its first knockout round and fed by earlier matches in
 * every round after it (ADR-0034), so a group chip standing in a semi-final is visible as wrong from
 * across the room — which is exactly the review this page exists for, and exactly what a single
 * "has a source" colour would hide.
 *
 * **The four read as one scale, cool to warm, and that is what keeps them from being confetti.** The
 * two cool chips are the two ways a slot fills itself and are meant to read as a family; the two warm
 * ones are the two ways it does not, in the app's established grades — amber for something waiting on
 * a person, red for something no later result can fix. So the colour answers "does this need me?"
 * first and "which kind of source?" second, which is the order an admin actually asks.
 *
 * - `gruppe` — seeded from the standings; the first knockout round's normal answer. It takes
 *   `SaisonPhaseChip`'s Gruppenphase token at the `/10` that component measured, because the slot
 *   comes from exactly the phase that colour already names everywhere else in the app.
 * - `spiel` — fed by an earlier match; every later round's normal answer.
 * - `manuell` — no source, so the slot is the admin's own and nothing fills it for them.
 * - `offen` — no source and no team. The triage list's `besetzung_missing`, whose urgency is
 *   `blocking`, so it takes that page's danger grade and is the one alarm on this one.
 *
 * Every warm pair is the app's accent rule — the plain accent as a fill, its `-strong` companion as
 * text on it — which is the pairing `Callout` and the triage badges were both measured at.
 *
 * **`brand` is deliberately not in this set.** It is `#82181a`, a deep red, so a brand chip beside a
 * danger chip would be two reds claiming to be opposite answers.
 */
const HERKUNFT_CHIPS = {
  gruppe: "bg-phase-gruppenphase/10 text-phase-gruppenphase",
  spiel: "bg-info/15 text-info-strong",
  manuell: "bg-warning/15 text-warning-strong",
  offen: "bg-danger/15 text-danger-strong",
} as const;

/**
 * One side of one fixture: **where it comes from, and who is standing in it.**
 *
 * The source leads and the occupant follows, which is the whole difference between this page and a
 * match card. A card answers "who is playing" and drops the provenance the moment a winner arrives —
 * `SpielTeamSlot` prints the derived label only while the side is empty — so a played-out bracket
 * shows teams and no wiring at all. Here both are present always, because the fact under review is
 * the edge rather than the fixture.
 *
 * The two lines are deliberately different weights: the chip is the smallest text on the page and the
 * club is the largest in the row, so a reader scans provenance across a column and lands on a name
 * only when they mean to.
 */
function SlotWiring({ team, quelle }: { team: FLSpielTeamField | null; quelle: FLSpielQuelle | null }) {
  const herkunft = deriveSlotHerkunft(team, quelle);

  /* `deriveSlotHerkunft` decides which state this side is in, and is the one
     declaration of that -- the triage list reads the same function. The
     `quelle !== null` test below exists so TypeScript can read `.type`. */
  let label: string;
  let chip: string;

  if (quelle !== null) {
    // `formatQuelle` answers `null` only for a source whose number is unpicked,
    // a draft state `FLSpielQuelleSchema` rejects, so no stored fixture reaches
    // this fallback. It keeps the chip total if one ever did.
    label = formatQuelle(quelle) ?? "Herkunft unlesbar";
    chip = HERKUNFT_CHIPS[quelle.type];
  } else if (herkunft === "offen") {
    label = "Ohne Herkunft";
    chip = HERKUNFT_CHIPS.offen;
  } else {
    label = "Manuell gesetzt";
    chip = HERKUNFT_CHIPS.manuell;
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5">
      <span className={`${LABEL_BADGE} ${chip} max-w-full whitespace-normal`}>{label}</span>

      {/* The occupant, in the two spellings every card uses: the club's own name, or the shared
          placeholder for a side nobody stands in yet (ADR-0034). `break-words` and not `truncate` — a
          review surface that hides half a club's name is one an admin cannot finish, and the row is
          free to grow. */}
      {team === null ? (
        <span className="fluid-xs text-foreground-muted font-medium italic">{PLACEHOLDER.slot}</span>
      ) : (
        <strong className="fluid-sm text-foreground max-w-full font-bold break-words">{team.name}</strong>
      )}
    </div>
  );
}

/**
 * A season's bracket wiring, round by round — the draw as one surface, so it can be reviewed before
 * it is played (ADR-0045).
 *
 * **`teamN_quelle` is the only record of the bracket's edges (ADR-0034) and no surface showed it.**
 * The public bracket orders its rounds by the wiring and so draws its connecting lines correctly, but
 * it writes a slot's source out only while that slot is unresolved — so a played-out bracket states
 * the topology and none of the provenance, and checking a draw meant opening each fixture's editor
 * and reading two controls in it.
 *
 * **It is a preview, not a form**, which is the shape established competition software settles a draw
 * review into: the organiser reads the whole stage as it would stand, and the fixtures are edited
 * where they are already edited. Every row therefore links into `/admin/spiele/[spiel_id]`
 * (ADR-0040) rather than carrying a control of its own — one save path, and no second write surface
 * to keep in step with the refusals the endpoint makes (ADR-0038).
 *
 * **The Gruppenphase is absent by construction, not filtered out for tidiness.** A group fixture's
 * sides are drawn by the schedule and the mechanism a `quelle` names does not exist in that phase, so
 * the write path refuses wiring on one — there is nothing about it this page could show.
 *
 * **It does not report bracket faults.** Those are derived per request over whole seasons by the
 * admin route (ADR-0039) and already have a durable home in the triage list; what no fault list can
 * give is this — a legal feeder picked on the wrong side is not a contradiction, and only reading the
 * draw finds it.
 */
export function AdminBracketWiringView({ rounds }: { rounds: FLSpieltagWithSpiele[] }) {
  // Every round's label in one pass (ADR-0051). `rounds` arrives in played
  // order -- this view deliberately does NOT apply `orderRoundsByWiring` -- so
  // the ordinal counts the matchday's place in its phase.
  const labels = spieltagLabels(rounds);

  // The expected state for most of a season, exactly as on the public bracket: the playoff Spieltage
  // do not exist until the group phase finishes.
  if (rounds.length === 0) {
    return (
      <div className="max-w-page mx-auto flex w-full flex-col gap-6 px-3 py-4 sm:p-8">
        <EmptyState
          title="Noch keine Finalrunden"
          hint="Sobald die Spieltage der KO.-Runde angelegt sind, steht hier ihre Verweisstruktur."
        />
      </div>
    );
  }

  return (
    /* `AdminCrudShell`'s page frame rather than the component, which would owe
       this page a create trigger. `px-3` below `sm` for the reason
       `SaisontabelleView` uses it: page gutter is width a table row loses. */
    <div className={`${PAGE_RISE} max-w-page mx-auto flex w-full flex-col gap-6 px-3 py-4 sm:p-8`}>
      {rounds.map((round) => (
        <div
          key={round.id}
          className={`${card()} flex w-full flex-col items-start gap-4 p-3 sm:p-6`}>
          <h2 className="fluid-lg text-foreground font-black tracking-tight">{labels.get(round.id)?.label}</h2>

          {round.spiele.length === 0 ? (
            <EmptyState
              title="Für diese Runde sind noch keine Spiele angelegt."
              hint="Ohne Spiele gibt es auch keine Verweise zu prüfen."
            />
          ) : (
            <Table
              variant="secondary"
              className="h-fit w-full text-left">
              {/* **`table-fixed`, and it is what makes the two sides provably equal.** Under auto
                  layout a column is sized from its own content, so the two sides of one fixture came
                  out 113px against 119px at a phone width — and a declared `w-1/2` on each does not
                  fix it, because auto layout treats a percentage as a preference and content minima
                  override it exactly where the room is tightest. Fixed layout ignores content, gives
                  the two narrow columns the widths declared below, and divides everything left
                  **equally** between the columns that declare none. That is the pair, so they are
                  identical at every width by the layout algorithm rather than by arithmetic — and
                  nothing is left over beside the edit button, which is where a fixed share had put a
                  fifth of the table as blank gutter. */}
              <Table.Content
                aria-label={`Herkunft der Paarungen: ${labels.get(round.id)?.label ?? ""}`}
                className="table-fixed">
                <Table.Header className="fluid-xxs text-foreground-muted font-semibold uppercase">
                  <Table.Column
                    isRowHeader
                    className="w-11 pt-1.5 pb-2 pl-3 whitespace-nowrap lg:w-16 lg:pl-4">
                    {/* The full word costs about twenty pixels of column, which at 375 is twenty
                        pixels the two chips below do not get. Same trick, same reason, as
                        `SaisontabelleView`'s Differenz/Diff. pair. */}
                    <span className="hidden sm:inline">Spiel</span>
                    <span className="sm:hidden">#</span>
                  </Table.Column>
                  {/* No width, deliberately: this is the one column fixed layout gives the whole
                      remainder to, and declaring a width would just take room away from the pair.

                      **The two sides are one cell and not two columns, which is what makes the page
                      work on a phone.** As two columns they were 93px each at 375 — every group chip
                      wrapped to two lines and "Carlo-Mierendorff" to four. One cell holding a grid
                      that is single-track below `sm` gives each side the full ~210px there and splits
                      it in two from `sm` up, so the labels below still sit over their own tracks
                      wherever there is room for two. `gap-x-6` is repeated on the body's grid and the
                      two must stay equal, or the headings stop lining up with what they name. */}
                  <Table.Column className="px-2 lg:px-4">
                    <span className="sm:hidden">Paarung</span>
                    <div className="hidden gap-x-6 sm:grid sm:grid-cols-2">
                      <span>Team 1</span>
                      <span>Team 2</span>
                    </div>
                  </Table.Column>
                  {/* Labelled for a screen reader and blank for everyone else: a visible header over
                      one icon repeats what the icon's own tooltip already says.
                      **The width has to clear the BIGGEST the button gets, which is 38px from `md`
                      and not the 35px it starts at.** Sized to the smaller one, the column's content
                      box was 40px from `md` up and the control was pressed against both its edges —
                      which reads as no gutter at all rather than as a tight one. */}
                  <Table.Column className="w-14 pr-3 lg:w-16 lg:pr-4">
                    <span className="sr-only">Aktionen</span>
                  </Table.Column>
                </Table.Header>

                {/* No `renderEmptyState`, and the branch above is why. It is a render prop, which a
                    Server Component may not pass to a Client Component (frontend spec I13) — taking
                    it would make this a client boundary for a case a conditional already covers. */}
                <Table.Body>
                  {[...round.spiele]
                    .sort((spiel1, spiel2) => spiel1.spiel_nr - spiel2.spiel_nr)
                    .map((spiel) => (
                      <Table.Row
                        key={spiel.id}
                        className="border-border border-b last:border-0">
                        {/* The match number, which is what a `spiel` reference names — so the column
                            an admin reads a "Sieger 25." against is the column they look 25 up in
                            (ADR-0034). */}
                        <Table.Cell className="fluid-sm py-4 pl-3 font-bold whitespace-nowrap lg:pl-4">{spiel.spiel_nr}</Table.Cell>

                        {/* The pair, in the same grid the header labels sit in — single-track on a
                            phone, two equal tracks from `sm`. `gap-y-3` is what keeps the stacked
                            case readable as two sides rather than four stacked lines. */}
                        <Table.Cell className="px-2 py-4 align-top lg:px-4">
                          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                            <SlotWiring
                              team={spiel.team1}
                              quelle={spiel.team1_quelle}
                            />
                            <SlotWiring
                              team={spiel.team2}
                              quelle={spiel.team2_quelle}
                            />
                          </div>
                        </Table.Cell>

                        <Table.Cell className="py-4 pr-3 align-top lg:pr-4">
                          {/* **Pushed to the right edge, so the slack falls on the inside.** The
                              column is wider than the button by design, and left-aligned that surplus
                              sat between the control and the page edge — making the right gutter read
                              as bigger than the left one, when the two are the same declared value.
                              Ended right, the button's edge is exactly `pr-3` from the cell's, which
                              is the number's own inset on the far side of the row. */}
                          <div className="flex justify-end">
                            {/* The match card's edit control, class for class (ADR-0044): the brand
                                fill wherever `adminEditHref` is passed, so the one thing an admin
                                presses looks the same on every admin surface. A `<Link>` and not a
                                button, so Next prefetches on approach and middle-click still opens a
                                fixture in its own tab. */}
                            <IconTooltip label="Spiel bearbeiten">
                              <Link
                                href={adminSpielEditHref(spiel.id)}
                                aria-label={`Spiel Nr.${spiel.spiel_nr} bearbeiten`}
                                className="bg-brand-solid text-brand-solid-foreground hover:bg-brand-solid/90 flex h-[35px] w-[35px] shrink-0 items-center justify-center rounded-xl shadow-sm transition-colors duration-200 md:h-[38px] md:w-[38px]">
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
  );
}
