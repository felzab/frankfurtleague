import { ReadFolds, ReadFoldsPlaceholder } from "@/kit/ReadFolds";
import { ReadPage } from "@/kit/ReadPage";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";
import { chipOf, LINEUP_WORDS, markOf } from "@/features/aufstellungen/players";
import { spielerName } from "@/features/spieler/constants";

import type { Copy } from "@/core/copy";
import type { FLAufstellungResponse, FLAufstellungSpieler } from "@/core/generated/client/types";
import type { EmptyStateProps } from "@/kit/EmptyState";
import type { PageTitle } from "@/kit/RailFrame";
import type { FoldedCard } from "@/kit/ReadFolds";
import type { TableProps } from "@/kit/Table";

/** One part of the line-up as a table: a row a pupil, with their number and position, as the public match page lists one. */
function tableOf(label: Copy, spieler: readonly FLAufstellungSpieler[], gone: ReadonlySet<string>, empty: EmptyStateProps): TableProps {
  const { column } = SERVER_COPY.season;
  return {
    label,
    nameLabel: column.name,
    columns: [
      { key: "nummer", label: column.nummer, figures: true },
      { key: "position", label: column.position },
    ],
    rows: spieler.map((entry) => {
      const mark = markOf(entry);
      const chip = chipOf(entry);
      return {
        id: entry.spieler_id,
        name: spielerName(entry),
        ...(mark === undefined ? {} : { mark }),
        ...(chip === undefined ? {} : { chip }),
        // Named before the squad lost them: the editor's line for such a row.
        ...(gone.has(entry.spieler_id) ? { line: COPY.admin.spieler.deregistered } : {}),
        cells: {
          ...(entry.nummer === null ? {} : { nummer: { record: entry.nummer } }),
          ...(entry.position === null ? {} : { position: { record: entry.position } }),
        },
      };
    }),
    empty,
  };
}

/**
 * The line-up once the team can change nothing more, from one hour before kick-off: no editor, no bar and no act, as
 * the public match page shows a line-up. Under the title the editor's line, saying the league alone changes it now;
 * everyone named, the starters over the bench, each under its head and left out where it holds nobody, then the squad's
 * other pupils; a line-up never entered says so in its card.
 */
export function LockedLineup({ title, lead, read }: { title: PageTitle; lead: Copy; read: FLAufstellungResponse }) {
  const byId = new Map([...read.kader, ...read.named].map((spieler) => [spieler.spieler_id, spieler]));
  const gone = new Set(read.named.map((spieler) => spieler.spieler_id));
  const named = (starts: boolean) =>
    read.spieler.filter((entry) => entry.starts === starts).flatMap((entry) => byId.get(entry.spieler_id) ?? []);
  const { startelf, bank } = COPY.shared;
  const parts = [
    { head: startelf, spieler: named(true) },
    { head: bank, spieler: named(false) },
  ].filter((part) => part.spieler.length > 0);
  const listed = new Set(read.spieler.map((entry) => entry.spieler_id));
  const rest = read.kader.filter((spieler) => !listed.has(spieler.spieler_id));
  const { picked } = LINEUP_WORDS;
  const none: EmptyStateProps = { kind: "none", plural: picked };

  const cards: FoldedCard[] = [
    {
      title: picked,
      count: read.spieler.length,
      open: true,
      tables:
        parts.length === 0
          ? [tableOf(picked, [], gone, none)]
          : parts.map((part) => ({ head: part.head, table: tableOf(part.head, part.spieler, gone, none) })),
    },
  ];
  // A squad named whole leaves nobody to list under it; a team with no squad says so, as the editor does.
  if (rest.length > 0 || read.kader.length === 0) {
    cards.push({
      title: LINEUP_WORDS.rest,
      count: rest.length,
      open: true,
      tables: [tableOf(LINEUP_WORDS.rest, rest, gone, { kind: "none", plural: COPY.shared.kader, one: true })],
    });
  }

  return (
    <ReadPage
      scope="area"
      // Never drawn: the record is read already, and the editor's wait stood while it was.
      wait={{ lead: true, groups: [{ kind: "folds", folds: <ReadFoldsPlaceholder count={cards.length} /> }] }}
      record={Promise.resolve({
        title,
        chip: { tone: "neutral", label: COPY.area.team.aufstellung.locked },
        lead,
        groups: [
          {
            kind: "folds",
            folds: (
              <ReadFolds
                column
                cards={cards}
              />
            ),
          },
        ],
      })}
    />
  );
}
